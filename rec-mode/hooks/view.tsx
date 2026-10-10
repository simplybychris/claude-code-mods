// rec-mode's drawing: text whose private spots are grey bars the length of what
// they hide; a pointer over a bar reveals it. Each bar has a hover scope of its
// own, so only the spot under the pointer opens.
import type { EngineInterface } from 'claude-code'

import { findSpans, pieces } from './detect'
import type { Context } from './detect'
import { lineSegments, splitBlocks } from './md'
import type { Segment, Style } from './md'

type UI = ReturnType<EngineInterface['ui']['resolve']>

export const COLOR = {
  bar: '#6e7681', // the blur: text and background in one grey
  revealText: '#f0f6fc',
  revealBack: '#30363d',
  code: '#79c0ff',
}

export const MAX_OUTPUT_LINES = 40

function hash(s: string) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** Hover scopes for one drawing: `rec<instance>-<n>`, well under the 64-character limit. */
export function scopes(requestId: string) {
  const base = `rec${hash(requestId)}`
  let n = 0
  return () => `${base}-${n++}`
}

type NextScope = () => string

function styleOf(style: Style) {
  if (style === 'bold') return { bold: true }
  if (style === 'code') return { color: COLOR.code }
  if (style === 'dim') return { dimColor: true }
  return {}
}

/** One line: plain text, styled segments, and blurred spots a pointer reveals. */
function line(ui: UI, segs: Segment[], ctx: Context, scope: NextScope) {
  const { Text } = ui
  const children = []
  for (const seg of segs) {
    for (const p of pieces(seg.text, ctx)) {
      if (p.isSecret) {
        children.push(
          <Text
            {...(seg.style === 'bold' ? { bold: true } : {})}
            color={COLOR.bar}
            backgroundColor={COLOR.bar}
            hover={{ scope: scope(), color: COLOR.revealText, backgroundColor: COLOR.revealBack }}
          >
            {p.text}
          </Text>,
        )
      } else if (seg.style === 'plain') {
        children.push(p.text)
      } else {
        children.push(<Text {...styleOf(seg.style)}>{p.text}</Text>)
      }
    }
  }
  return <Text>{children}</Text>
}

function plainLines(text: string): Segment[][] {
  return text.split('\n').map(l => [{ text: l.length > 0 ? l : ' ', style: 'plain' as const }])
}

/** A reply: blocks without private data stay Markdown, the others are drawn line by line. */
export function renderReply(ui: UI, text: string, ctx: Context, requestId: string) {
  const { Box, Markdown } = ui
  const scope = scopes(requestId)
  const parts = []
  let clean: string[] = []
  const flush = () => {
    if (clean.length > 0) parts.push(<Markdown text={clean.join('\n\n')} />)
    clean = []
  }
  for (const block of splitBlocks(text)) {
    if (findSpans(block.text, ctx).length === 0) {
      clean.push(block.text)
      continue
    }
    flush()
    if (block.kind === 'fence') {
      parts.push(
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          {plainLines(block.body.join('\n')).map(segs => line(ui, segs, ctx, scope))}
        </Box>,
      )
    } else {
      parts.push(<Box flexDirection="column">{block.text.split('\n').map(l => line(ui, lineSegments(l), ctx, scope))}</Box>)
    }
  }
  flush()
  return (
    <Box flexDirection="column" gap={1}>
      {parts}
    </Box>
  )
}

/** The person's prompt, as typed, in a frame. */
export function renderPrompt(ui: UI, text: string, ctx: Context, requestId: string) {
  const { Box } = ui
  const scope = scopes(requestId)
  return (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
      {plainLines(text).map(segs => line(ui, segs, ctx, scope))}
    </Box>
  )
}

/** A shell command's output, its first lines. */
export function renderOutput(ui: UI, text: string, ctx: Context, requestId: string) {
  const { Box, Text } = ui
  const scope = scopes(requestId)
  const lines = plainLines(text.replace(/\n+$/, ''))
  const more = lines.length - MAX_OUTPUT_LINES
  return (
    <Box flexDirection="column">
      {lines.slice(0, MAX_OUTPUT_LINES).map(segs => line(ui, segs, ctx, scope))}
      {more > 0 && <Text dimColor>{`… +${more} lines`}</Text>}
    </Box>
  )
}
