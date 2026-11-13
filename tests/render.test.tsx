import { expect, mock, test } from 'claude-code/testing'

import type { TokenReport } from '../types'

// Synthetic numbers: a quiet day, a busy day and today.
const FIXTURE: TokenReport = {
  generatedAt: 0,
  today: '2026-10-02',
  updatedLocal: '12:00',
  locale: 'en-US',
  messages: 3,
  files: 2,
  reparsed: 2,
  errors: 0,
  days: {
    '2026-09-24': { 'claude-sonnet-5': [100, 20_000, 500_000, 9_479_900] },
    '2026-09-25': {
      'claude-opus-5-5': [1_000, 1_500_000, 12_000_000, 386_499_000],
      'claude-haiku-4-5-20251001': [500, 10_000, 200_000, 4_789_500],
    },
    '2026-10-02': { 'claude-opus-5-5': [10, 2_000, 30_000, 400_000] },
  },
}

const PANE_PROPS = {
  title: 'Tokens / day',
  isFocused: false,
  bodyColumns: 90,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

const CASES = [
  { language: 'en', empty: /No data yet/, best: /Best day/, day: /Sep 25/, total: /410\.2M|Total/ },
  { language: 'pl', empty: /Brak danych/, best: /Rekordowy dzień/, day: /25 wrz/, total: /Łącznie/ },
] as const

for (const c of CASES) {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`pane in ${c.language} on ${surface}`, { options: { language: c.language } }, async ($, on) => {
      const clock = mock.clock(on)
      // The aggregator "prints" the fixture instead of reading real transcripts.
      on('process.run', async () => ({
        value: {
          exitCode: 0,
          stdout: JSON.stringify(FIXTURE),
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }))

      const ui = await $.ui.mount({
        plugin: 'token-heatmap', surface, component: 'Pane', requestId: 'token-heatmap', props: PANE_PROPS,
      })
      expect(await ui.find({ type: 'Text', text: c.empty })).toBeDefined()

      await ui.press({ key: 'refresh' })
      await clock.advance(50)

      await ui.drawn()
      expect(await ui.find({ type: 'Text', text: c.best })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: c.day })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: c.total })).toBeDefined()
      if (surface === 'desktop') expect(await ui.find({ type: 'Svg' })).toBeDefined()
      await ui.unmount()
    })
  }
}

test('a missing Node.js shows how to fix it', { options: { language: 'en', nodePath: 'no-such-node' } }, async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async () => ({ deny: 'cannot start' }))

  const ui = await $.ui.mount({
    plugin: 'token-heatmap', surface: 'desktop', component: 'Pane', requestId: 'token-heatmap', props: PANE_PROPS,
  })
  await ui.press({ key: 'refresh' })
  await clock.advance(50)
  expect(await ui.find({ type: 'Text', text: /no-such-node.*nodePath/ })).toBeDefined()
  await ui.unmount()
})

// `language: auto` before the first count, when no report has said the locale yet.
const LOCALE_CASES: { env: Record<string, string>; empty: RegExp }[] = [
  { env: { LANG: 'pl_PL.UTF-8' }, empty: /Brak danych/ },
  { env: { LANG: 'en_US.UTF-8' }, empty: /No data yet/ },
  // LC_ALL overrides LANG, as for every program on the machine.
  { env: { LANG: 'en_US.UTF-8', LC_ALL: 'pl_PL.UTF-8' }, empty: /Brak danych/ },
]

for (const c of LOCALE_CASES) {
  test(`auto follows the system locale before the first count (${JSON.stringify(c.env)})`, { options: { language: 'auto' } }, async ($, on) => {
    mock.env(on, c.env)
    const ui = await $.ui.mount({
      plugin: 'token-heatmap', surface: 'terminal', component: 'Pane', requestId: 'token-heatmap', props: PANE_PROPS,
    })
    expect(await ui.find({ type: 'Text', text: c.empty })).toBeDefined()
    await ui.unmount()
  })
}

for (const c of [
  { language: 'en', timeout: /stopped after 5 minutes/, unreadable: /could not be read: 2/ },
  { language: 'pl', timeout: /przerwano po 5 minutach/, unreadable: /odczytać transkryptów: 2/ },
] as const) {
  test(`a count that runs too long says so, not that Node.js is missing (${c.language})`, { options: { language: c.language } }, async ($, on) => {
    const clock = mock.clock(on)
    // How the engine rejects $.process.run once the timeout has passed.
    on('process.run', async () => ({ deny: 'aborted: still running after 300000ms' }))

    const ui = await $.ui.mount({
      plugin: 'token-heatmap', surface: 'desktop', component: 'Pane', requestId: 'token-heatmap', props: PANE_PROPS,
    })
    await ui.press({ key: 'refresh' })
    await clock.advance(50)
    expect(await ui.find({ type: 'Text', text: c.timeout })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /nodePath/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`transcripts the counter could not read are reported (${c.language})`, { options: { language: c.language } }, async ($, on) => {
    const clock = mock.clock(on)
    on('process.run', async () => ({
      value: {
        exitCode: 0,
        stdout: JSON.stringify({ ...FIXTURE, errors: 2 }),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }))

    const ui = await $.ui.mount({
      plugin: 'token-heatmap', surface: 'terminal', component: 'Pane', requestId: 'token-heatmap', props: PANE_PROPS,
    })
    await ui.press({ key: 'refresh' })
    await clock.advance(50)
    await ui.drawn()
    expect(await ui.find({ type: 'Text', text: c.unreadable })).toBeDefined()
    await ui.unmount()
  })
}
