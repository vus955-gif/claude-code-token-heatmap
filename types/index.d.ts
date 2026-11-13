/** The four token counters of an API response, under readable names. */
export type Usage = {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

/** [input, output, cacheWrite, cacheRead], as scripts/aggregate.mjs prints them. */
export type UsageTuple = [number, number, number, number]

/** What scripts/aggregate.mjs prints. */
export type TokenReport = {
  generatedAt: number
  /** Today's local date (YYYY-MM-DD) on this machine. */
  today: string
  /** Local time of this report (HH:MM). */
  updatedLocal: string
  /** The machine's locale as Node.js reports it, e.g. "en-US" or "pl-PL". */
  locale: string
  /** API responses counted, each once. */
  messages: number
  /** Transcript files seen. */
  files: number
  reparsed: number
  errors: number
  /** days[YYYY-MM-DD][model] */
  days: Record<string, Record<string, UsageTuple>>
}

export type LoadStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  /**
   * `command` is set when Node.js could not be started at all, `timedOut` when
   * the count ran past its time limit and was stopped.
   */
  | { kind: 'error'; message: string; command?: string; timedOut?: boolean }

declare module 'claude-code' {
  interface PluginState {
    'token-heatmap': {
      report: TokenReport | null
      status: LoadStatus
    }
  }
}
