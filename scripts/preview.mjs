// Draws docs/preview-light.svg and docs/preview-dark.svg for the README: the
// pane filled with synthetic data. The heatmap is the plugin's own renderer
// (hooks/lib.ts); the frame, header and tiles approximate how Claude Code draws
// the pane's boxes and text.
//
// Run from the repository root: node scripts/preview.mjs
// (Node.js 23.6+ imports .ts directly; on Node.js 22 add --experimental-strip-types)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { STRINGS, formatCount, formatTokens, heatmapSvg, shortLabel, summarize, summaryOf } from '../hooks/lib.ts'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TODAY = '2026-10-02'
const LANG = 'en'
const DAY_MS = 86_400_000

// A deterministic pseudo-random history of about ten months: busier weekdays,
// quieter weekends, use growing towards today.
let seed = 20261002
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}
const split = total => {
  const input = Math.round(total * 0.0001)
  const output = Math.round(total * 0.005)
  const cacheWrite = Math.round(total * 0.03)
  return [input, output, cacheWrite, total - input - output - cacheWrite]
}

const days = {}
let responses = 0
const end = Date.UTC(2026, 9, 2)
for (let i = 0; i < 310; i++) {
  const date = new Date(end - i * DAY_MS)
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6
  const quiet = i < 150 ? 0 : 0.25
  if (rand() < (weekend ? 0.55 : 0.15) + quiet) continue
  const scale = (i < 42 ? 1 : i < 150 ? 0.45 : 0.2) * (weekend ? 0.4 : 1)
  const total = Math.round((25 + rand() * 520) * 1e6 * scale)
  const main = Math.round(total * (0.75 + rand() * 0.2))
  days[date.toISOString().slice(0, 10)] = {
    'claude-opus-5-5': split(main),
    'claude-sonnet-5-5': split(total - main),
  }
  responses += Math.round(total / 380_000)
}

const report = {
  generatedAt: end,
  today: TODAY,
  updatedLocal: '12:00',
  locale: 'en-US',
  messages: responses,
  files: 214,
  reparsed: 0,
  errors: 0,
  days,
}

const THEMES = {
  light: { bg: '#ffffff', frame: '#d0d7de', text: '#1f2328', dim: '#59636e' },
  dark: { bg: '#0d1117', frame: '#30363d', text: '#e6edf3', dim: '#9198a1' },
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function draw(theme) {
  const c = THEMES[theme]
  const s = STRINGS[LANG]
  const W = 780
  const pad = 20
  const byDay = summarize(report)
  const sum = summaryOf(byDay, report.today)
  const parts = []

  parts.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="HEIGHT" rx="10" fill="${c.bg}" stroke="${c.frame}"/>`)
  parts.push(`<text x="${pad}" y="30" font-size="15" font-weight="600" fill="${c.text}">${esc(s.title)}</text>`)
  parts.push(`<text x="${W - pad}" y="30" font-size="12" fill="${c.dim}" text-anchor="end">/tokens</text>`)
  parts.push(`<line x1="${pad}" y1="44" x2="${W - pad}" y2="44" stroke="${c.frame}"/>`)

  // Header: what is counted, and the Refresh button.
  parts.push(`<text x="${pad}" y="70" font-size="12" fill="${c.dim}">${esc(s.counted)}</text>`)
  parts.push(`<rect x="${W - pad - 74}" y="54" width="74" height="24" rx="6" fill="none" stroke="${c.frame}"/>`)
  parts.push(`<text x="${W - pad - 37}" y="70" font-size="12" fill="${c.text}" text-anchor="middle">${esc(s.refresh)}</text>`)

  // Tiles.
  const tiles = [
    [s.total, formatTokens(sum.total, LANG)],
    [s.today, formatTokens(sum.today, LANG)],
    [s.last7, formatTokens(sum.last7, LANG)],
    [s.average, formatTokens(sum.average, LANG)],
    [s.best, sum.best ? `${formatTokens(sum.best.total, LANG)} · ${shortLabel(sum.best.key, LANG)}` : '—'],
  ]
  const gap = 10
  const tileW = (W - 2 * pad - gap * (tiles.length - 1)) / tiles.length
  tiles.forEach(([label, value], i) => {
    const x = pad + i * (tileW + gap)
    parts.push(`<rect x="${x}" y="92" width="${tileW}" height="56" rx="8" fill="none" stroke="${c.frame}"/>`)
    parts.push(`<text x="${x + 12}" y="113" font-size="11" fill="${c.dim}">${esc(label)}</text>`)
    parts.push(`<text x="${x + 12}" y="136" font-size="17" font-weight="600" fill="${c.text}">${esc(value)}</text>`)
  })

  // The heatmap, drawn by the plugin's renderer.
  const map = heatmapSvg(byDay, report.today, W - 2 * pad, LANG)
  const mapY = 168
  parts.push(map.svg.replace('<svg ', `<svg x="${pad}" y="${mapY}" `))

  const footerY = mapY + map.height + 26
  parts.push(
    `<text x="${pad}" y="${footerY}" font-size="11" fill="${c.dim}">${esc(
      s.footer(formatCount(sum.activeDays, LANG), formatCount(report.messages, LANG), formatCount(report.files, LANG), report.updatedLocal),
    )}</text>`,
  )

  const H = footerY + 20
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"` +
    ` font-family="system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif">` +
    parts.join('').replace('HEIGHT', String(H - 1)) +
    '</svg>\n'
  )
}

fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
for (const theme of Object.keys(THEMES)) {
  const file = path.join(root, 'docs', `preview-${theme}.svg`)
  fs.writeFileSync(file, draw(theme))
  console.log(`wrote ${path.relative(root, file)}`)
}
