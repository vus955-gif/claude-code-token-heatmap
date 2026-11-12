import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LoadStatus, TokenReport } from '../types'
import {
  DAY_MS,
  STRINGS,
  formatCount,
  formatTokens,
  heatmapSvg,
  pickLang,
  shortLabel,
  summarize,
  summaryOf,
  toKey,
  toMs,
} from './lib'

const PANE = 'token-heatmap'
/** How long one count may run before the engine stops it. */
const TIMEOUT_MS = 5 * 60_000
const report = atom({ plugin: 'token-heatmap', key: 'report' } as const, null as TokenReport | null)
const status = atom({ plugin: 'token-heatmap', key: 'status' } as const, { kind: 'idle' } as LoadStatus)

const lastLine = (text: string) => text.trim().split('\n').pop() ?? ''

/** Runs scripts/aggregate.mjs with Node.js and stores its report in $.state. */
async function refresh($: EngineInterface, nodePath: string) {
  if ((await read($, status)).kind === 'loading') return
  await update($, status, () => ({ kind: 'loading' }) as LoadStatus)
  let run
  try {
    run = await $.process.run([nodePath, `${$.plugin.root}/scripts/aggregate.mjs`], { timeoutMs: TIMEOUT_MS })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Past the time limit the engine kills the counter and rejects with
    // "aborted: still running after …ms"; any other rejection means Node.js did not start.
    const timedOut = message.includes('still running after')
    await update($, status, () =>
      (timedOut ? { kind: 'error', message, timedOut: true } : { kind: 'error', message, command: nodePath }) as LoadStatus,
    )
    return
  }
  try {
    if (run.exitCode !== 0) throw new Error(lastLine(run.stderr) || `exit code ${run.exitCode}`)
    const data = JSON.parse(run.stdout) as TokenReport
    await update($, report, () => data)
    await update($, status, () => ({ kind: 'idle' }) as LoadStatus)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await update($, status, () => ({ kind: 'error', message }) as LoadStatus)
  }
}

/**
 * Counting takes a few seconds on a large history, so it runs from a timer:
 * neither the command nor a press waits for it, and the pane redraws when the
 * new report lands in $.state.
 */
function scheduleRefresh($: EngineInterface, nodePath: string) {
  $.clock.after(10, () => void refresh($, nodePath))
}

export const register: Register = (on, options) => {
  // userConfig in .claude-plugin/plugin.json: language (auto | en | pl) and nodePath.
  const language = options.language
  const nodePath = typeof options.nodePath === 'string' && options.nodePath.trim() ? options.nodePath.trim() : 'node'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tokens',
      description: STRINGS[pickLang(language, undefined)].commandDescription,
      immediate: true,
    })

    return next(e)
  })

  on('command.run', { command: 'tokens' }, async $ => {
    const data = await read($, report)
    await $.ui.open({ id: PANE, title: STRINGS[pickLang(language, data?.locale)].title })
    scheduleRefresh($, nodePath)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const data = await read($, report)
    const st = await read($, status)
    const lang = pickLang(language, data?.locale)
    const s = STRINGS[lang]
    const isLoading = st.kind === 'loading'

    const header = (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text dimColor>{s.counted}</Text>
        <Button key="refresh" label={isLoading ? s.counting : s.refresh} onPress={() => scheduleRefresh($, nodePath)} />
      </Box>
    )
    const error =
      st.kind === 'error' ? (
        <Text color="red">
          {st.timedOut
            ? s.timedOut(TIMEOUT_MS / 60_000)
            : st.command
              ? `${s.nodeMissing(st.command)} (${st.message})`
              : `${s.error}: ${st.message}`}
        </Text>
      ) : null

    if (!data) {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          {error}
          <Text dimColor>{isLoading ? s.loading : s.empty}</Text>
        </Box>
      )
    }

    // Transcripts the counter could not stat or read; it tries them again next time.
    const unreadable =
      data.errors > 0 ? <Text color="yellow">{s.unreadable(formatCount(data.errors, lang))}</Text> : null

    const days = summarize(data)
    const sum = summaryOf(days, data.today)
    const tiles: [string, string][] = [
      [s.total, formatTokens(sum.total, lang)],
      [s.today, formatTokens(sum.today, lang)],
      [s.last7, formatTokens(sum.last7, lang)],
      [s.average, formatTokens(sum.average, lang)],
      [s.best, sum.best ? `${formatTokens(sum.best.total, lang)} · ${shortLabel(sum.best.key, lang)}` : '—'],
    ]
    const tileRow = (
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {tiles.map(([label, value]) => (
          <Box flexDirection="column" borderStyle="round" paddingX={1} minWidth={18}>
            <Text dimColor>{label}</Text>
            <Text bold>{value}</Text>
          </Box>
        ))}
      </Box>
    )

    let chart
    const columns = e.props.bodyColumns ?? 80
    if ('Svg' in ui) {
      // Desktop, VS Code and mobile draw SVG; `isInteractive` keeps the <title> tooltips.
      const { Svg } = ui
      const { svg, width, height } = heatmapSvg(days, data.today, Math.min(900, Math.max(300, columns * 8)), lang)
      chart = (
        <Svg source={svg} width={width} height={height} isInteractive alt={s.alt(formatTokens(sum.total, lang), sum.activeDays)} />
      )
    } else {
      // The terminal: the last two weeks as bars.
      const t = toMs(data.today)
      const barWidth = Math.max(10, columns - 24)
      const keys = Array.from({ length: 14 }, (_, i) => toKey(t - (13 - i) * DAY_MS))
      const max = Math.max(1, ...keys.map(key => days.get(key)?.total ?? 0))
      chart = (
        <Box flexDirection="column">
          {keys.map(key => {
            const value = days.get(key)?.total ?? 0
            const bar = '█'.repeat(Math.round((value / max) * barWidth))
            return <Text>{`${shortLabel(key, lang).padEnd(7)} ${bar.padEnd(barWidth)} ${formatTokens(value, lang)}`}</Text>
          })}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {header}
        {error}
        {unreadable}
        {tileRow}
        {chart}
        <Text dimColor>
          {s.footer(formatCount(sum.activeDays, lang), formatCount(data.messages, lang), formatCount(data.files, lang), data.updatedLocal)}
        </Text>
      </Box>
    )
  })
}
