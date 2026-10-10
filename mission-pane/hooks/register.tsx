// mission-pane: a side pane (/ops) with this session's subagents and background jobs,
// live. The list shows status, time, tool calls, context and last action; a row opens
// its details: an agent's prompt, timeline of tool calls with results, messages and
// report, or a job's command and the tail of its output. A sound and a toast as one ends.
// It reads what Claude Code already holds: no model calls, no network.
// Idea from agent-radar in hamzafer/claude-code-mods (MIT), grown into a pane.
import type { AgentInfo, EngineInterface, Register, Timer } from 'claude-code'

import { clip, cut, describeCall, elapsed, firstLine, isDone, isFailure, offset, oneLine, outputPath, parseNotification, short, tail } from './ops'
import type { AgentStat, Job, Step } from './ops'

const PANE = 'mission-pane'
const TICK_MS = 1_000
const KEEP_DONE = 10
const MAX_STEPS = 300
const PROMPT_LINES = 10
const SOUND = '/System/Library/Sounds/Glass.aiff'
const SOUND_GAP_MS = 3_000
const COLOR = { run: '#3fb950', wait: '#d29922', done: '#8b949e', fail: '#f85149', kind: '#58a6ff', action: '#d2a8ff', head: '#e6edf3' }

type Row = {
  key: string
  id: string
  isJob: boolean
  depth: number
  state: 'run' | 'wait' | 'done' | 'fail'
  kind: string
  label: string
  time: string
  tools?: number
  ctx?: number
  note?: string // the last action while running, the status once ended
  endedAt: number
}

const isLive = (r: Row) => r.state === 'run' || r.state === 'wait'

type View = { kind: 'list' } | { kind: 'agent'; id: string } | { kind: 'job'; id: string }

// The module's state: a hot reload starts it over.
const stats = new Map<string, AgentStat>() // per subagent, from its own loop's events
const steps = new Map<string, Step[]>() // per subagent, its tool calls in order
const reports = new Map<string, string>() // per subagent, its final answer
const prompts = new Map<string, string>() // per subagent, the task it was given
const promptsByLabel = new Map<string, string>() // Agent call description → prompt, until the id is known
const jobs = new Map<string, Job>() // background shells, monitors, workflows
let view: View = { kind: 'list' }
let isPromptOpen = false
let clearedAt = 0
let hinted = false
let lastSoundAt = 0
let timer: Timer | undefined

function stat(id: string, now: number): AgentStat {
  const known = stats.get(id)
  if (known) return known
  const fresh: AgentStat = { startedAt: now, tools: 0 }
  stats.set(id, fresh)
  return fresh
}

function runningCount() {
  return [...jobs.values()].filter(j => j.endedAt === undefined).length + [...stats.values()].filter(s => s.endedAt === undefined).length
}

// A job or agent ended: a toast, a sound (at most one every few seconds), a redraw.
async function finished($: EngineInterface, label: string, ms: number, status: string) {
  const now = await $.clock.now()
  const failed = isFailure(status)
  $.ui.toast(`${failed ? '✗' : '✓'} ${label} · ${elapsed(ms)}${failed ? ` · ${status}` : ''}`)
  if (now - lastSoundAt >= SOUND_GAP_MS) {
    lastSoundAt = now
    void $.process.run(['afplay', SOUND], { timeoutMs: 5_000 }).catch(() => {})
  }
  $.ui.invalidate('ui.render')
}

async function startJob($: EngineInterface, job: Omit<Job, 'startedAt' | 'status'>) {
  if (jobs.has(job.id)) return
  jobs.set(job.id, { ...job, startedAt: await $.clock.now(), status: 'running' })
  await hint($)
  $.ui.invalidate('ui.render')
}

async function endJob($: EngineInterface, id: string, status: string) {
  const job = jobs.get(id)
  if (!job || job.endedAt !== undefined) return
  const now = await $.clock.now()
  job.endedAt = now
  job.status = status
  await finished($, `${job.kind} · ${clip(job.label, 40)}`, now - job.startedAt, status)
}

// With the pane closed and two or more things running, say so once a turn.
async function hint($: EngineInterface) {
  if (hinted || runningCount() < 2) return
  if ((await $.ui.panes().catch(() => [])).some(p => p.id === PANE)) return
  hinted = true
  $.ui.toast(`${runningCount()} running · /ops`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'ops', description: 'Open or close the pane of subagents and background jobs' }).catch(() => {})
    timer?.cancel()
    // The clocks move once a second, only while something runs and the pane is open.
    timer = $.clock.every(TICK_MS, () => {
      void (async () => {
        if (runningCount() === 0) return
        if (!(await $.ui.panes()).some(p => p.id === PANE)) return
        $.ui.invalidate('ui.render')
      })().catch(() => {})
    })
    return result
  })

  on('turn.start', async ($, e, next) => {
    hinted = false
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const text = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
    const summary = describeCall(tool, input)
    let step: Step | undefined
    if (e.agentId) {
      const now = await $.clock.now()
      const s = stat(e.agentId, now)
      s.tools += 1
      s.last = summary
      step = { id: e.tool_use_id, at: now, summary }
      steps.set(e.agentId, [...(steps.get(e.agentId) ?? []), step].slice(-MAX_STEPS))
    }
    if (tool === 'Agent') promptsByLabel.set(text('description'), text('prompt'))

    const result = await next(e)
    const failed = result.deny !== undefined || result.isError === true
    if (step) {
      step.endedAt = await $.clock.now()
      step.ok = !failed
      step.result = firstLine(result.deny ?? result.text)
    }
    const out = (result as { result?: unknown }).result
    if (failed || !out || typeof out !== 'object') return result
    const o = out as Record<string, unknown>
    if (tool === 'Bash' && typeof o.backgroundTaskId === 'string') {
      await startJob($, {
        id: o.backgroundTaskId,
        kind: 'shell',
        label: clip(text('description') || oneLine(text('command')) || 'shell'),
        command: text('command'),
        outputPath: outputPath(result.text),
      })
    } else if (tool === 'Monitor' && typeof o.taskId === 'string') {
      await startJob($, { id: o.taskId, kind: 'monitor', label: clip(text('description') || 'monitor'), command: text('command') })
    } else if (tool === 'Workflow' && typeof o.taskId === 'string') {
      const name = typeof o.workflowName === 'string' ? o.workflowName : text('name') || text('title') || 'workflow'
      await startJob($, { id: o.taskId, kind: 'workflow', label: clip(name) })
    } else if (tool === 'Agent' && typeof o.agentId === 'string') {
      prompts.set(o.agentId, text('prompt'))
    } else if (tool === 'TaskStop') {
      const id = text('task_id') || text('shell_id')
      if (id) await endJob($, id, 'killed')
    }
    return result
  })

  // A subagent's own requests: when it started, and how much context it carries.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) {
      const s = stat(e.agentId, await $.clock.now())
      if (s.endedAt !== undefined || s.waiting) {
        s.endedAt = undefined // resumed: a stop was a pause, not its end
        s.waiting = false
        $.ui.invalidate('ui.render')
      }
    }
    const result = yield* next(e)
    if (e.agentId && result.usage) {
      const u = result.usage
      stat(e.agentId, await $.clock.now()).ctx = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      await hint($)
    }
    return result
  })

  // A subagent's loop ends with its own turn.complete, carrying its report.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) return result
    if (e.answer) reports.set(e.agentId, e.answer)
    const now = await $.clock.now()
    const s = stat(e.agentId, now)
    if (s.endedAt !== undefined) return result
    const list = await $.agent.list().catch(() => [] as readonly AgentInfo[])
    // Stopped with its own subagents still running: it waits for them, it is not done.
    const live = list.filter(c => c.parentId === e.agentId && stats.get(c.id)?.endedAt === undefined && !isDone(c.status)).length
    if (live > 0) {
      s.waiting = true
      s.last = `waiting for ${live} subagent${live === 1 ? '' : 's'}`
      $.ui.invalidate('ui.render')
      return result
    }
    s.endedAt = now
    s.waiting = false
    const info = list.find(a => a.id === e.agentId)
    const status = e.isAborted ? 'killed' : e.reason === 'error' ? 'failed' : 'completed'
    await finished($, `${info?.type ?? 'agent'} · ${clip(info?.description ?? e.agentId, 40)}`, now - s.startedAt, status)
    return result
  })

  // A background job's end reaches the session as a task notification.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      const n = parseNotification(e.text)
      if (n) await endJob($, n.id, n.status)
    }
    return next(e)
  })

  // At each stop Claude Code lists what is still in flight: pick up jobs started
  // elsewhere (a command the person backgrounded) and close the ones that are gone.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    const tasks = e.background_tasks ?? []
    const live = new Set(tasks.map(t => t.id))
    for (const t of tasks) {
      if (t.type === 'subagent' || jobs.has(t.id)) continue
      await startJob($, { id: t.id, kind: t.type, label: clip(oneLine(t.description || t.command || t.name || t.type)), command: t.command })
    }
    for (const j of [...jobs.values()]) if (j.endedAt === undefined && !live.has(j.id)) await endJob($, j.id, 'completed')
    return result
  })

  on('command.run', { command: 'ops' }, async $ => {
    const isOpen = (await $.ui.panes().catch(() => [])).some(p => p.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'Mission pane closed. /ops opens it again.' }
    }
    view = { kind: 'list' }
    await $.ui.open({ id: PANE, title: 'Mission', focus: true })
    return { text: 'Mission pane open: subagents and background jobs, live. 1–9 opens a row.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const now = await $.clock.now()
    const list = await $.agent.list().catch(() => [] as readonly AgentInfo[])
    const agents = agentRows(list, now)
    const background = jobRows(now)
    const go = (next: View) => {
      view = next
      isPromptOpen = false
      $.ui.invalidate('ui.render')
    }

    const glyph = (state: Row['state']) => (
      <Text color={state === 'run' ? COLOR.run : state === 'wait' ? COLOR.wait : state === 'fail' ? COLOR.fail : COLOR.done}>
        {state === 'run' ? '●' : state === 'wait' ? '◐' : state === 'fail' ? '✗' : '✓'}
      </Text>
    )

    const heading = (title: string, extra?: string) => (
      <Text key={`h-${title}`}>
        <Text bold color={COLOR.head}>{title}</Text>
        {extra ? <Text dimColor>{` · ${extra}`}</Text> : null}
      </Text>
    )

    // The row a detail shows at its top, with ← back and ◀ ▶ through its siblings.
    const detailBar = (rows: Row[], at: number, toView: (r: Row) => View) => {
      const row = rows[at]
      if (!row) return null
      const older = rows[at - 1]
      const newer = rows[at + 1]
      return (
        <Box key="bar" flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" gap={1}>
            <Button key="back" label="← back" hotkey="b" onPress={() => go({ kind: 'list' })} />
            <Button key="prev" label="◀" hotkey="p" dimColor={!older} onPress={() => older && go(toView(older))} />
            <Button key="next" label="▶" hotkey="n" dimColor={!newer} onPress={() => newer && go(toView(newer))} />
            <Text dimColor>{`${at + 1}/${rows.length}`}</Text>
          </Box>
          <Box flexDirection="row" gap={1}>
            {glyph(row.state)}
            <Text bold color={COLOR.kind}>{row.kind}</Text>
            <Text bold>{row.label}</Text>
          </Box>
          <Text dimColor>
            {[row.state === 'run' ? 'running' : row.state === 'wait' ? 'waiting' : row.note, row.time, row.tools !== undefined ? `${row.tools} tools` : '', row.ctx !== undefined ? `${short(row.ctx)} ctx` : '']
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </Box>
      )
    }

    // An agent's details: the task it got, its tool calls with results, its words, its report.
    if (view.kind === 'agent') {
      const id = view.id
      const at = agents.findIndex(r => r.id === id)
      if (at < 0) view = { kind: 'list' }
      else {
        const found = await $.session.messages({ agentId: id }).catch(() => [])
        const messages = Array.isArray(found) ? found : []
        const firstUser = messages.find(m => m.role === 'user' && m.text.trim() !== '')
        const info = list.find(a => a.id === id)
        const prompt = prompts.get(id) || (info ? promptsByLabel.get(info.description) : undefined) || firstUser?.text || ''
        const promptLines = prompt.split('\n')
        const shownPrompt = isPromptOpen ? prompt : promptLines.slice(0, PROMPT_LINES).join('\n')
        const said = messages.filter(m => m.role === 'assistant' && m.text.trim() !== '').slice(-5)
        const report = reports.get(id)
        const start = stats.get(id)?.startedAt ?? 0
        const timeline = steps.get(id) ?? []
        return (
          <Box flexDirection="column">
            {detailBar(agents, at, r => ({ kind: 'agent', id: r.id }))}
            <Box key="prompt" flexDirection="column" marginBottom={1}>
              <Box flexDirection="row" gap={1}>
                {heading('PROMPT')}
                {promptLines.length > PROMPT_LINES && (
                  <Button
                    key="prompt-toggle"
                    label={isPromptOpen ? 'less' : `all ${promptLines.length} lines`}
                    hotkey="f"
                    dimColor
                    onPress={() => {
                      isPromptOpen = !isPromptOpen
                      $.ui.invalidate('ui.render')
                    }}
                  />
                )}
              </Box>
              {prompt ? <Markdown key="prompt-text" dimColor text={cut(shownPrompt, 9_000)} /> : <Text dimColor>(not known yet)</Text>}
            </Box>
            <Box key="timeline" flexDirection="column" marginBottom={1}>
              {heading('TIMELINE', `${timeline.length} tool calls`)}
              {timeline.length === 0 && <Text dimColor>(no tool calls yet)</Text>}
              {timeline.slice(-60).map(s => (
                <Box key={`step-${s.id}`} flexDirection="row">
                  <Box width={7}>
                    <Text dimColor>{offset(s.at - start)}</Text>
                  </Box>
                  <Box width={2}>{glyph(s.endedAt === undefined ? 'run' : s.ok ? 'done' : 'fail')}</Box>
                  <Box width={38}>
                    <Text color={s.ok === false ? COLOR.fail : undefined} wrap="truncate">{s.summary}</Text>
                  </Box>
                  <Box flexGrow={1}>
                    <Text dimColor={s.ok !== false} color={s.ok === false ? COLOR.fail : undefined} wrap="truncate">
                      {s.endedAt === undefined ? '…' : s.result ? `→ ${s.result}` : ''}
                    </Text>
                  </Box>
                </Box>
              ))}
            </Box>
            {said.length > 0 && (
              <Box key="messages" flexDirection="column" marginBottom={1}>
                {heading('MESSAGES', `last ${said.length}`)}
                {said.map((m, i) => (
                  <Text key={`said-${i}`} wrap="wrap">
                    <Text color={COLOR.action}>{'› '}</Text>
                    <Text>{cut(m.text.trim(), 400)}</Text>
                  </Text>
                ))}
              </Box>
            )}
            {report && (
              <Box key="report" flexDirection="column">
                {heading('REPORT')}
                <Markdown key="report-text" text={cut(report, 9_000)} />
              </Box>
            )}
          </Box>
        )
      }
    }

    // A job's details: its command and the last lines of its output, live.
    if (view.kind === 'job') {
      const id = view.id
      const at = background.findIndex(r => r.id === id)
      const job = jobs.get(id)
      if (at < 0 || !job) view = { kind: 'list' }
      else {
        let lines: string[] | null = null
        let why = 'No output file for this job.'
        if (job.outputPath) {
          const raw = await $.fs.read(job.outputPath).catch(() => null)
          if (typeof raw === 'string') lines = tail(raw)
          else why = 'The output file could not be read (gone, or over 4 MB).'
        }
        return (
          <Box flexDirection="column">
            {detailBar(background, at, r => ({ kind: 'job', id: r.id }))}
            {job.command && (
              <Box key="command" flexDirection="column" marginBottom={1}>
                {heading('COMMAND')}
                <Text dimColor wrap="wrap">{cut(job.command, 1_000)}</Text>
              </Box>
            )}
            <Box key="output" flexDirection="column">
              {heading('OUTPUT', lines ? `last ${lines.length} lines` : undefined)}
              {lines === null && <Text dimColor>{why}</Text>}
              {lines?.length === 0 && <Text dimColor>(nothing yet)</Text>}
              {lines?.map((l, i) => (
                <Text key={`out-${i}`} wrap="truncate">{l}</Text>
              ))}
            </Box>
          </Box>
        )
      }
    }

    // The list: every agent and job, a row each, 1–9 opening one.
    if (agents.length === 0 && background.length === 0) {
      return <Text dimColor>Nothing yet. Subagents and background jobs of this session show up here, live.</Text>
    }
    const numbered = [...agents, ...background]
    const section = (title: string, rows: Row[]) => {
      const running = rows.filter(isLive).length
      return (
        <Box key={`section-${title}`} flexDirection="column" marginBottom={1}>
          {heading(title, `${running} running · ${rows.length - running} done`)}
          {rows.map(r => {
            const n = numbered.indexOf(r) + 1
            return (
              <Box key={r.key} flexDirection="row" paddingLeft={r.depth * 2}>
                <Box width={2}>{glyph(r.state)}</Box>
                <Box width={10}>
                  <Text color={COLOR.kind} wrap="truncate">{r.kind}</Text>
                </Box>
                <Box width={30}>
                  <Text dimColor={!isLive(r)} wrap="truncate">{r.label}</Text>
                </Box>
                <Box width={9}>
                  <Text dimColor>{r.time}</Text>
                </Box>
                <Box width={10}>
                  <Text dimColor>{r.tools === undefined ? '' : `${r.tools} tools`}</Text>
                </Box>
                <Box width={9}>
                  <Text dimColor>{r.ctx === undefined ? '' : `${short(r.ctx)} ctx`}</Text>
                </Box>
                <Box flexGrow={1}>
                  <Text color={r.state === 'run' ? COLOR.action : r.state === 'wait' ? COLOR.wait : undefined} dimColor={!isLive(r)} wrap="truncate">
                    {r.note ? (isLive(r) ? `→ ${r.note}` : r.note) : ''}
                  </Text>
                </Box>
                <Button
                  key={`open-${r.key}`}
                  label="›"
                  {...(n <= 9 ? { hotkey: String(n) } : {})}
                  onPress={() => go(r.isJob ? { kind: 'job', id: r.id } : { kind: 'agent', id: r.id })}
                />
              </Box>
            )
          })}
        </Box>
      )
    }
    const hasDone = numbered.some(r => !isLive(r))
    return (
      <Box flexDirection="column">
        {agents.length > 0 && section('AGENTS', agents)}
        {background.length > 0 && section('BACKGROUND', background)}
        {hasDone && (
          <Button
            key="clear"
            label="clear done"
            hotkey="c"
            dimColor
            onPress={() => {
              void (async () => {
                clearedAt = await $.clock.now()
                $.ui.invalidate('ui.render')
              })().catch(() => {})
            }}
          />
        )}
      </Box>
    )
  })
}

// Subagents as rows: running first, children under their parent, the last few done.
function agentRows(list: readonly AgentInfo[], now: number): Row[] {
  const toRow = (a: AgentInfo, depth: number): Row => {
    const s = stats.get(a.id)
    const ended = s?.endedAt ?? (isDone(a.status) ? now : undefined)
    const state = ended === undefined ? (s?.waiting ? 'wait' : 'run') : isFailure(a.status) ? 'fail' : 'done'
    return {
      key: `agent-${a.id}`,
      id: a.id,
      isJob: false,
      depth,
      state,
      kind: a.type,
      label: oneLine(a.description || a.name || a.id),
      time: s ? elapsed((s.endedAt ?? now) - s.startedAt) : '',
      tools: s?.tools,
      ctx: s?.ctx,
      note: state === 'run' || state === 'wait' ? s?.last : a.status,
      endedAt: ended ?? Infinity,
    }
  }
  const ids = new Set(list.map(a => a.id))
  const roots = list.filter(a => !a.parentId || !ids.has(a.parentId)).map(a => ({ a, row: toRow(a, 0) }))
  const kept = keep(roots.map(r => r.row))
  const out: Row[] = []
  const walk = (a: AgentInfo, depth: number) => {
    for (const child of list.filter(c => c.parentId === a.id)) {
      const row = toRow(child, depth)
      if (isLive(row) || row.endedAt > clearedAt) out.push(row)
      walk(child, depth + 1)
    }
  }
  for (const row of kept) {
    const root = roots.find(r => r.row.key === row.key)
    out.push(row)
    if (root) walk(root.a, 1)
  }
  return out
}

function jobRows(now: number): Row[] {
  return keep(
    [...jobs.values()].map(j => ({
      key: `job-${j.id}`,
      id: j.id,
      isJob: true,
      depth: 0,
      state: j.endedAt === undefined ? 'run' : isFailure(j.status) ? 'fail' : 'done',
      kind: j.kind,
      label: j.label,
      time: elapsed((j.endedAt ?? now) - j.startedAt),
      note: j.endedAt === undefined ? undefined : j.status,
      endedAt: j.endedAt ?? Infinity,
    })),
  )
}

// Running rows first (oldest first), then the most recent done, at most KEEP_DONE, none cleared.
function keep(rows: Row[]): Row[] {
  const running = rows.filter(isLive)
  const done = rows
    .filter(r => !isLive(r) && r.endedAt > clearedAt)
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, KEEP_DONE)
  return [...running, ...done]
}
