import { describe, expect, test } from 'claude-code/testing'

import { clip, describeCall, elapsed, firstLine, isDone, isFailure, offset, outputPath, parseNotification, short, tail } from '../hooks/ops'

describe('ops text', () => {
  test('describes a call in a few words', () => {
    expect(describeCall('Bash', { command: 'npm   test\n --watch=false' })).toBe('Bash npm test --watch=false')
    expect(describeCall('Bash', { command: 'x', description: 'Run the tests' })).toBe('Bash Run the tests')
    expect(describeCall('Read', { file_path: '/work/app/src/register.tsx' })).toBe('Read register.tsx')
    expect(describeCall('Grep', { pattern: 'useAuth' })).toBe('Grep "useAuth"')
    expect(describeCall('WebFetch', { url: 'https://docs.example.com/a/b' })).toBe('WebFetch docs.example.com')
    expect(describeCall('mcp__github__list_issues', {})).toBe('github list_issues')
    expect(describeCall('TodoWrite', {})).toBe('TodoWrite')
  })

  test('reads a task notification', () => {
    const text = '<task-notification>\n<task-id>b7x</task-id>\n<status>failed</status>\n<summary>exit 1</summary></task-notification>'
    expect(parseNotification(text)).toEqual({ id: 'b7x', status: 'failed' })
    expect(parseNotification('<task-id>m1</task-id>')).toEqual({ id: 'm1', status: 'completed' })
    expect(parseNotification('plain text')).toBeNull()
  })

  test('tells running from ended and failed', () => {
    expect(isDone('running')).toBe(false)
    expect(isDone('completed')).toBe(true)
    expect(isFailure('killed')).toBe(true)
    expect(isFailure('failed')).toBe(true)
    expect(isFailure('completed')).toBe(false)
  })

  test('formats time, tokens and long text', () => {
    expect(elapsed(65_000)).toBe('1m05s')
    expect(elapsed(3_725_000)).toBe('1h02m')
    expect(short(41_000)).toBe('41k')
    expect(short(1_250_000)).toBe('1.3M')
    expect(clip('x'.repeat(60), 10)).toBe('xxxxxxxxx…')
  })

  test('reads the first result line, the output path and a clean tail', () => {
    expect(firstLine('\n\n  12 matches\nsrc/a.ts')).toBe('12 matches')
    expect(outputPath('Command running in background with ID: b1. Output is being written to: /tmp/x/tasks/b1.output. You will be notified')).toBe('/tmp/x/tasks/b1.output')
    expect(outputPath('no path here')).toBeUndefined()
    expect(tail('\u001b[32mstep 1\u001b[0m\nprogress 10%\rprogress 55%\nlast line\n')).toEqual(['step 1', 'progress 55%', 'last line'])
    expect(tail(Array.from({ length: 50 }, (_, i) => `l${i}`).join('\n'), 3)).toEqual(['l47', 'l48', 'l49'])
    expect(offset(65_000)).toBe('1:05')
  })
})
