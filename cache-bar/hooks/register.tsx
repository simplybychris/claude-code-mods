// cache-bar: one colored line above the prompt. How long the prompt cache stays
// warm, how full the context window is, and the plan's 5-hour and weekly usage.
// It only reads figures Claude Code already holds: no model calls, no network.
// Ideas from token-weather and usage-meter in hamzafer/claude-code-mods (MIT).
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { CacheBarLimit, CacheBarUsage, CacheTtl } from '../types'

const TTL_MS: Record<CacheTtl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }
const TICK_MS = 15_000
const WARN_SHARE = 0.2 // amber under this share of the cache lifetime
const LIMIT_LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'week' }
const HANDOFF_PERCENT = 50 // the handoff button shows from this share of the context window
const HANDOFF_LABEL = 'handoff →'
const HANDOFF_SKILL = 'session-handoff'
const HANDOFF_PROMPT = `Użyj skilla ${HANDOFF_SKILL} i zapisz handoff tej sesji.`
const HANDOFF_MISSING = `handoff: brak skilla ${HANDOFF_SKILL}, zobacz README moda cache-bar`

const COLOR = {
  green: '#3fb950',
  amber: '#d29922',
  red: '#f85149',
  blue: '#58a6ff',
  violet: '#bc8cff',
  muted: '#8b949e',
  sep: '#6e7681',
}

type Seg = { text: string; color?: string; dim?: boolean; bold?: boolean }

export const register: Register = (on, options) => {
  const override: CacheTtl | null = options.cacheTtl === '5m' || options.cacheTtl === '1h' ? options.cacheTtl : null
  let configured: CacheTtl | null = null // from the environment or settings, read at session start
  let latest: CacheBarUsage | null = null // the last reading of the context and the plan's windows
  let lastRequestAt: number | null = null // when the last main-thread request started; null before one
  let timer: Timer | undefined
  const resetClock: Record<string, string> = {} // resetsAt → local time, from the system clock

  // The lifetime Claude Code asks for: 1h on a subscription within its limits, 5m otherwise.
  const ttl = (): CacheTtl => {
    if (override) return override
    if (configured) return configured
    if (!latest || latest.limits.length === 0) return '5m'
    return latest.limits.some(l => l.percentUsed >= 100) ? '5m' : '1h'
  }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    configured = await configuredTtl($)
    const now = await $.session.usage().catch(() => null)
    if (now) {
      latest = reading(now.context, now.rateLimits)
      labelResets(latest.limits, resetClock)
    }
    $.ui.invalidate('ui.render')
    timer?.cancel()
    // Redraws only while a countdown moves, and once more as it goes cold.
    timer = $.clock.every(TICK_MS, () => {
      void (async () => {
        if (lastRequestAt === null) return
        if ((await $.clock.now()) - lastRequestAt > TTL_MS[ttl()] + TICK_MS) return
        $.ui.invalidate('ui.render')
      })().catch(() => {})
    })
    return result
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    latest = reading(e.context, e.rateLimits)
    labelResets(latest.limits, resetClock)
    $.ui.invalidate('ui.render')
    return result
  })

  // Each main-thread request reads or writes the cache, and the lifetime counts from its start.
  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    const result = yield* next(e)
    if (!e.agentId && result.stopReason !== null) {
      lastRequestAt = startedAt
      $.ui.invalidate('ui.render')
    }
    return result
  })

  // A /clear or a resume leaves the cached conversation behind; a compaction rewrites it.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') lastRequestAt = null
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    lastRequestAt = null
    $.ui.invalidate('ui.render')
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what Claude Code and other mods draw here stays
    if (e.props.hasSurvey || !latest) return rest

    const now = await $.clock.now()
    const left = lastRequestAt === null ? null : lastRequestAt + TTL_MS[ttl()] - now
    // Past half the window, a button on the right starts a handoff (between turns only).
    const isHandoff = !e.props.isWorking && contextPercent(latest) >= HANDOFF_PERCENT
    const room = e.props.bodyColumns - 2 - (isHandoff ? HANDOFF_LABEL.length + 6 : 0)
    const segs = fit(latest, left, ttl(), now, resetClock, room)
    if (segs.length === 0 && !isHandoff) return rest

    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" paddingX={1} justifyContent="space-between">
          <Box flexDirection="row">
            {segs.map((s, i) => (
              <Text key={`seg-${i}`} color={s.color} dimColor={s.dim} bold={s.bold} wrap="truncate">
                {s.text}
              </Text>
            ))}
          </Box>
          {isHandoff && (
            <Button
              key="handoff"
              label={HANDOFF_LABEL}
              hotkey="h"
              variant="primary"
              onPress={() => {
                void (async () => {
                  const commands = await $.command.list().catch(() => null)
                  if (commands && !commands.some(c => c.name === HANDOFF_SKILL || c.name.endsWith(`:${HANDOFF_SKILL}`))) {
                    $.ui.toast(HANDOFF_MISSING)
                    return
                  }
                  await $.prompt.submit({ text: HANDOFF_PROMPT, asUser: true })
                })().catch(() => {})
              }}
            />
          )}
        </Box>
        {rest}
      </Box>
    )
  })
}

function reading(context: { tokens?: number; window: number; percent?: number }, limits: readonly CacheBarLimit[]): CacheBarUsage {
  return {
    tokens: context.tokens ?? null,
    window: context.window,
    percent: context.percent ?? null,
    limits: limits
      .filter(l => Number.isFinite(l.percentUsed))
      .map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
  }
}

async function configuredTtl($: EngineInterface): Promise<CacheTtl | null> {
  const fromEnv = await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL').catch(() => undefined)
  if (fromEnv === '5m' || fromEnv === '1h') return fromEnv
  const settings = (await $.settings.read().catch(() => null)) as { promptCacheTtl?: unknown } | null
  const fromSettings = settings?.promptCacheTtl
  return fromSettings === '5m' || fromSettings === '1h' ? fromSettings : null
}

// When each window resets, in the local time zone.
function labelResets(limits: readonly CacheBarLimit[], into: Record<string, string>) {
  for (const l of limits) {
    if (!l.resetsAt || into[l.resetsAt] !== undefined) continue
    const ms = Date.parse(l.resetsAt)
    if (!Number.isFinite(ms)) continue
    const text = localTime(ms, l.kind === 'seven_day')
    if (text) into[l.resetsAt] = text
  }
}

function localTime(ms: number, withDay: boolean) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      ...(withDay ? { weekday: 'short' as const } : {}),
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(ms))
    const part = (type: string) => parts.find(p => p.type === type)?.value ?? ''
    const time = `${part('hour')}:${part('minute')}`
    return withDay ? `${part('weekday')} ${time}` : time
  } catch {
    return ''
  }
}

// The widest line that fits: roomy first, then tighter, then the weekly window and the plan go.
function fit(u: CacheBarUsage, left: number | null, ttl: CacheTtl, now: number, clock: Record<string, string>, columns: number): Seg[] {
  const cache = cacheSegs(left, ttl)
  const ctx = ctxSegs(u)
  const fiveHour = limitSegs(u, 'five_hour', now, clock)
  const week = limitSegs(u, 'seven_day', now, clock)
  const variants = [
    join([cache, ctx, fiveHour, week], WIDE),
    join([cache, ctx, fiveHour, week], NARROW),
    join([cache, ctx, fiveHour], NARROW),
    join([cache, ctx], NARROW),
    join([cache], NARROW),
  ]
  return variants.find(v => width(v) <= columns) ?? variants[variants.length - 1] ?? []
}

const WIDE = '   │   '
const NARROW = '  │  '

function cacheSegs(left: number | null, ttl: CacheTtl): Seg[] {
  if (left === null) return [] // no request yet this session
  if (left <= 0) return [{ text: '○ cache cold', color: COLOR.red, bold: true }]
  const isLow = left < TTL_MS[ttl] * WARN_SHARE
  const color = isLow ? COLOR.amber : COLOR.green
  return [
    { text: isLow ? '◐ cache cooling ' : '● cache warm ', color },
    { text: minutes(left), color, bold: true },
  ]
}

function contextPercent(u: CacheBarUsage) {
  if (u.tokens === null) return 0
  return u.percent ?? Math.round((u.tokens / Math.max(1, u.window)) * 100)
}

function ctxSegs(u: CacheBarUsage): Seg[] {
  if (u.tokens === null) return []
  const percent = contextPercent(u)
  const color = percent >= 75 ? COLOR.red : percent >= 50 ? COLOR.amber : COLOR.blue
  return [
    { text: 'ctx ', color: COLOR.muted },
    { text: short(u.tokens), color, bold: true },
  ]
}

// The 5-hour window always says when it resets; the week only once it runs high.
function limitSegs(u: CacheBarUsage, kind: string, now: number, clock: Record<string, string>): Seg[] {
  const l = u.limits.find(w => w.kind === kind)
  if (!l) return []
  const p = l.percentUsed
  const color = p >= 85 ? COLOR.red : p >= 60 ? COLOR.amber : COLOR.green
  const segs: Seg[] = [
    { text: `${LIMIT_LABELS[kind]} `, color: COLOR.muted },
    { text: `${Math.round(p)}%`, color, bold: true },
  ]
  const showReset = kind === 'five_hour' || p >= 75
  const until = l.resetsAt ? Date.parse(l.resetsAt) - now : NaN
  if (showReset && Number.isFinite(until) && until > 0) {
    const at = l.resetsAt ? clock[l.resetsAt] : undefined
    segs.push({ text: at ? ` · resets ${at}` : ` · resets in ${duration(until)}`, color: COLOR.violet })
  }
  return segs
}

function join(parts: Seg[][], separator: string): Seg[] {
  return parts
    .filter(p => p.length > 0)
    .flatMap((p, i) => (i === 0 ? p : [{ text: separator, color: COLOR.sep }, ...p]))
}

function width(segs: Seg[]) {
  return segs.reduce((n, s) => n + [...s.text].length, 0)
}

function minutes(ms: number) {
  return ms >= 60_000 ? `${Math.ceil(ms / 60_000)}m` : '<1m'
}

function duration(ms: number) {
  const m = Math.ceil(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h${String(m % 60).padStart(2, '0')}`
  return `${Math.round(h / 24)}d`
}

function short(tokens: number) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return String(tokens)
}
