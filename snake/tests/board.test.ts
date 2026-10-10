import { describe, expect, test } from 'claude-code/testing'

import { COLOR, gridSize, mix, paint, runs } from '../hooks/board'
import { newGame } from '../hooks/snake'

describe('snake board', () => {
  test('cells fit the room, with the frame and a header and footer', () => {
    expect(gridSize(60, 19)).toEqual({ cols: 29, rows: 15 })
    expect(gridSize(10, 8)).toEqual({ cols: 4, rows: 4 })
    expect(gridSize(200, 80)).toEqual({ cols: 36, rows: 24 }) // a wide pane: capped, the board is centered
  })

  test('a row is runs of same-colored cells that add up to its width', () => {
    const game = newGame(20, 10, 1)
    const cells = paint(game, 0, false)
    for (let y = 0; y < 10; y++) expect(runs(20, y, cells).reduce((n, r) => n + r.n, 0)).toBe(20)
    const empty = runs(20, 0, new Map())
    expect(empty).toEqual([{ color: COLOR.bandA, n: 20 }])
    expect(runs(20, 1, new Map())[0]!.color).toBe(COLOR.bandB) // rows alternate faintly
  })

  test('the head is bright, the body fades toward the tip, the food blinks', () => {
    const game = { ...newGame(20, 10, 1), food: { x: 0, y: 0 } }
    const cells = paint(game, 0, false)
    const [head, neck, tip] = game.snake.map(c => cells.get(`${c.x},${c.y}`))
    expect(head).toBe(COLOR.head)
    expect(neck).toBe(COLOR.tailFrom)
    expect(tip).toBe(COLOR.tailTo)
    expect(cells.get('0,0')).toBe(COLOR.food[0])
    expect(paint(game, 1, false).get('0,0')).toBe(COLOR.food[1])
  })

  test('a paused board fades toward the rest color', () => {
    const game = { ...newGame(20, 10, 1), food: { x: 0, y: 0 } }
    const live = paint(game, 0, false).get(`${game.snake[0]!.x},${game.snake[0]!.y}`)!
    const paused = paint(game, 0, true).get(`${game.snake[0]!.x},${game.snake[0]!.y}`)!
    expect(paused).not.toBe(live)
    expect(paused).toBe(mix(COLOR.head, COLOR.rest, 0.6))
  })

  test('mixing colors', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mix('#102030', '#102030', 0.7)).toBe('#102030')
  })
})
