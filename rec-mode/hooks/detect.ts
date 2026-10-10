// rec-mode's detector: finds private data in a text (emails, keys, IP addresses,
// user names) as spans, and masks them. Pure: no `$`, tested on its own.

export type Kind = 'email' | 'key' | 'ip' | 'user'
export type Span = { start: number; end: number; kind: Kind }

export type Context = {
  /** Account names, matched as whole words in the case written (the OS user). */
  users: readonly string[]
  /** Extra words from the mod's options: any case, and words starting with them. */
  names: readonly string[]
}

// A rule matches the whole span, or `(prefix)(span)` when `isGrouped`: group 1
// is what comes before, group 2 the span, and only lookaheads follow it.
type Rule = { kind: Kind; re: RegExp; isGrouped?: boolean; isValue?: boolean }

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const HEX = '[0-9A-Fa-f]{1,4}'
const VALUE = '[^\\s"\'`,;)}\\]]'

const RULES: Rule[] = [
  // PEM private keys, whole.
  { kind: 'key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  // Provider keys, by their prefixes.
  {
    kind: 'key',
    re: /(?:sk-ant-[\w-]{16,}|sk-(?:proj-|svcacct-|live-|test-)?[\w-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{30,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{35}|glpat-[\w-]{20,}|hf_[A-Za-z0-9]{30,}|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,})/g,
  },
  // JSON Web Tokens.
  { kind: 'key', re: /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g },
  // Authorization: Bearer <token>.
  { kind: 'key', re: /(\bBearer\s+)([\w.~+/-]{16,}=*)/g, isGrouped: true },
  // API_KEY=..., "token": "...", password: ...
  {
    kind: 'key',
    re: new RegExp(
      `([A-Za-z0-9_.-]*(?:api[_-]?key|apikey|secret|token|passw(?:or)?d|pwd|access[_-]?key|private[_-]?key|credential)[A-Za-z0-9_]*["']?\\s*[:=]\\s*["']?)(${VALUE}{6,})`,
      'gi',
    ),
    isGrouped: true,
    isValue: true,
  },
  { kind: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  { kind: 'ip', re: new RegExp(`(^|[^\\w.])((?:${OCTET}\\.){3}${OCTET})(?![\\w]|\\.\\d)`, 'g'), isGrouped: true },
  {
    kind: 'ip',
    re: new RegExp(`(^|[^\\w:.])((?:${HEX}:){4,7}${HEX}|(?:${HEX}:){1,6}:(?:${HEX}(?::${HEX}){0,5})?)(?![\\w:])`, 'g'),
    isGrouped: true,
  },
  // The account in a home path: /Users/<name>, /home/<name>, C:\Users\<name>.
  { kind: 'user', re: /((?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\))([^/\\\s"'`:]+)/g, isGrouped: true },
  // user=..., "username": "...", login: ..., user.name=...
  {
    kind: 'user',
    re: new RegExp(`(\\b(?:user(?:[_-]?name)?|login|user\\.name|github[_-]?user)["']?\\s*[:=]\\s*["']?)(${VALUE}{2,})`, 'gi'),
    isGrouped: true,
    isValue: true,
  },
  // @handles, but not a scoped package (@scope/pkg), a decorator call or a doc tag.
  { kind: 'user', re: /(^|[^\w@./-])(@[A-Za-z0-9_][A-Za-z0-9_.-]*[A-Za-z0-9_])(?![\w/(]|[.-][\w/])/g, isGrouped: true },
]

// @-words that are code, not people.
const NOT_HANDLES = new Set(
  (
    'param returns return example remarks see type typedef deprecated media import keyframes supports override throws ' +
    'link todo default template internal public private since version author property container layer tailwind apply ' +
    'font-face charset namespace page each include mixin extend use forward if else for while function ts-ignore ' +
    'ts-expect-error ts-nocheck jsx class interface module'
  )
    .split(' ')
    .map(w => '@' + w),
)

const NOT_SECRET_VALUES = new Set(['true', 'false', 'null', 'undefined', 'none', 'required', 'optional', 'string', 'number'])
const GENERIC_USERS = new Set(['root', 'user', 'admin', 'runner', 'ubuntu', 'users', 'home'])

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The rules for the context's own names, compiled once per context.
const compiled = new WeakMap<Context, Rule[]>()

function contextRules(ctx: Context): Rule[] {
  const known = compiled.get(ctx)
  if (known) return known
  const rules: Rule[] = []
  for (const user of new Set(ctx.users)) {
    if (user.length < 3 || GENERIC_USERS.has(user.toLowerCase())) continue
    rules.push({ kind: 'user', re: new RegExp(`(^|[^A-Za-z0-9_])(${escape(user)})(?![A-Za-z0-9_])`, 'g'), isGrouped: true })
  }
  for (const name of new Set(ctx.names.map(n => n.trim()).filter(n => n.length >= 2))) {
    rules.push({ kind: 'user', re: new RegExp(`(^|[^\\p{L}\\p{N}_])(${escape(name)}[\\p{L}\\p{N}_]*)`, 'giu'), isGrouped: true })
  }
  compiled.set(ctx, rules)
  return rules
}

/** Every private span in `text`, in order, none overlapping (the longer wins). */
export function findSpans(text: string, ctx: Context): Span[] {
  if (text.length === 0) return []
  const found: Span[] = []
  for (const rule of [...RULES, ...contextRules(ctx)]) {
    rule.re.lastIndex = 0
    for (let m = rule.re.exec(text); m !== null; m = rule.re.exec(text)) {
      if (m[0].length === 0) {
        rule.re.lastIndex += 1
        continue
      }
      const prefix = rule.isGrouped ? (m[1] ?? '') : ''
      const value = rule.isGrouped ? (m[2] ?? '') : m[0]
      if (value.length === 0) continue
      if (rule.isValue && (/^\d+$/.test(value) || NOT_SECRET_VALUES.has(value.toLowerCase()))) continue
      if (value.startsWith('@') && NOT_HANDLES.has(value.toLowerCase())) continue
      const start = m.index + prefix.length
      found.push({ start, end: start + value.length, kind: rule.kind })
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
  const spans: Span[] = []
  for (const s of found) {
    const last = spans[spans.length - 1]
    if (last && s.start < last.end) continue
    spans.push(s)
  }
  return spans
}

export const MASK = '•'

/** The text with every private character swapped for a dot; line breaks stay. */
export function maskText(text: string, ctx: Context): string {
  const spans = findSpans(text, ctx)
  if (spans.length === 0) return text
  let out = ''
  let at = 0
  for (const s of spans) {
    out += text.slice(at, s.start) + text.slice(s.start, s.end).replace(/[^\n]/g, MASK)
    at = s.end
  }
  return out + text.slice(at)
}

/** A value with every string in it masked; the same value back when nothing changed. */
export function maskDeep<T>(value: T, ctx: Context): T {
  if (typeof value === 'string') return maskText(value, ctx) as T
  if (Array.isArray(value)) {
    const items = value.map(v => maskDeep(v, ctx))
    return (items.some((v, i) => v !== value[i]) ? items : value) as T
  }
  if (value !== null && typeof value === 'object') {
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const masked = maskDeep(v, ctx)
      if (masked !== v) changed = true
      out[k] = masked
    }
    return (changed ? out : value) as T
  }
  return value
}

/** One piece of a line as drawn: plain text, or a private span to blur. */
export type Piece = { text: string; isSecret: boolean }

/** A line cut into plain and private pieces. */
export function pieces(text: string, ctx: Context): Piece[] {
  const spans = findSpans(text, ctx)
  const out: Piece[] = []
  let at = 0
  for (const s of spans) {
    if (s.start > at) out.push({ text: text.slice(at, s.start), isSecret: false })
    out.push({ text: text.slice(s.start, s.end), isSecret: true })
    at = s.end
  }
  if (at < text.length || out.length === 0) out.push({ text: text.slice(at), isSecret: false })
  return out
}
