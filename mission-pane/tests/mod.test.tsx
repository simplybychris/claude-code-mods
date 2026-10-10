import { describe, expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const PANE = {
  plugin: 'mission-pane',
  component: 'Pane',
  requestId: 'mission-pane',
  props: { title: 'Mission', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } },
}

const USAGE = { input_tokens: 1_000, output_tokens: 50, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 0, model: 'm' }

// Stands for the engine beneath the mod: subagents, tools, panes, toasts and the sound.
async function start($: Engine, on: On, agents: AgentInfo[] = [], transcripts: Record<string, unknown[]> = {}, files: Record<string, string> = {}) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const toasts: string[] = []
  const sounds: string[][] = []
  const open = new Set<string>()
  let taskSeq = 0
  on('session.start', (_$, e) => ({ sessionId: 's', cwd: e.cwd }) as any)
  on('command.register', () => ({ value: undefined }) as any)
  on('ui.toast', (_$, e) => {
    toasts.push((e as any).text)
    return { value: undefined } as any
  })
  on('process.run', (_$, e) => {
    sounds.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as any
  })
  on('ui.open', (_$, e) => {
    open.add(e.id)
    return { value: { isPlaced: true } } as any
  })
  on('ui.close', (_$, e) => {
    open.delete(e.id)
    return { value: undefined } as any
  })
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }) as any)
  on('agent.list', () => ({ value: agents }) as any)
  on('session.messages', (_$, e) => ({ value: transcripts[(e as any).agentId] ?? [] }) as any)
  on('fs.read', (_$, e) => ((e as any).path in files ? ({ value: files[(e as any).path] } as any) : ({ deny: 'ENOENT' } as any)))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as any)
  on('turn.complete', () => ({ text: '' }) as any)
  on('prompt.submit', (_$, e) => ({ text: (e as any).text }) as any)
  on('classic.Stop', () => ({}) as any)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE } as any
  })
  on('tool.call', (_$, e) => {
    const input = e as any
    if (input.tool === 'Bash' && input.run_in_background) {
      taskSeq += 1
      const id = `b${taskSeq}`
      return {
        result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: id },
        isError: false,
        text: `Command running in background with ID: ${id}. Output is being written to: /tmp/t/tasks/${id}.output. You will be notified.`,
      } as any
    }
    if (input.tool === 'Bash' && input.command === 'npm test') return { result: 'Exit code 1', isError: true, text: 'exit 1: 2 failed\nmore' } as any
    if (input.tool === 'Grep') return { result: { mode: 'content' }, isError: false, text: '12 matches\nsrc/a.ts' } as any
    if (input.tool === 'Agent') return { result: { agentId: input.description === 'Find auth handlers' ? 'a1' : 'a2', content: [] }, isError: false } as any
    if (input.tool === 'Monitor') return { result: { taskId: 'm1', timeoutMs: 1000 }, isError: false } as any
    return { result: { stdout: 'ok', stderr: '', interrupted: false }, isError: false } as any
  })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
  return { clock, toasts, sounds, open }
}

async function step($: Engine, agentId: string) {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1, agentId } as any)
  for await (const _ of stream) {
    // drain
  }
  await stream.result
}

function bashInBackground($: Engine, description: string) {
  return $.tool.call({ tool: 'Bash', command: 'npm run build', description, run_in_background: true } as any)
}

describe('mission-pane', () => {
  test('/ops opens and closes the pane; empty, it says what shows up', async ($, on) => {
    const { open } = await start($, on)
    expect((await $.command.run({ command: 'ops', args: '' } as any)).text).toMatch(/Mission pane open/)
    expect(open.has('mission-pane')).toBe(true)
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE } as any)
    expect(await ui.find({ type: 'Text', text: /Nothing yet/ })).toBeDefined()
    await ui.unmount()
    expect((await $.command.run({ command: 'ops', args: '' } as any)).text).toMatch(/closed/)
    expect(open.has('mission-pane')).toBe(false)
  })

  test('a running subagent: type, label, tools, context, last action; then done with a toast and a sound', async ($, on) => {
    const agents: AgentInfo[] = [{ id: 'a1', description: 'Find auth handlers', type: 'Explore', status: 'running' }]
    const { clock, toasts, sounds } = await start($, on, agents)
    await step($, 'a1')
    await $.tool.call({ tool: 'Grep', pattern: 'useAuth', agentId: 'a1' } as any)
    await $.tool.call({ tool: 'Read', file_path: '/work/src/auth.ts', agentId: 'a1' } as any)
    await clock.advance(134_000)

    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({ surface, ...PANE } as any)
      expect(await ui.find({ type: 'Text', text: 'Explore' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Find auth handlers' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '2 tools' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '41k ctx' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '2m14s' })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: '→ Read auth.ts' }))?.props.color).toBe('#d2a8ff')
      await ui.unmount()
    }

    agents[0]!.status = 'completed'
    await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1' } as any)
    expect(toasts).toContain('✓ Explore · Find auth handlers · 2m14s')
    expect(sounds).toEqual([['afplay', '/System/Library/Sounds/Glass.aiff']])
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE } as any)
    expect(await ui.find({ type: 'Text', text: '✓' })).toBeDefined()
    await ui.unmount()
  })

  test('a background shell counts up, and its notification ends it', async ($, on) => {
    const { clock, toasts, sounds } = await start($, on)
    await bashInBackground($, 'Build the app')
    await clock.advance(65_000)
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE } as any)
    expect(await ui.find({ type: 'Text', text: 'shell' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Build the app' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1m05s' })).toBeDefined()

    await $.prompt.submit({
      text: '<task-notification><task-id>b1</task-id><status>failed</status></task-notification>',
      origin: { kind: 'task-notification' },
    } as any)
    expect(toasts).toContain('✗ shell · Build the app · 1m05s · failed')
    expect(sounds.length).toBe(1)
    expect(await ui.find({ type: 'Text', text: '✗' })).toBeDefined()
    await ui.unmount()
  })

  test('the stop list closes jobs that are gone and picks up ones started elsewhere', async ($, on) => {
    const { toasts } = await start($, on)
    await bashInBackground($, 'Run the tests')
    await $.classic.Stop({
      stop_hook_active: false,
      background_tasks: [{ id: 'x9', type: 'monitor', status: 'running', description: 'ngrok tail' }],
    } as any)
    expect(toasts).toContain('✓ shell · Run the tests · 0m00s')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE } as any)
    expect(await ui.find({ type: 'Text', text: 'ngrok tail' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'monitor' })).toBeDefined()
    await ui.unmount()
  })

  test('two running with the pane closed: one hint a turn; endings close together make one sound', async ($, on) => {
    const { toasts, sounds } = await start($, on)
    await $.turn.start({ text: 'go', turnId: 't1' } as any)
    await bashInBackground($, 'one')
    await bashInBackground($, 'two')
    await $.tool.call({ tool: 'Monitor', description: 'tail', timeout_ms: 1000, command: 'tail -f x' } as any)
    expect(toasts.filter(t => /running · \/ops/.test(t))).toEqual(['2 running · /ops'])

    await $.prompt.submit({ text: '<task-id>b1</task-id><status>completed</status>', origin: { kind: 'task-notification' } } as any)
    await $.prompt.submit({ text: '<task-id>b2</task-id><status>completed</status>', origin: { kind: 'task-notification' } } as any)
    expect(sounds.length).toBe(1)
  })

  test('clear done hides ended rows and keeps running ones', async ($, on) => {
    const { clock } = await start($, on)
    await bashInBackground($, 'old job')
    await $.prompt.submit({ text: '<task-id>b1</task-id><status>completed</status>', origin: { kind: 'task-notification' } } as any)
    await bashInBackground($, 'live job')
    await clock.advance(1_000)
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE } as any)
    expect(await ui.find({ type: 'Text', text: 'old job' })).toBeDefined()
    await ui.press({ key: 'clear' })
    expect(await ui.find({ type: 'Text', text: 'old job' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'live job' })).toBeDefined()
    await ui.unmount()
  })

  test('a row opens an agent: prompt, timeline with results and failures, messages, report; ◀ ▶ and back', async ($, on) => {
    const agents: AgentInfo[] = [
      { id: 'a1', description: 'Find auth handlers', type: 'Explore', status: 'running' },
      { id: 'a2', description: 'Write tests', type: 'general-purpose', status: 'running' },
    ]
    const transcripts = {
      a1: [
        { role: 'user', text: 'ignored: the Agent call gave the prompt', toolUses: [] },
        { role: 'assistant', text: 'Looking at the auth module first.', toolUses: [] },
      ],
      a2: [{ role: 'user', text: 'Write tests for the auth module.', toolUses: [] }],
    }
    const { clock } = await start($, on, agents, transcripts)
    await $.tool.call({ tool: 'Agent', description: 'Find auth handlers', prompt: 'Find every auth handler in src.\nList file and line.' } as any)
    await step($, 'a1')
    await clock.advance(3_000)
    await $.tool.call({ tool: 'Grep', pattern: 'useAuth', agentId: 'a1' } as any)
    await clock.advance(2_000)
    await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'a1' } as any)
    agents[0]!.status = 'completed'
    await $.turn.complete({ reason: 'answer', answer: '## Found\n3 handlers.', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1' } as any)
    await $.command.run({ command: 'ops', args: '' } as any)

    const ui = await $.ui.mount({ surface: 'desktop', ...PANE } as any)
    await ui.press({ key: 'open-agent-a1' })
    expect((await ui.find({ key: 'prompt-text' }))?.props.text).toBe('Find every auth handler in src.\nList file and line.')
    expect(await ui.find({ type: 'Text', text: '0:03' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Grep "useAuth"' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '→ 12 matches' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: '→ exit 1: 2 failed' }))?.props.color).toBe('#f85149')
    expect(await ui.find({ type: 'Text', text: 'Looking at the auth module first.' })).toBeDefined()
    expect((await ui.find({ key: 'report-text' }))?.props.text).toBe('## Found\n3 handlers.')

    await ui.press({ key: 'prev' }) // running rows first: a2 sits above a1
    expect((await ui.find({ key: 'prompt-text' }))?.props.text).toBe('Write tests for the auth module.')
    expect(await ui.find({ type: 'Text', text: 'Write tests' })).toBeDefined()
    await ui.press({ key: 'next' })
    expect(await ui.find({ type: 'Text', text: 'Find auth handlers' })).toBeDefined()

    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Text', text: 'AGENTS' })).toBeDefined()
    await ui.unmount()
  })

  test('a job opens to its command and the tail of its output, live', async ($, on) => {
    const files: Record<string, string> = { '/tmp/t/tasks/b1.output': '\u001b[32mstep 1\u001b[0m\nbuild 10%\rbuild 55%\n' }
    await start($, on, [], {}, files)
    await bashInBackground($, 'Build the app')
    const ui = await $.ui.mount({ surface: 'desktop', ...PANE } as any)
    await ui.press({ key: 'open-job-b1' })
    expect(await ui.find({ type: 'Text', text: 'npm run build' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'step 1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'build 55%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'build 10%' })).toBeUndefined()

    files['/tmp/t/tasks/b1.output'] += 'build 100%\ndone\n'
    await ui.press({ key: 'back' })
    await ui.press({ key: 'open-job-b1' })
    expect(await ui.find({ type: 'Text', text: 'done' })).toBeDefined()
    await ui.unmount()
  })

  test('a parent that stops while its children run is waiting, not done; it ends for real once', async ($, on) => {
    const agents: AgentInfo[] = [
      { id: 'p1', description: 'Coordinate', type: 'general-purpose', status: 'running' },
      { id: 'c1', description: 'Read rules', type: 'general-purpose', status: 'running', parentId: 'p1' },
    ]
    const { toasts } = await start($, on, agents)
    await step($, 'p1')
    await step($, 'c1')
    await $.turn.complete({ reason: 'answer', answer: 'started both', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'p1' } as any)
    expect(toasts.filter(t => t.includes('Coordinate'))).toEqual([]) // not announced as done

    const ui = await $.ui.mount({ surface: 'desktop', ...PANE } as any)
    expect((await ui.find({ type: 'Text', text: '◐' }))?.props.color).toBe('#d29922')
    expect(await ui.find({ type: 'Text', text: '→ waiting for 1 subagent' })).toBeDefined()
    await ui.unmount()

    agents[1]!.status = 'completed'
    await $.turn.complete({ reason: 'answer', answer: 'rules read', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'c1' } as any)
    await step($, 'p1') // the parent resumes with its child's result
    const resumed = await $.ui.mount({ surface: 'desktop', ...PANE } as any)
    expect(await resumed.find({ type: 'Text', text: '◐' })).toBeUndefined()
    await resumed.unmount()

    agents[0]!.status = 'completed'
    await $.turn.complete({ reason: 'answer', answer: 'compared', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'p1' } as any)
    expect(toasts.filter(t => t.includes('Coordinate')).length).toBe(1)
  })
})
