// rec-mode's Markdown helpers: a reply cut into blocks, so the blocks without
// private data stay the app's own Markdown, and a line of Markdown read as plain
// styled segments, for the blocks rec-mode draws itself. Pure: no `$`.

export type Block = { kind: 'text'; text: string } | { kind: 'fence'; text: string; body: string[] }

const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})/
const FENCE_CLOSE = /^\s{0,3}(`{3,}|~{3,})\s*$/

/** Paragraphs, lists and tables split on blank lines; a code fence is one block, blank lines and all. */
export function splitBlocks(text: string): Block[] {
  const out: Block[] = []
  let lines: string[] = []
  let fence: string | null = null
  const flush = () => {
    if (lines.length > 0) out.push({ kind: 'text', text: lines.join('\n') })
    lines = []
  }
  for (const line of text.split('\n')) {
    if (fence !== null) {
      lines.push(line)
      const close = FENCE_CLOSE.exec(line)
      if (close?.[1] && close[1][0] === fence[0] && close[1].length >= fence.length) {
        out.push({ kind: 'fence', text: lines.join('\n'), body: lines.slice(1, -1) })
        lines = []
        fence = null
      }
      continue
    }
    const open = FENCE_OPEN.exec(line)
    if (open?.[1]) {
      flush()
      fence = open[1]
      lines.push(line)
      continue
    }
    if (line.trim() === '') flush()
    else lines.push(line)
  }
  // A fence still open (a reply mid-stream) is a fence too.
  if (fence !== null) out.push({ kind: 'fence', text: lines.join('\n'), body: lines.slice(1) })
  else flush()
  return out
}

export type Style = 'plain' | 'bold' | 'code' | 'dim'
export type Segment = { text: string; style: Style }

/** One Markdown line as styled segments: its marker drawn simply; bold, code and link text unwrapped. */
export function lineSegments(line: string): Segment[] {
  let rest = line
  let base: Style = 'plain'
  const segs: Segment[] = []
  let m: RegExpExecArray | null
  if ((m = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line))) {
    base = 'bold'
    rest = m[1] ?? ''
  } else if ((m = /^(\s*)[-*+]\s+(.*)$/.exec(line))) {
    segs.push({ text: `${m[1] ?? ''}• `, style: 'plain' })
    rest = m[2] ?? ''
  } else if ((m = /^(\s*)(\d+[.)])\s+(.*)$/.exec(line))) {
    segs.push({ text: `${m[1] ?? ''}${m[2] ?? ''} `, style: 'plain' })
    rest = m[3] ?? ''
  } else if ((m = /^\s*>\s?(.*)$/.exec(line))) {
    segs.push({ text: '│ ', style: 'dim' })
    rest = m[1] ?? ''
  } else if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)) {
    return [{ text: line, style: 'dim' }] // a table's rule
  }
  const inline = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\([^)]*\)/g
  let at = 0
  for (m = inline.exec(rest); m !== null; m = inline.exec(rest)) {
    if (m.index > at) segs.push({ text: rest.slice(at, m.index), style: base })
    if (m[1] !== undefined) segs.push({ text: m[1], style: 'bold' })
    else if (m[2] !== undefined) segs.push({ text: m[2], style: 'code' })
    else segs.push({ text: m[3] ?? '', style: base })
    at = m.index + m[0].length
  }
  if (at < rest.length) segs.push({ text: rest.slice(at), style: base })
  return segs.length > 0 ? segs : [{ text: ' ', style: 'plain' }]
}
