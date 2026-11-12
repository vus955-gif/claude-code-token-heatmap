// Pure helpers shared by the pane (hooks/register.tsx) and the README preview
// (scripts/preview.mjs): what counts as a token, English and Polish strings,
// number and date formatting, and the heatmap SVG. Nothing here calls the engine.
import type { TokenReport, Usage, UsageTuple } from '../types'

export type Lang = 'en' | 'pl'

/**
 * What the pane counts as "tokens": all four counters of an API response
 * (input, output, cache writes, cache reads). The aggregator already counts
 * each response once, so nothing is double counted here.
 */
export function tokensOf(u: Usage): number {
  return u.input + u.output + u.cacheWrite + u.cacheRead
}

// ── Strings ─────────────────────────────────────────────────────────────────

type Strings = {
  title: string
  commandDescription: string
  counted: string
  refresh: string
  counting: string
  empty: string
  loading: string
  error: string
  nodeMissing: (command: string) => string
  timedOut: (minutes: number) => string
  unreadable: (count: string) => string
  total: string
  today: string
  last7: string
  average: string
  best: string
  tokens: string
  noUsage: string
  less: string
  more: string
  footer: (activeDays: string, responses: string, files: string, time: string) => string
  alt: (total: string, activeDays: number) => string
  months: readonly string[]
  weekdays: readonly string[]
  /** Largest first: [size, unit]. */
  units: readonly (readonly [number, string])[]
  unitGap: string
  decimal: string
  group: string
}

export const STRINGS: Record<Lang, Strings> = {
  en: {
    title: 'Tokens / day',
    commandDescription: 'Open a heatmap of tokens used per day',
    counted: 'Counted: input + output + cache writes + cache reads, each API response once',
    refresh: 'Refresh',
    counting: 'Counting…',
    empty: 'No data yet. Press “Refresh”.',
    loading: 'Counting tokens in your transcripts…',
    error: 'Error',
    nodeMissing: command =>
      `Could not run “${command}”. Install Node.js 18 or newer, or set the plugin option “nodePath”.`,
    timedOut: minutes => `The count was stopped after ${minutes} minutes. Press “Refresh” to try again.`,
    unreadable: count => `Transcripts that could not be read: ${count}. Some tokens may be missing from the totals.`,
    total: 'Total',
    today: 'Today',
    last7: 'Last 7 days',
    average: 'Average per active day',
    best: 'Best day',
    tokens: 'tokens',
    noUsage: 'no usage',
    less: 'less',
    more: 'more',
    footer: (days, responses, files, time) =>
      `Active days: ${days} · API responses: ${responses} · transcripts: ${files} · updated ${time}`,
    alt: (total, days) => `Heatmap of tokens per day: ${total} across ${days} active days`,
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    units: [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']],
    unitGap: '',
    decimal: '.',
    group: ',',
  },
  pl: {
    title: 'Tokeny / dzień',
    commandDescription: 'Heatmapa tokenów zużytych w każdym dniu',
    counted: 'Liczone: wejście + wyjście + zapis i odczyt cache, każda odpowiedź API raz',
    refresh: 'Odśwież',
    counting: 'Liczę…',
    empty: 'Brak danych. Naciśnij „Odśwież”.',
    loading: 'Liczę tokeny z transkryptów…',
    error: 'Błąd',
    nodeMissing: command =>
      `Nie udało się uruchomić „${command}”. Zainstaluj Node.js 18+ albo ustaw opcję wtyczki „nodePath”.`,
    timedOut: minutes => `Liczenie przerwano po ${minutes} minutach. Naciśnij „Odśwież”, aby spróbować ponownie.`,
    unreadable: count => `Nie udało się odczytać transkryptów: ${count}. Część tokenów może nie być policzona.`,
    total: 'Łącznie',
    today: 'Dziś',
    last7: 'Ostatnie 7 dni',
    average: 'Średnio / aktywny dzień',
    best: 'Rekordowy dzień',
    tokens: 'tokenów',
    noUsage: 'brak',
    less: 'mniej',
    more: 'więcej',
    footer: (days, responses, files, time) =>
      `Aktywne dni: ${days} · odpowiedzi API: ${responses} · transkryptów: ${files} · stan z ${time}`,
    alt: (total, days) => `Heatmapa tokenów na dzień: łącznie ${total} w ${days} aktywnych dniach`,
    months: ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'],
    weekdays: ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'],
    units: [[1e9, 'mld'], [1e6, 'mln'], [1e3, 'tys.']],
    unitGap: ' ',
    decimal: ',',
    group: ' ',
  },
}

/** `auto` follows the machine's locale (`pl-PL`, `pl_PL.UTF-8`, ...): Polish locales get Polish. */
export function pickLang(preference: unknown, locale: string | undefined): Lang {
  if (preference === 'en' || preference === 'pl') return preference
  return locale?.toLowerCase().startsWith('pl') ? 'pl' : 'en'
}

// ── Numbers ─────────────────────────────────────────────────────────────────

/** 600M / 1.2B in English, 600 mln / 1,2 mld in Polish: three significant digits at most. */
export function formatTokens(n: number, lang: Lang): string {
  const { units, unitGap, decimal } = STRINGS[lang]
  for (let i = 0; i < units.length; i++) {
    const [size, unit] = units[i]!
    if (n < size) continue
    let v = n / size
    let label = unit
    const bigger = units[i - 1]
    if (bigger && Math.round(v) >= 1000) {
      v /= 1000
      label = bigger[1]
    }
    const text = v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '')
    return `${text.replace('.', decimal)}${unitGap}${label}`
  }
  return String(Math.round(n))
}

/** 12,191 in English, 12 191 in Polish. */
export function formatCount(n: number, lang: Lang): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, STRINGS[lang].group)
}

// ── Dates ───────────────────────────────────────────────────────────────────
// Day keys are YYYY-MM-DD in the machine's local time (the aggregator decided
// that); arithmetic on them runs in UTC so no time zone can shift a day.

export const DAY_MS = 86_400_000

export const toMs = (key: string): number => {
  const [y = 1970, m = 1, d = 1] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export const toKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

export function shortLabel(key: string, lang: Lang): string {
  const d = new Date(toMs(key))
  const month = STRINGS[lang].months[d.getUTCMonth()]
  return lang === 'pl' ? `${d.getUTCDate()} ${month}` : `${month} ${d.getUTCDate()}`
}

export function longLabel(key: string, lang: Lang): string {
  const d = new Date(toMs(key))
  const { months, weekdays } = STRINGS[lang]
  const day = weekdays[d.getUTCDay()]
  const month = months[d.getUTCMonth()]
  return lang === 'pl'
    ? `${day}, ${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`
    : `${day}, ${month} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

// ── The report, summed per day ──────────────────────────────────────────────

export type Day = { key: string; total: number; byModel: [string, number][] }

const toUsage = ([input, output, cacheWrite, cacheRead]: UsageTuple): Usage =>
  ({ input, output, cacheWrite, cacheRead })

/** claude-opus-5-5 → Opus 5.5, claude-haiku-4-5-20251001 → Haiku 4.5, claude-3-5-sonnet-20241022 → Sonnet 3.5 */
export function modelName(id: string): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const modern = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/)
  if (modern) return `${cap(modern[1]!)} ${modern[2]}${modern[3] ? `.${modern[3]}` : ''}`
  const legacy = id.match(/^claude-(\d+)(?:-(\d))?-([a-z]+)(?:-\d{8})?$/)
  if (legacy) return `${cap(legacy[3]!)} ${legacy[1]}${legacy[2] ? `.${legacy[2]}` : ''}`
  return id
}

export function summarize(report: TokenReport): Map<string, Day> {
  const out = new Map<string, Day>()
  for (const [key, models] of Object.entries(report.days)) {
    const merged = new Map<string, number>()
    for (const [model, tuple] of Object.entries(models)) {
      const name = modelName(model)
      merged.set(name, (merged.get(name) ?? 0) + tokensOf(toUsage(tuple)))
    }
    const byModel = [...merged].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
    const total = byModel.reduce((sum, [, n]) => sum + n, 0)
    if (total > 0) out.set(key, { key, total, byModel })
  }
  return out
}

export type Summary = {
  total: number
  today: number
  last7: number
  average: number
  activeDays: number
  best: Day | undefined
}

export function summaryOf(days: Map<string, Day>, today: string): Summary {
  const all = [...days.values()]
  const t = toMs(today)
  let last7 = 0
  for (let i = 0; i < 7; i++) last7 += days.get(toKey(t - i * DAY_MS))?.total ?? 0
  const total = all.reduce((sum, day) => sum + day.total, 0)
  return {
    total,
    today: days.get(today)?.total ?? 0,
    last7,
    average: all.length ? total / all.length : 0,
    activeDays: all.length,
    best: all.reduce<Day | undefined>((a, b) => (!a || b.total > a.total ? b : a), undefined),
  }
}

// ── Heatmap SVG ─────────────────────────────────────────────────────────────
// Colors are translucent so the same SVG reads on light and dark backgrounds.

export const COLORS = [
  'rgba(128,128,128,0.16)',
  'rgba(59,130,246,0.32)',
  'rgba(59,130,246,0.52)',
  'rgba(59,130,246,0.76)',
  'rgba(59,130,246,1)',
] as const
export const INK = '#8a8a8a'

/** Square-root scale: one record day does not wash every other day out. */
export function levelOf(value: number, max: number): number {
  if (value <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(value / max) * 4)))
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Weeks as columns (Monday first), the newest on the right; `<title>` tooltips per day. */
export function heatmapSvg(days: Map<string, Day>, today: string, widthPx: number, lang: Lang) {
  const s = STRINGS[lang]
  const left = 28
  const top = 16
  const gap = 3
  const weeks = Math.max(8, Math.min(53, Math.floor((widthPx - left) / 16)))
  const cell = Math.max(8, Math.min(18, Math.floor((widthPx - left) / weeks) - gap))
  const step = cell + gap
  const t = toMs(today)
  const todayRow = (new Date(t).getUTCDay() + 6) % 7
  const start = t - (todayRow + (weeks - 1) * 7) * DAY_MS

  let max = 1
  for (const day of days.values()) if (toMs(day.key) >= start) max = Math.max(max, day.total)

  const parts: string[] = []
  let lastMonth = -1
  let lastLabelAt = -99
  for (let w = 0; w < weeks; w++) {
    const colMs = start + w * 7 * DAY_MS
    const month = new Date(colMs).getUTCMonth()
    if (month !== lastMonth) {
      if (w - lastLabelAt >= 3) {
        parts.push(`<text x="${left + w * step}" y="10" font-size="10" fill="${INK}">${s.months[month]}</text>`)
        lastLabelAt = w
      }
      lastMonth = month
    }
    for (let d = 0; d < 7; d++) {
      const ms = colMs + d * DAY_MS
      if (ms > t) break
      const key = toKey(ms)
      const day = days.get(key)
      const value = day?.total ?? 0
      const tip = day
        ? [`${longLabel(key, lang)} — ${formatTokens(value, lang)} ${s.tokens}`,
            ...day.byModel.map(([m, n]) => `${m}: ${formatTokens(n, lang)}`)].join('\n')
        : `${longLabel(key, lang)} — ${s.noUsage}`
      const ring = key === today ? ` stroke="${COLORS[4]}" stroke-width="1.5"` : ''
      parts.push(
        `<rect x="${left + w * step}" y="${top + d * step}" width="${cell}" height="${cell}" rx="2"` +
          ` fill="${COLORS[levelOf(value, max)]}"${ring}><title>${esc(tip).replace(/\n/g, '&#10;')}</title></rect>`,
      )
    }
  }
  // Monday, Wednesday, Friday on rows 0, 2, 4.
  for (const [row, weekday] of [[0, 1], [2, 3], [4, 5]] as const) {
    parts.push(`<text x="0" y="${top + row * step + cell - 1}" font-size="10" fill="${INK}">${s.weekdays[weekday]}</text>`)
  }

  const legendY = top + 7 * step + 6
  const lessWidth = s.less.length * 6 + 6
  parts.push(`<text x="${left}" y="${legendY + 9}" font-size="10" fill="${INK}">${s.less}</text>`)
  COLORS.forEach((color, i) => {
    parts.push(`<rect x="${left + lessWidth + i * 13}" y="${legendY}" width="10" height="10" rx="2" fill="${color}"/>`)
  })
  parts.push(`<text x="${left + lessWidth + COLORS.length * 13 + 4}" y="${legendY + 9}" font-size="10" fill="${INK}">${s.more}</text>`)

  const width = left + weeks * step
  const height = legendY + 14
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"` +
    ` font-family="system-ui, -apple-system, Segoe UI, sans-serif">${parts.join('')}</svg>`
  return { svg, width, height }
}
