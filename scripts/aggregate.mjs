// Token counter for the token-heatmap plugin.
//
// Reads Claude Code transcripts (<config dir>/projects/**/*.jsonl), counts every
// API response once (by message.id) and prints JSON with per-day, per-model
// totals to stdout. hooks/register.tsx runs it with $.process.run([node, this]).
//
// A persistent cache (<config dir>/token-heatmap/cache.json) keeps it fast and
// keeps history:
// - unchanged files are not read again,
// - files that grew are read from where the last run stopped (JSONL is append-only),
// - responses from transcripts that Claude Code's cleanup deleted move to an
//   archive, so the heatmap keeps those days.
// The cache keeps each response's time, not its day: the local day is worked
// out for every report, so a change of time zone moves cached responses too.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const CACHE_VERSION = 2
const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const projectsDir = path.join(configDir, 'projects')
const cacheDir = path.join(configDir, 'token-heatmap')
const cachePath = path.join(cacheDir, 'cache.json')

const pad = n => String(n).padStart(2, '0')
const localDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function loadCache() {
  let cache
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) } catch {}
  if (cache?.version === CACHE_VERSION) return cache
  const fresh = { version: CACHE_VERSION, files: {}, archive: {} }
  if (cache?.version === 1) {
    // Version 1 kept each response's local day ("YYYY-MM-DD") instead of its
    // time. Transcripts that still exist are read again; for those already
    // deleted the cache is all that is left, so their responses move to the
    // archive, each at noon of its day.
    for (const [file, entry] of Object.entries(cache.files ?? {})) {
      if (!fs.existsSync(file)) keepLarger(fresh.archive, fromDays(entry?.msgs))
    }
    keepLarger(fresh.archive, fromDays(cache.archive))
  }
  return fresh
}

function fromDays(msgs) {
  const out = {}
  for (const [id, rec] of Object.entries(msgs ?? {})) {
    if (!Array.isArray(rec)) continue
    const [y, m, d] = String(rec[0]).split('-').map(Number)
    const time = new Date(y, m - 1, d, 12).getTime()
    if (Number.isFinite(time)) out[id] = [time, ...rec.slice(1)]
  }
  return out
}

function saveCache(cache) {
  fs.mkdirSync(cacheDir, { recursive: true })
  const tmp = `${cachePath}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(cache))
  fs.renameSync(tmp, cachePath)
}

function listTranscripts(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listTranscripts(full, out)
    else if (entry.name.endsWith('.jsonl')) out.push(full)
  }
  return out
}

const sum = rec => rec[2] + rec[3] + rec[4] + rec[5]

/** Copies each response of `from` into `into` unless `into` already holds a larger count of it. */
function keepLarger(into, from) {
  for (const [id, rec] of Object.entries(from)) {
    const prev = into[id]
    if (!prev || sum(rec) > sum(prev)) into[id] = rec
  }
}

// A record: [time (ms since 1970, UTC), model, input, output, cacheWrite, cacheRead]
function handleLine(line, msgs) {
  // Cheap filter before paying for JSON.parse on long tool-result lines.
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return
  let o
  try { o = JSON.parse(line) } catch { return }
  const id = o?.message?.id
  const u = o?.message?.usage
  const time = Date.parse(o.timestamp)
  if (o.type !== 'assistant' || !id || !u || !Number.isFinite(time)) return
  const rec = [
    time,
    o.message.model || 'unknown',
    u.input_tokens || 0,
    u.output_tokens || 0,
    u.cache_creation_input_tokens || 0,
    u.cache_read_input_tokens || 0,
  ]
  if (sum(rec) === 0) return // synthetic messages and API errors
  // One response is written as several lines (one per content block), each
  // carrying the full usage; while streaming, earlier lines can hold a partial
  // output count, so the largest one wins.
  const prev = msgs[id]
  if (!prev || sum(rec) > sum(prev)) msgs[id] = rec
}

// Reads a file from byte `start`; returns the offset just past the last whole line.
// The pieces of a long line are collected and joined once, at its newline:
// joining at every chunk would be quadratic for lines of several MB.
async function parseFrom(file, start, msgs) {
  let parts = []
  let consumed = start
  for await (const chunk of fs.createReadStream(file, { start, highWaterMark: 1 << 20 })) {
    let from = 0
    let nl
    while ((nl = chunk.indexOf(10, from)) !== -1) {
      const piece = chunk.subarray(from, nl)
      const line = parts.length ? Buffer.concat([...parts, piece]) : piece
      handleLine(line.toString('utf8'), msgs)
      consumed += line.length + 1
      parts = []
      from = nl + 1
    }
    if (from < chunk.length) parts.push(chunk.subarray(from))
  }
  return consumed
}

async function main() {
  const cache = loadCache()
  const files = listTranscripts(projectsDir)
  const alive = new Set(files)
  let reparsed = 0
  let errors = 0

  for (const file of files) {
    let st
    try { st = fs.statSync(file) } catch { errors++; continue }
    const prev = cache.files[file]
    if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) continue
    try {
      // Grown: read only the new tail. Shrunk or new: from the start.
      const grew = prev && st.size >= prev.parsedBytes
      const msgs = grew ? prev.msgs : {}
      const parsedBytes = await parseFrom(file, grew ? prev.parsedBytes : 0, msgs)
      cache.files[file] = { size: st.size, mtimeMs: st.mtimeMs, parsedBytes, msgs }
      reparsed++
    } catch {
      errors++
    }
  }

  // Transcripts deleted by Claude Code's cleanup: keep their responses in the archive.
  for (const file of Object.keys(cache.files)) {
    if (alive.has(file)) continue
    keepLarger(cache.archive, cache.files[file].msgs)
    delete cache.files[file]
  }

  // Global de-duplication: the same response can sit in several files
  // (resumed sessions, subagents).
  const all = new Map(Object.entries(cache.archive))
  for (const entry of Object.values(cache.files)) {
    for (const [id, rec] of Object.entries(entry.msgs)) {
      const prev = all.get(id)
      if (!prev || sum(rec) > sum(prev)) all.set(id, rec)
    }
  }

  // days[day][model] = [input, output, cacheWrite, cacheRead], each day local
  const days = {}
  for (const [time, model, i, o, cw, cr] of all.values()) {
    const byModel = (days[localDay(new Date(time))] ??= {})
    const acc = (byModel[model] ??= [0, 0, 0, 0])
    acc[0] += i; acc[1] += o; acc[2] += cw; acc[3] += cr
  }

  saveCache(cache)
  const now = new Date()
  process.stdout.write(JSON.stringify({
    generatedAt: now.getTime(),
    today: localDay(now),
    updatedLocal: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    messages: all.size,
    files: files.length,
    reparsed,
    errors,
    days,
  }))
}

main().catch(err => {
  process.stderr.write(String(err?.stack || err))
  process.exit(1)
})
