export type CacheTtl = '5m' | '1h'

// One plan window as the engine reports it: `five_hour`, `seven_day`, a gateway's `spend_limit`.
export type CacheBarLimit = { kind: string; percentUsed: number; resetsAt?: string }

// The last reading of the context window and the plan's windows.
export type CacheBarUsage = {
  tokens: number | null
  window: number
  percent: number | null
  limits: CacheBarLimit[]
}
