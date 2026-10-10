// The game itself: runs on the drawing thread with its own clock and keys.
import type { ClientModule } from 'claude-code'

import { CELL, CHROME_COLS, COLOR, MIN_COLS, MIN_ROWS, gridSize, paint, runs } from './board'
import { newGame, step, turn } from './snake'
import type { Dir, Game } from './snake'

// `columns` and `rows`: the room the pane gives, from the hook. The board sizes from these,
// not from the region's own layout: the desktop fits a region to what it draws, so a
// region measured while showing one line of text stays one line tall.
export type GameProps = { isPlaying: boolean; best: number; columns: number; rows: number }
type Local = { game: Game | null; live: { props: GameProps }; flash: number }

const TICK_MS = 120
const FLASH_TICKS = 6 // a crash shows for about three quarters of a second
const KEYS: Record<string, Dir> = { up: 'up', down: 'down', left: 'left', right: 'right', w: 'up', s: 'down', a: 'left', d: 'right' }

const SnakeGame: ClientModule<GameProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  const room = (p: GameProps) => ({ columns: p.columns > 0 ? p.columns : surface.columns, rows: p.rows > 0 ? p.rows : surface.rows })
  const { cols, rows } = gridSize(room(props).columns, room(props).rows)

  if (surface.state === undefined) {
    const local: Local = { game: null, live: { props }, flash: 0 }
    surface.every(TICK_MS, () => {
      const now = surface.state
      if (!now) return
      const r0 = room(now.live.props)
      const size = gridSize(r0.columns, r0.rows)
      if (size.cols < MIN_COLS || size.rows < MIN_ROWS) return
      if (!now.game || now.game.cols !== size.cols || now.game.rows !== size.rows) {
        surface.setState({ ...now, game: newGame(size.cols, size.rows, Date.now() % 100000) }) // a new or resized pane
        return
      }
      if (now.flash > 0) {
        surface.setState({ ...now, flash: now.flash - 1 }) // a crash holds the board still for a moment
        return
      }
      if (!now.live.props.isPlaying) return
      const r = step(now.game)
      if (r.ate || r.crashed) surface.post({ score: r.game.score })
      surface.setState({ ...now, game: r.game, flash: r.crashed ? FLASH_TICKS : 0 })
    })
    surface.onKey(e => {
      const now = surface.state
      const dir = KEYS[e.key.toLowerCase()]
      if (!now?.game || !dir || !now.live.props.isPlaying || now.flash > 0) return // paused: keys do nothing
      surface.setState({ ...now, game: turn(now.game, dir) })
    })
    surface.setState(local)
    return <Text dimColor>Loading Snake…</Text>
  }

  const local = surface.state
  local.live.props = props // the clock and keys read the latest props

  if (cols < MIN_COLS || rows < MIN_ROWS) return <Text dimColor>{`Make the pane bigger to play (${room(props).columns}×${room(props).rows})`}</Text>

  const game = local.game
  if (!game || game.cols !== cols || game.rows !== rows) return <Text dimColor>Setting up the board…</Text>

  const isPaused = !props.isPlaying
  const isCrash = local.flash > 0
  const best = Math.max(props.best, game.score)
  const blink = Math.floor(Date.now() / 400) % 2
  const cells = paint(game, blink, isPaused)
  const frame = isCrash ? COLOR.frameCrash : isPaused ? COLOR.frameOff : COLOR.frame
  const width = game.cols * CELL + CHROME_COLS

  return (
    <Box flexDirection="column" alignItems="center" width={room(props).columns}>
      <Box width={width} justifyContent="space-between">
        <Text bold color={isPaused ? undefined : COLOR.frame} dimColor={isPaused}>SNAKE</Text>
        <Text>
          <Text>{`score ${game.score}`}</Text>
          <Text dimColor>{` · best ${best}`}</Text>
        </Text>
      </Box>
      <Box key="board" flexDirection="column" borderStyle="round" borderColor={frame}>
        {Array.from({ length: game.rows }, (_, y) => (
          <Box key={`row-${y}`} flexDirection="row" height={1}>
            {runs(game.cols, y, cells).map((r, i) => (
              <Box key={`run-${y}-${i}`} width={r.n * CELL} height={1} backgroundColor={r.color} />
            ))}
          </Box>
        ))}
      </Box>
      {isCrash ? <Text color={COLOR.frameCrash}>crashed</Text> : isPaused ? <Text color="yellow">{"⏸ Claude's done, your turn"}</Text> : <Text dimColor>arrows or WASD</Text>}
      <Text dimColor>{isPaused ? 'Paused until Claude works again' : 'Click to play · Esc gives the keys back'}</Text>
    </Box>
  )
}

export default SnakeGame
