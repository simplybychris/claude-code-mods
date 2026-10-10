// Snake's board: pure functions over plain values (sizes, colors, runs), no $ and no timers.
import type { Game } from './snake'

export const MIN_COLS = 10
export const MIN_ROWS = 6
const MAX_COLS = 36 // a board past this on a wide pane is mostly empty: it is centered instead
const MAX_ROWS = 24
export const CELL = 2 // columns a cell is wide: two of a terminal's make a square
const CHROME_ROWS = 4 // header, footer and the two rows of the frame
export const CHROME_COLS = 2 // the frame's sides

// Every cell is a box with a background and no glyph: a glyph (the desktop's `█` is wider than
// its cell) wraps a row into two and shears the grid, a box is exactly as many cells as it says.
export const COLOR = {
  bandA: '#161b22',
  bandB: '#1a2029',
  head: '#c4ff7a',
  tailFrom: '#52d65c', // the neck
  tailTo: '#1f6f33', // the tip
  food: ['#ff5f5f', '#ffa3a3'] as const, // it blinks between the two
  frame: '#3fb950',
  frameOff: '#444c56',
  frameCrash: '#f85149',
  rest: '#22272e', // what a paused board fades toward
}

// Cells across and down for the room given: a cell is two columns wide, the frame takes the
// sides, a header and a footer line sit around the board.
export function gridSize(columns: number, rows: number) {
  return { cols: Math.min(MAX_COLS, Math.floor((columns - CHROME_COLS) / CELL)), rows: Math.min(MAX_ROWS, rows - CHROME_ROWS) }
}

// The color of every cell that is not empty: a gradient from neck to tip, a blinking food.
// A paused board fades toward the rest color.
export function paint(game: Game, blink: number, isPaused: boolean) {
  const fade = (c: string) => (isPaused ? mix(c, COLOR.rest, 0.6) : c)
  const cells = new Map<string, string>()
  cells.set(`${game.food.x},${game.food.y}`, fade(COLOR.food[blink]!))
  const tail = Math.max(1, game.snake.length - 2)
  game.snake.forEach((c, i) => cells.set(`${c.x},${c.y}`, fade(i === 0 ? COLOR.head : mix(COLOR.tailFrom, COLOR.tailTo, (i - 1) / tail))))
  return cells
}

// One row as runs of same-colored cells, so a row is a few boxes, not one per cell. An empty
// cell takes a band color by its row: the faint stripes make the grid readable.
export function runs(cols: number, y: number, cells: Map<string, string>) {
  const band = y % 2 === 0 ? COLOR.bandA : COLOR.bandB
  const out: { color: string; n: number }[] = []
  for (let x = 0; x < cols; x++) {
    const color = cells.get(`${x},${y}`) ?? band
    const last = out[out.length - 1]
    if (last && last.color === color) last.n += 1
    else out.push({ color, n: 1 })
  }
  return out
}

// A blend of two `#rrggbb` colors, `t` of the way from `a` to `b`.
export function mix(a: string, b: string, t: number) {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  const to = (i: number) =>
    Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * Math.min(1, Math.max(0, t)))
      .toString(16)
      .padStart(2, '0')
  return `#${to(0)}${to(1)}${to(2)}`
}
