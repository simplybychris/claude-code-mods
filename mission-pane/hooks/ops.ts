// mission-pane's text work: pure functions over plain values, no $ and no timers.

export type JobKind = 'shell' | 'monitor' | 'workflow' | 'agent' | string
export type Job = { id: string; kind: JobKind; label: string; startedAt: number; endedAt?: number; status: string; command?: string; outputPath?: string }
// One tool call of a subagent, as its timeline shows it.
export type Step = { id: string; at: number; summary: string; endedAt?: number; ok?: boolean; result?: string }
// `waiting`: its loop stopped while subagents it started still run; it resumes when they report.
export type AgentStat = { startedAt: number; endedAt?: number; waiting?: boolean; tools: number; last?: string; ctx?: number }

const ACTION_CHARS = 48

// What a tool call is doing, in a few words: `Bash npm test`, `Read register.tsx`.
export function describeCall(tool: string, input: Record<string, unknown>): string {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const base = (p: string) => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1)
  let detail = ''
  switch (tool) {
    case 'Bash':
      detail = oneLine(str('description') || str('command'))
      break
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      detail = base(str('file_path') || str('notebook_path'))
      break
    case 'Grep':
    case 'Glob':
      detail = `"${str('pattern')}"`
      break
    case 'WebFetch':
      detail = host(str('url'))
      break
    case 'WebSearch':
      detail = `"${str('query')}"`
      break
    case 'Agent':
      detail = str('description')
      break
    case 'Skill':
      detail = str('skill')
      break
    default:
      if (tool.startsWith('mcp__')) return clip(tool.split('__').slice(1).join(' '))
  }
  return clip(detail ? `${tool} ${detail}` : tool)
}

// A task notification's id and status, read from its text:
// `<task-id>b1</task-id> … <status>completed</status>`.
export function parseNotification(text: string): { id: string; status: string } | null {
  const id = text.match(/<task-id>\s*([^<\s]+)\s*<\/task-id>/)?.[1]
  if (!id) return null
  const status = text.match(/<status>\s*([^<]+?)\s*<\/status>/)?.[1] ?? 'completed'
  return { id, status }
}

export function isDone(status: string) {
  return !/^(running|pending|in_progress|async_launched|remote_launched)$/i.test(status)
}

export function isFailure(status: string) {
  return /fail|error|kill|stop|abort/i.test(status)
}

export function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

export function short(tokens: number) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return String(tokens)
}

export function oneLine(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

// Shortens multi-line text (a prompt, a report) without joining its lines.
export function cut(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function clip(text: string, max = ACTION_CHARS) {
  const t = oneLine(text)
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function host(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

// The first line of a tool's result worth showing: `12 matches`, `exit 1: 2 failed`.
export function firstLine(text: string | undefined, max = 60) {
  const line = (text ?? '').split('\n').map(l => l.trim()).find(l => l !== '') ?? ''
  return clip(line, max)
}

// Where a background shell writes its output, from what the Bash tool told the model.
export function outputPath(text: string | undefined) {
  return text?.match(/Output is being written to:\s*(\S+?\.output)\b/)?.[1]
}

// The last lines of a command's output as a terminal would show them: colors stripped,
// and a line a progress bar rewrote with \r reduced to what it last said.
export function tail(text: string, lines = 30) {
  return text
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .split('\n')
    .map(l => l.split('\r').filter(part => part !== '').pop() ?? '')
    .filter((l, i, all) => l.trim() !== '' || i < all.length - 1)
    .slice(-lines)
}

// Time since the agent started, as a timeline stamp: `0:05`, `12:40`.
export function offset(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
