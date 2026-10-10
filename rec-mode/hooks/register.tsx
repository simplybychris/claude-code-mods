// rec-mode: a recording mode for Claude Code. While it is on, emails, keys, IP
// addresses and user names are blurred on screen, and a pointer over a blurred
// spot reveals it. Only the drawing changes: Claude reads everything as before
// and the stored transcript is untouched. /rec turns it on and off.
//
// Replies, prompts and shell output are drawn by the mod, with the reveal on
// hover. Rows the app draws itself (a tool call's input, a file Read, the
// spinner, a command's output) get the same spots masked with dots instead.
import type { EngineInterface, Register } from 'claude-code'

import { findSpans, maskDeep, maskText } from './detect'
import type { Context } from './detect'
import { renderOutput, renderPrompt, renderReply } from './view'

const COMMAND = 'rec'
const STATUS = '● REC · private data blurred · hover to reveal'
const STORE_KEY = 'isOn'

// The module's state: a hot reload starts it over, and session.start reads it back.
let isOn = false
let ctx: Context = { users: [], names: [] }

async function turn($: EngineInterface, on: boolean) {
  isOn = on
  await $.store.set(STORE_KEY, on).catch(() => {})
  $.ui.status(on ? STATUS : undefined)
  $.ui.invalidate('ui.render')
}

function hasSecret(text: string) {
  return findSpans(text, ctx).length > 0
}

export const register: Register = (on, options) => {
  const names = String(options.names ?? '')
    .split(',')
    .map(n => n.trim())
    .filter(n => n.length > 0)
  ctx = { users: [], names }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const user = await $.env.get('USER').catch(() => undefined)
    const winUser = await $.env.get('USERNAME').catch(() => undefined)
    const home = await $.env.get('HOME').catch(() => undefined)
    const winHome = await $.env.get('USERPROFILE').catch(() => undefined)
    const users = [user, winUser, ...[home, winHome].map(h => h?.split(/[\\/]/).filter(Boolean).pop())].filter(
      (u): u is string => typeof u === 'string',
    )
    ctx = { users, names }
    await $.command
      .register({
        name: COMMAND,
        description: 'Recording mode: blur emails, keys, IP addresses and user names on screen',
        argumentHint: '[on|off]',
      })
      .catch(() => {})
    isOn = (await $.store.get(STORE_KEY).catch(() => false)) === true
    $.ui.status(isOn ? STATUS : undefined)
    $.ui.invalidate('ui.render')
    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const want = arg === 'on' ? true : arg === 'off' ? false : !isOn
    await turn($, want)
    return {
      text: want
        ? 'Recording mode on: emails, keys, IP addresses and user names are blurred. Hover over a blurred spot to reveal it.'
        : 'Recording mode off.',
    }
  })

  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    if (!isOn || !hasSecret(e.props.text)) return next(e)
    return renderReply($.ui.resolve(e), e.props.text, ctx, e.requestId)
  })

  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    if (!isOn || !hasSecret(e.props.text)) return next(e)
    const kind = e.props.origin.kind
    if (kind === 'composer' || kind === 'bridge') return renderPrompt($.ui.resolve(e), e.props.text, ctx, e.requestId)
    return next({ ...e, props: { ...e.props, text: maskText(e.props.text, ctx) } })
  })

  on('ui.render', { component: 'ToolResult' }, ($, e, next) => {
    if (!isOn) return next(e)
    const out = e.props.output
    if (e.props.tool === 'Bash' && !e.props.isErrored && out !== null && typeof out === 'object') {
      const { stdout, stderr } = out as { stdout?: unknown; stderr?: unknown }
      const text = [stdout, stderr].filter((s): s is string => typeof s === 'string' && s.length > 0).join('\n')
      return hasSecret(text) ? renderOutput($.ui.resolve(e), text, ctx, e.requestId) : next(e)
    }
    const output = maskDeep(out, ctx)
    return output === out ? next(e) : next({ ...e, props: { ...e.props, output } })
  })

  on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
    if (!isOn) return next(e)
    const props = { ...e.props }
    const input = maskDeep(e.props.input, ctx)
    if (input !== e.props.input) props.input = input
    if ('output' in e.props) {
      const output = maskDeep(e.props.output, ctx)
      if (output !== e.props.output) props.output = output
    }
    return props.input === e.props.input && props.output === e.props.output ? next(e) : next({ ...e, props })
  })

  on('ui.render', { component: 'CommandOutput' }, ($, e, next) => {
    if (!isOn || e.props.command === COMMAND) return next(e)
    const text = maskText(e.props.text, ctx)
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
  })

  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    if (!isOn) return next(e)
    const word = maskText(e.props.word, ctx)
    const message = e.props.message === null ? null : maskText(e.props.message, ctx)
    if (word === e.props.word && message === e.props.message) return next(e)
    return next({ ...e, props: { ...e.props, word, message } })
  })
}
