import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const T0 = 1_000_000
const SUBSCRIPTION = [
  { kind: 'five_hour', percentUsed: 10, resetsAt: new Date(T0 + 3 * 3_600_000).toISOString() },
  { kind: 'seven_day', percentUsed: 59, resetsAt: new Date(T0 + 4 * 86_400_000).toISOString() },
]

function band(bodyColumns = 140, hasSurvey = false, isWorking = false) {
  return {
    plugin: 'cache-bar',
    component: 'AbovePrompt',
    props: { hasSurvey, isWorking, maxRows: 10, bodyColumns },
  }
}

// Stands for the engine: the usage figures, one model request per step, and its own band.
async function start(
  $: Engine,
  on: On,
  rateLimits: unknown[] = SUBSCRIPTION,
  env: Record<string, string> = {},
  hasDate = true,
  context = { tokens: 109_000, window: 1_000_000, percent: 11 },
) {
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, env)
  // Stands for `date -r <secs> <format>`: the local time of a reset.
  on('process.run', (_$, e) =>
    hasDate
      ? ({ value: { exitCode: 0, stdout: e.argv[3]?.includes('%a') ? 'Sat 14:20\n' : '16:40\n', stderr: '' } } as any)
      : ({ deny: 'no date here' } as any),
  )
  on('settings.read', () => ({ value: {} }) as any)
  on('session.start', (_$, e) => ({ sessionId: 's', cwd: e.cwd }) as any)
  on('session.usage', () => ({
    value: { startedAt: 0, rateLimits, context },
  }) as any)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as any
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'engine band' }) as any
  })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
  return clock
}

async function request($: Engine, index: number, agentId?: string) {
  const stream = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) })
  for await (const _ of stream) {
    // drain
  }
  await stream.result
}

describe('cache-bar', () => {
  test('shows context and plan usage, no cache before the first request', async ($, on) => {
    await start($, on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ surface, ...band() } as any)
      expect(await ui.find({ type: 'Text', text: '109k' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '10%' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: ' · resets 16:40' })).toBeDefined() // the 5h window, always
      expect(await ui.find({ type: 'Text', text: '59%' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Sat/ })).toBeUndefined() // the week only when it runs high
      expect(await ui.find({ type: 'Text', text: /cache/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined() // stacked, not replaced
      await ui.unmount()
    }
  })

  test('counts an hour down on a subscription: warm, cooling, cold', async ($, on) => {
    const clock = await start($, on)
    await request($, 0)
    const ui = await $.ui.mount({ surface: 'desktop', ...band() } as any)
    const warm = await ui.find({ type: 'Text', text: '60m' })
    expect(warm?.props.color).toBe('#3fb950')

    await clock.advance(50 * 60_000)
    const cooling = await ui.find({ type: 'Text', text: '10m' })
    expect(cooling?.props.color).toBe('#d29922')
    expect(await ui.find({ type: 'Text', text: 'cache cooling ' })).toBeDefined()

    await clock.advance(11 * 60_000)
    const cold = await ui.find({ type: 'Text', text: '○ cache cold' })
    expect(cold?.props.color).toBe('#f85149')
    await ui.unmount()
  })

  test('uses five minutes without a subscription, and subagent steps do not count', async ($, on) => {
    const clock = await start($, on, [])
    await request($, 0)
    await clock.advance(4 * 60_000)
    await request($, 1, 'agent-1') // a subagent's own cache, not this conversation's
    const ui = await $.ui.mount({ surface: 'desktop', ...band() } as any)
    expect(await ui.find({ type: 'Text', text: '1m' })).toBeDefined()
    await clock.advance(61_000)
    expect(await ui.find({ type: 'Text', text: '○ cache cold' })).toBeDefined()
    await ui.unmount()
  })

  test('CLAUDE_CODE_PROMPT_CACHE_TTL wins over the subscription', async ($, on) => {
    await start($, on, SUBSCRIPTION, { CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' })
    await request($, 0)
    const ui = await $.ui.mount({ surface: 'desktop', ...band() } as any)
    expect(await ui.find({ type: 'Text', text: '5m' })).toBeDefined()
    await ui.unmount()
  })

  test('drops the week on a narrow band and yields to a survey', async ($, on) => {
    await start($, on)
    await request($, 0)
    const narrow = await $.ui.mount({ surface: 'terminal', ...band(60) } as any)
    expect(await narrow.find({ type: 'Text', text: 'week ' })).toBeUndefined()
    expect(await narrow.find({ type: 'Text', text: '60m' })).toBeDefined()
    expect(await narrow.find({ type: 'Text', text: '109k' })).toBeDefined()
    await narrow.unmount()

    const survey = await $.ui.mount({ surface: 'terminal', ...band(140, true) } as any)
    expect(await survey.find({ type: 'Text', text: /cache/ })).toBeUndefined()
    expect(await survey.find({ type: 'Text', text: 'engine band' })).toBeDefined()
    await survey.unmount()
  })

  test('the week shows its reset once past 75%, colored by how full it is', async ($, on) => {
    await start($, on, [
      { kind: 'five_hour', percentUsed: 88, resetsAt: new Date(T0 + 95 * 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 80, resetsAt: new Date(T0 + 3 * 86_400_000).toISOString() },
    ])
    const ui = await $.ui.mount({ surface: 'desktop', ...band() } as any)
    expect((await ui.find({ type: 'Text', text: '88%' }))?.props.color).toBe('#f85149')
    expect((await ui.find({ type: 'Text', text: '80%' }))?.props.color).toBe('#d29922')
    expect(await ui.find({ type: 'Text', text: ' · resets Sat 14:20' })).toBeDefined()
    await ui.unmount()
  })

  test('without the system clock the reset reads as time left', async ($, on) => {
    await start($, on, SUBSCRIPTION, {}, false)
    const ui = await $.ui.mount({ surface: 'desktop', ...band() } as any)
    expect(await ui.find({ type: 'Text', text: ' · resets in 3h00' })).toBeDefined()
    await ui.unmount()
  })

  test('past half the context window a handoff button asks for the session-handoff skill', async ($, on) => {
    const prompts: string[] = []
    on('prompt.submit', (_$, e) => {
      prompts.push((e as any).text)
      return { text: (e as any).text } as any
    })
    await start($, on, SUBSCRIPTION, {}, true, { tokens: 512_000, window: 1_000_000, percent: 51 })
    const idle = await $.ui.mount({ surface: 'desktop', ...band() } as any)
    expect(await idle.find({ type: 'Button', key: 'handoff' })).toBeDefined()
    await idle.press({ key: 'handoff' })
    expect(prompts).toEqual(['Użyj skilla session-handoff i zapisz handoff tej sesji.'])
    await idle.unmount()

    const working = await $.ui.mount({ surface: 'desktop', ...band(140, false, true) } as any)
    expect(await working.find({ type: 'Button', key: 'handoff' })).toBeUndefined() // not mid-turn
    await working.unmount()
  })

  test('no handoff button under half the window', async ($, on) => {
    await start($, on)
    const ui = await $.ui.mount({ surface: 'desktop', ...band() } as any)
    expect(await ui.find({ type: 'Button', key: 'handoff' })).toBeUndefined()
    await ui.unmount()
  })
})
