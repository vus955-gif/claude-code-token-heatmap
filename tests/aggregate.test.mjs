// Tests of the token counter, scripts/aggregate.mjs:
//   node --test tests/aggregate.test.mjs
//
// Each test runs the counter as Claude Code's pane does (a separate Node.js
// process) over synthetic transcripts in a temporary CLAUDE_CONFIG_DIR, so it
// never reads or writes a real ~/.claude.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../scripts/aggregate.mjs', import.meta.url))
const MODEL = 'claude-opus-5-5'

/** A fresh, empty config dir for one test; removed when `fn` ends. */
async function withConfigDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-heatmap-test-'))
  try {
    await fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** Runs the counter on `configDir` and returns its report. */
function count(configDir, { tz = 'UTC' } = {}) {
  assert.ok(configDir, 'a test must name its own config dir')
  const run = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, TZ: tz },
    encoding: 'utf8',
  })
  assert.equal(run.status, 0, run.stderr)
  return JSON.parse(run.stdout)
}

/** Writes (or appends to) a transcript under <configDir>/projects/<project>/<name>. */
function transcript(configDir, name, text, { project = '-tmp-demo', append = false } = {}) {
  const file = path.join(configDir, 'projects', project, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (append) fs.appendFileSync(file, text)
  else fs.writeFileSync(file, text)
  return file
}

/** One transcript line of an API response, the way Claude Code writes it. */
function line({ id, timestamp = '2026-10-01T12:00:00.000Z', model = MODEL, input = 0, output = 0, cacheWrite = 0, cacheRead = 0, block = 'text' }) {
  return `${JSON.stringify({
    type: 'assistant',
    timestamp,
    message: {
      id,
      model,
      role: 'assistant',
      content: [{ type: block }],
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: cacheWrite,
        cache_read_input_tokens: cacheRead,
      },
    },
  })}\n`
}

const userLine = `${JSON.stringify({ type: 'user', timestamp: '2026-10-01T11:59:00.000Z', message: { role: 'user', content: 'hi' } })}\n`

test('a response written as three lines is counted once, with its full output', () =>
  withConfigDir(dir => {
    const usage = { id: 'msg_1', input: 10, cacheWrite: 200, cacheRead: 5_000 }
    transcript(dir, 'session.jsonl', [
      userLine,
      // While streaming, the first block's line can carry a partial output count.
      line({ ...usage, output: 3, block: 'thinking' }),
      line({ ...usage, output: 120, block: 'text' }),
      line({ ...usage, output: 120, block: 'tool_use' }),
    ].join(''))

    const report = count(dir)
    assert.equal(report.messages, 1)
    assert.deepEqual(report.days, { '2026-10-01': { [MODEL]: [10, 120, 200, 5_000] } })
  }))

test('the same response in two transcripts is counted once', () =>
  withConfigDir(dir => {
    // A resumed session repeats the response of the session it continues.
    transcript(dir, 'first.jsonl', line({ id: 'msg_1', output: 50, cacheRead: 1_000 }))
    transcript(dir, 'resumed.jsonl', line({ id: 'msg_1', output: 50, cacheRead: 1_000 }) + line({ id: 'msg_2', output: 7, cacheRead: 2_000 }))

    const report = count(dir)
    assert.equal(report.files, 2)
    assert.equal(report.messages, 2)
    assert.deepEqual(report.days, { '2026-10-01': { [MODEL]: [0, 57, 0, 3_000] } })
  }))

test('a half-written last line is skipped, and counted once it is complete', () =>
  withConfigDir(dir => {
    const second = line({ id: 'msg_2', output: 9, cacheRead: 900 })
    const cut = 40
    transcript(dir, 'session.jsonl', line({ id: 'msg_1', output: 1, cacheRead: 100 }) + second.slice(0, cut))

    const before = count(dir)
    assert.equal(before.messages, 1)
    assert.equal(before.errors, 0)
    assert.deepEqual(before.days, { '2026-10-01': { [MODEL]: [0, 1, 0, 100] } })

    // Claude Code finishes writing the line.
    transcript(dir, 'session.jsonl', second.slice(cut), { append: true })

    const after = count(dir)
    assert.equal(after.reparsed, 1)
    assert.equal(after.messages, 2)
    assert.deepEqual(after.days, { '2026-10-01': { [MODEL]: [0, 10, 0, 1_000] } })
  }))

test('a transcript deleted by Claude Code’s cleanup stays counted through the archive', () =>
  withConfigDir(dir => {
    const old = transcript(dir, 'old.jsonl', line({ id: 'msg_old', timestamp: '2026-09-01T09:00:00.000Z', output: 4, cacheRead: 400 }))
    transcript(dir, 'new.jsonl', line({ id: 'msg_new', output: 6, cacheRead: 600 }))

    const before = count(dir)
    assert.equal(before.messages, 2)

    fs.rmSync(old)

    const after = count(dir)
    assert.equal(after.files, 1)
    assert.equal(after.messages, 2)
    assert.deepEqual(after.days, before.days)
  }))

test('a cached response moves to the right local day when the time zone changes', () =>
  withConfigDir(dir => {
    // 23:30 UTC on 1 October is already 08:30 on 2 October in Tokyo.
    transcript(dir, 'session.jsonl', line({ id: 'msg_1', timestamp: '2026-10-01T23:30:00.000Z', output: 5, cacheRead: 500 }))

    const utc = count(dir, { tz: 'UTC' })
    assert.deepEqual(Object.keys(utc.days), ['2026-10-01'])

    // The transcript is unchanged, so this run answers from the cache.
    const tokyo = count(dir, { tz: 'Asia/Tokyo' })
    assert.equal(tokyo.reparsed, 0)
    assert.deepEqual(Object.keys(tokyo.days), ['2026-10-02'])
  }))

test('a version 1 cache keeps the history of deleted transcripts', () =>
  withConfigDir(dir => {
    // Version 1 stored each response's local day instead of its time.
    const live = transcript(dir, 'live.jsonl', line({ id: 'msg_live', timestamp: '2026-10-01T23:30:00.000Z', output: 3, cacheRead: 30 }))
    const deleted = path.join(dir, 'projects', '-tmp-demo', 'deleted.jsonl')
    const cacheFile = path.join(dir, 'token-heatmap', 'cache.json')
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
    fs.writeFileSync(cacheFile, JSON.stringify({
      version: 1,
      files: {
        [live]: { size: 1, mtimeMs: 1, parsedBytes: 1, msgs: { msg_live: ['2026-10-01', MODEL, 0, 3, 0, 30] } },
        [deleted]: { size: 1, mtimeMs: 1, parsedBytes: 1, msgs: { msg_deleted: ['2026-09-20', MODEL, 0, 2, 0, 20] } },
      },
      archive: { msg_archived: ['2026-09-15', MODEL, 0, 1, 0, 10] },
    }))

    const report = count(dir, { tz: 'Asia/Tokyo' })
    assert.equal(report.messages, 3)
    assert.deepEqual(report.days, {
      '2026-09-15': { [MODEL]: [0, 1, 0, 10] },
      '2026-09-20': { [MODEL]: [0, 2, 0, 20] },
      // Read again from the transcript, so on Tokyo's day.
      '2026-10-02': { [MODEL]: [0, 3, 0, 30] },
    })
    assert.equal(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).version, 2)
  }))

test('an unchanged transcript is not read again', () =>
  withConfigDir(dir => {
    transcript(dir, 'session.jsonl', line({ id: 'msg_1', output: 1, cacheRead: 10 }))
    assert.equal(count(dir).reparsed, 1)
    const again = count(dir)
    assert.equal(again.reparsed, 0)
    assert.equal(again.messages, 1)
  }))
