// Snake: play in a pane while Claude works; it pauses when Claude is done.
// Nothing opens until /snake; /snake again (or /snake off) turns it off.
// From hamzafer/claude-code-mods (MIT, see LICENSE). Its state lives in this module
// instead of the atom helpers, which Claude Code 2.1.288 refuses to load.
import type { Register } from 'claude-code'

const PANE = 'snake'
const BEST_KEY = 'best'
const DEFAULT_ROWS = 18 // when a surface reports no body rows

export const register: Register = on => {
  let isOn = false // /snake turned it on
  let isWorking = false // a main-loop turn is running, whether or not Snake is on
  let score = 0
  let best = 0

  const isPlaying = () => isOn && isWorking

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command
      .register({ name: 'snake', description: 'Turn Snake on or off: it plays in a pane while Claude works', argumentHint: '[on|off]' })
      .catch(() => {})
    const saved = Number(await $.store.get(BEST_KEY).catch(() => 0)) || 0
    best = Math.max(best, saved)
    return r
  })

  on('turn.start', async ($, e, next) => {
    isWorking = true
    if (!isOn) return next(e) // opt-in: nothing until /snake
    $.ui.invalidate('ui.render')
    void $.ui.open({ id: PANE, title: 'Snake' }).catch(() => {}) // seats from 144 columns when opened unasked
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) {
      isWorking = false
      $.ui.invalidate('ui.render')
    }
    return r
  })

  on('command.run', { command: 'snake' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (!['', 'on', 'off', 'stop'].includes(arg)) return { text: 'usage: /snake toggles it, /snake on or /snake off says which' }
    // A bare /snake toggles; `on`, `off` and `stop` say which.
    const isOff = arg === 'stop' || arg === 'off' || (arg !== 'on' && isOn)
    if (isOff) {
      isOn = false
      $.ui.invalidate('ui.render')
      await $.ui.close({ id: PANE })
      return { text: 'Snake is off. /snake (or /snake on) turns it back on.' }
    }
    isOn = true // turned on mid-turn: it plays now, not next turn
    $.ui.invalidate('ui.render')
    await $.ui.open({ id: PANE, title: 'Snake', focus: true })
    return { text: 'Snake is on. It plays while Claude works. /snake again turns it off.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>Snake plays in the terminal or desktop app.</Text>
    }
    const { Client } = $.ui.resolve(e)
    // An exact size, and the same numbers handed to the game: a percentage height has
    // nothing to stretch against inside a pane, and the desktop fits a region to its content.
    const width = Math.max(1, e.props.bodyColumns)
    const height = e.props.scroll.bodyRows > 1 ? e.props.scroll.bodyRows - 1 : DEFAULT_ROWS
    const props = { isPlaying: isPlaying(), best, columns: width, rows: height }
    return <Client key="snake" module="./game.tsx" props={props} width={width} height={height} />
  })

  // The game posts its score whenever it eats or crashes.
  on('ui.message', async ($, e) => {
    const data = e.data as { score?: unknown }
    if (e.element !== 'snake' || typeof data?.score !== 'number') return {}
    score = data.score
    if (score > best) {
      best = score
      await $.store.set(BEST_KEY, best)
    }
    $.ui.invalidate('ui.render')
    return {}
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!isPlaying() || score === 0) return next(e)
    const text = e.props.message ?? e.props.word
    return next({ ...e, props: { ...e.props, message: `${text} · 🐍 ${score} (best ${best})` } })
  })
}
