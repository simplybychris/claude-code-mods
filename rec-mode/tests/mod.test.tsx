import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const BAR = '#6e7681'
const STATUS = '● REC · private data blurred · hover to reveal'
const SURFACES = ['desktop', 'terminal'] as const

// Stands for the engine beneath the mod: a Mac user, a store, the status line,
// and the app's own drawing, which records the props it was handed.
async function start($: Engine, on: On, stored: Record<string, unknown> = {}, env: Record<string, string> = { HOME: '/Users/tomek', USER: 'tomek' }) {
  mock.env(on, env)
  mock.store(on, stored)
  const status: (string | undefined)[] = []
  const handed: Record<string, any> = {}
  on('session.start', (_$, e) => ({ sessionId: 's', cwd: e.cwd }) as any)
  on('command.register', () => ({ value: undefined }) as any)
  on('ui.status', (_$, e) => {
    status.push(e.text)
    return { value: undefined } as any
  })
  on('ui.render', (_$, e) => {
    handed[e.component] = e.props
    return { type: 'engine', ref: 0 } as any
  })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
  return { status, handed }
}

const rec = ($: Engine, args = '') => $.command.run({ command: 'rec', args } as any)

const reply = (text: string) =>
  ({ plugin: 'rec-mode', component: 'AssistantMessage', requestId: 'msg-1', props: { text, isFirstOfReply: true } }) as const

type Node = { type?: string; props?: Record<string, unknown>; hover?: { scope?: string }; children?: unknown[] }

const textOf = (n: unknown): string =>
  typeof n === 'string' ? n : ((n as Node).children ?? []).map(textOf).join('')

// The blurred spots of a drawing: what each hides, and the scope that reveals it.
function bars(tree: RenderElement) {
  const out: { text: string; scope?: string }[] = []
  const walk = (n: unknown) => {
    if (typeof n !== 'object' || n === null) return
    const node = n as Node
    if (node.type === 'Text' && node.props?.backgroundColor === BAR && node.props?.color === BAR) {
      out.push({ text: textOf(node), scope: node.hover?.scope })
    }
    for (const c of node.children ?? []) walk(c)
  }
  walk(tree)
  return out
}

function markdown(tree: RenderElement) {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (typeof n !== 'object' || n === null) return
    const node = n as Node
    if (node.type === 'Markdown') out.push(String(node.props?.text))
    for (const c of node.children ?? []) walk(c)
  }
  walk(tree)
  return out
}

describe('rec-mode', () => {
  test('/rec turns it on and off, with the REC status line', async ($, on) => {
    const { status } = await start($, on)
    expect(status).toEqual([undefined])
    expect((await rec($)).text).toMatch(/^Recording mode on/)
    expect(status.at(-1)).toBe(STATUS)
    expect((await rec($, 'off')).text).toBe('Recording mode off.')
    expect(status.at(-1)).toBeUndefined()
    await rec($, 'on')
    await rec($, 'on')
    expect(status.at(-1)).toBe(STATUS)
  })

  test('on Windows the account comes from USERPROFILE', async ($, on) => {
    const { handed } = await start($, on, {}, { USERPROFILE: 'C:\\Users\\tomek' })
    await rec($, 'on')
    const ui = await $.ui.mount({ surface: 'desktop', plugin: 'rec-mode', component: 'CommandOutput', requestId: 'c1', props: { command: 'whoami', text: 'pc\\tomek' } } as any)
    expect((await ui.drawn()).type).toBe('engine')
    expect(handed.CommandOutput.text).toBe('pc\\•••••')
    await ui.unmount()
  })

  test('a session starts on when it was left on', async ($, on) => {
    const { status } = await start($, on, { isOn: true })
    expect(status).toEqual([STATUS])
  })

  test('a reply with private data: grey bars a pointer reveals one by one, the rest stays Markdown', async ($, on) => {
    await start($, on)
    await rec($, 'on')
    const text = 'Serwer stoi na **203.0.113.20**, login `tomek`, mail ola@example.com.\n\nReszta odpowiedzi bez danych.'
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ surface, ...reply(text) } as any)
      const tree = await ui.drawn()
      const found = bars(tree)
      expect(found.map(b => b.text)).toEqual(['203.0.113.20', 'tomek', 'ola@example.com'])
      for (const b of found) expect(b.scope).toMatch(/^rec[0-9a-z]+-\d$/)
      expect(new Set(found.map(b => b.scope)).size).toBe(3)
      expect(markdown(tree)).toEqual(['Reszta odpowiedzi bez danych.'])
      await ui.unmount()
    }
  })

  test('a secret in a code fence is blurred inside a framed block', async ($, on) => {
    await start($, on)
    await rec($, 'on')
    const ui = await $.ui.mount({ surface: 'desktop', ...reply('Połącz się:\n\n```bash\nssh root@10.0.0.7\n```') } as any)
    const tree = await ui.drawn()
    expect(bars(tree).map(b => b.text)).toEqual(['10.0.0.7'])
    expect(markdown(tree)).toEqual(['Połącz się:'])
    await ui.unmount()
  })

  test('off, or nothing private: the app draws the reply itself', async ($, on) => {
    await start($, on)
    let ui = await $.ui.mount({ surface: 'desktop', ...reply('mail ola@example.com') } as any)
    expect((await ui.drawn()).type).toBe('engine')
    await ui.unmount()
    await rec($, 'on')
    ui = await $.ui.mount({ surface: 'desktop', ...reply('Nic prywatnego, wersja 2.1.293.') } as any)
    expect((await ui.drawn()).type).toBe('engine')
    await ui.unmount()
  })

  test('the prompt as typed is drawn with bars; a notification is masked with dots', async ($, on) => {
    const { handed } = await start($, on)
    await rec($, 'on')
    const prompt = {
      plugin: 'rec-mode',
      component: 'UserMessage',
      requestId: 'u1',
      props: { text: 'wyślij to na ola@example.com', origin: { kind: 'composer' }, isExpanded: true },
    }
    const ui = await $.ui.mount({ surface: 'desktop', ...prompt } as any)
    expect(bars(await ui.drawn()).map(b => b.text)).toEqual(['ola@example.com'])
    await ui.unmount()

    const note = { ...prompt, requestId: 'u2', props: { ...prompt.props, origin: { kind: 'task-notification' } } }
    const ui2 = await $.ui.mount({ surface: 'desktop', ...note } as any)
    expect((await ui2.drawn()).type).toBe('engine')
    expect(handed.UserMessage.text).toBe('wyślij to na •••••••••••••••')
    await ui2.unmount()
  })

  test('shell output with private data is drawn with bars', async ($, on) => {
    await start($, on)
    await rec($, 'on')
    const result = {
      plugin: 'rec-mode',
      component: 'ToolResult',
      requestId: 't1',
      props: {
        tool_use_id: 't1',
        tool: 'Bash',
        isErrored: false,
        output: { stdout: 'user.email=ola@example.com\ncore.editor=vim\n', stderr: '', interrupted: false },
      },
    }
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ surface, ...result } as any)
      const tree = await ui.drawn()
      expect(bars(tree).map(b => b.text)).toEqual(['ola@example.com'])
      expect(textOf(tree)).toBe('user.email=ola@example.comcore.editor=vim')
      await ui.unmount()
    }
  })

  test('rows the app draws itself get dots: a tool call and its output', async ($, on) => {
    const { handed } = await start($, on)
    await rec($, 'on')
    const call = {
      plugin: 'rec-mode',
      component: 'ToolUse',
      requestId: 't2',
      props: {
        tool_use_id: 't2',
        tool: 'Read',
        input: { file_path: '/Users/tomek/.ssh/config' },
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
        output: { type: 'text', file: { filePath: '/Users/tomek/.ssh/config', content: 'HostName 203.0.113.20' } },
      },
    }
    const ui = await $.ui.mount({ surface: 'desktop', ...call } as any)
    expect((await ui.drawn()).type).toBe('engine')
    expect(handed.ToolUse.input).toEqual({ file_path: '/Users/•••••/.ssh/config' })
    expect(handed.ToolUse.output).toEqual({
      type: 'text',
      file: { filePath: '/Users/•••••/.ssh/config', content: 'HostName ••••••••••••' },
    })
    await ui.unmount()
  })
})
