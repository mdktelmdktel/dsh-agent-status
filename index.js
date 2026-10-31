/**
 * dsh-agent-status — Host half.
 *
 * Folds the live session event stream into a per-session "what is the agent
 * doing right now" summary and serves it as a package-private JSON API that the
 * Client status pill polls (`/agent-status/api/state`).
 *
 * Only durable events are used (`turn/start`, `tool/call`, `tool/result`,
 * `assistant/message`, `turn/end`), so the summary is reconstructable and no
 * per-agent subscription is needed: subagents are sessions too and show up for
 * free.
 */

/** Idle sessions are dropped after this long without an event. */
const RETENTION_MS = 15 * 60 * 1000
/** Hard cap on tracked sessions (oldest dropped first). */
const MAX_SESSIONS = 48
/** Recent finished tool calls kept per session. */
const MAX_RECENT = 6
/** Longest argument summary kept for the pill. */
const MAX_DETAIL = 70

export const name = 'agent-status'

export const inject = ['webServer']

export function apply(ctx) {
  /** @type {Map<string, object>} sessionId -> state */
  const store = new Map()

  function entryFor(sessionId) {
    let entry = store.get(sessionId)
    if (entry === undefined) {
      const now = Date.now()
      entry = {
        id: sessionId,
        busy: false,
        phase: 'idle',
        tool: '',
        detail: '',
        turn: 0,
        step: 0,
        tools: 0,
        phaseAt: now,
        turnAt: 0,
        startedAt: now,
        endedAt: 0,
        updatedAt: now,
        todo: null,
        recent: [],
        calls: new Map(),
      }
      store.set(sessionId, entry)
      prune(now)
    }
    return entry
  }

  function prune(now) {
    if (store.size <= MAX_SESSIONS) return
    const ordered = [...store.values()].sort((a, b) => a.updatedAt - b.updatedAt)
    while (ordered.length > 0 && store.size > MAX_SESSIONS) {
      const victim = ordered.shift()
      store.delete(victim.id)
    }
    for (const [id, value] of store) {
      if (value.busy) continue
      if (now - value.updatedAt > RETENTION_MS) store.delete(id)
    }
  }

  function fold(entry, event) {
    const data = event?.data
    if (data === null || typeof data !== 'object') return
    const now = Date.now()
    entry.updatedAt = now

    switch (event.type) {
      case 'turn/start': {
        entry.busy = true
        entry.turn = typeof data.turn === 'number' ? data.turn : entry.turn + 1
        entry.step = 0
        entry.tools = 0
        entry.phase = 'start'
        entry.tool = ''
        entry.detail = ''
        entry.recent = []
        entry.calls.clear()
        entry.turnAt = now
        entry.startedAt = now
        entry.phaseAt = now
        entry.endedAt = 0
        return
      }
      case 'tool/call': {
        const callId = typeof data.callId === 'string' ? data.callId : ''
        const tool = typeof data.name === 'string' ? data.name : 'tool'
        if (typeof data.step === 'number' && data.step > entry.step) entry.step = data.step
        entry.busy = true
        entry.tools += 1
        entry.phase = 'tool'
        entry.tool = tool
        entry.detail = summarizeArguments(tool, data.arguments)
        entry.phaseAt = now
        if (callId !== '') entry.calls.set(callId, { tool, detail: entry.detail, at: now })
        if (tool === 'todo_write' || tool === 'TodoWrite') readTodo(entry, data.arguments)
        return
      }
      case 'tool/result': {
        const message = data.message
        const callId = callIdOf(message)
        const call = callId === '' ? undefined : entry.calls.get(callId)
        const failed = data.error !== undefined || message?.isError === true
        if (call !== undefined) {
          entry.calls.delete(callId)
          entry.recent.unshift({
            tool: call.tool,
            detail: call.detail,
            ok: !failed,
            ms: Math.max(0, now - call.at),
          })
          if (entry.recent.length > MAX_RECENT) entry.recent.length = MAX_RECENT
        }
        entry.busy = true
        entry.phase = 'think'
        entry.tool = ''
        entry.detail = ''
        entry.phaseAt = now
        return
      }
      case 'assistant/message': {
        const text = preview(flattenContent(messageContent(data)), MAX_DETAIL)
        entry.busy = true
        entry.phase = 'reply'
        entry.tool = ''
        entry.detail = text
        entry.phaseAt = now
        return
      }
      case 'turn/end': {
        entry.busy = false
        entry.phase = 'idle'
        entry.tool = ''
        entry.detail = ''
        entry.calls.clear()
        entry.phaseAt = now
        entry.endedAt = now
        return
      }
      default:
        return
    }
  }

  function readTodo(entry, args) {
    const value = parseArguments(args)
    const todos = Array.isArray(value?.todos) ? value.todos : undefined
    if (todos === undefined) return
    let done = 0
    let current = ''
    for (const todo of todos) {
      if (todo === null || typeof todo !== 'object') continue
      const status = String(todo.status ?? '')
      if (status === 'completed') done += 1
      else if (current === '' && (status === 'in_progress' || status === 'inProgress')) {
        current = preview(String(todo.content ?? ''), 60)
      }
    }
    if (done === 0 && current === '' && todos.length === 0) return
    entry.todo = { done, total: todos.length, current }
  }

  const unsubscribe = ctx.on('session/event', (session, event) => {
    try {
      const id = session?.id
      if (typeof id !== 'string' || id === '') return
      fold(entryFor(id), event)
    } catch (error) {
      ctx.logger?.warn?.(`agent-status: fold failed: ${String(error?.message ?? error)}`)
    }
  })
  ctx.effect(() => () => {
    try {
      unsubscribe?.()
    } catch {
      /* teardown is best-effort */
    }
  })

  function snapshot(entry) {
    const now = Date.now()
    return {
      busy: entry.busy,
      phase: entry.phase,
      tool: entry.tool,
      detail: entry.detail,
      turn: entry.turn,
      step: entry.step,
      tools: entry.tools,
      sinceMs: now - entry.phaseAt,
      turnMs: entry.turnAt === 0 ? 0 : now - entry.turnAt,
      endedMs: entry.endedAt === 0 ? -1 : now - entry.endedAt,
      todo: entry.todo,
      recent: entry.recent.slice(0, MAX_RECENT),
    }
  }

  function statePayload() {
    prune(Date.now())
    const sessions = {}
    for (const [id, entry] of store) sessions[id] = snapshot(entry)
    return { ok: true, sessions }
  }

  function sendJson(res, status, payload) {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(payload))
  }

  ctx.effect(
    () => {
      const handler = async (req, res) => {
        try {
          const path = String(req.url ?? '').split('?')[0].replace(/\/+$/, '')
          if (req.method === 'GET' && path.endsWith('/api/state')) {
            sendJson(res, 200, statePayload())
            return
          }
          sendJson(res, 404, { ok: false, error: 'unknown agent-status endpoint' })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      }
      return ctx.webServer.register({ kind: 'prefix', path: '/agent-status', handler })
    },
    'agent-status: state API route',
  )
}

/* ---------------------------------------------------------------- helpers */

function messageContent(data) {
  const message = data.message
  if (message !== null && typeof message === 'object') return message.content
  return data.content
}

/** The tool call a result answers: `toolCallId`, then `source.callId`. */
function callIdOf(message) {
  if (message === null || typeof message !== 'object') return ''
  if (typeof message.toolCallId === 'string') return message.toolCallId
  const source = message.source
  if (source !== null && typeof source === 'object' && typeof source.callId === 'string') return source.callId
  return ''
}

function flattenContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts = []
    for (const part of content) {
      if (typeof part === 'string') parts.push(part)
      else if (part !== null && typeof part === 'object' && typeof part.text === 'string') parts.push(part.text)
    }
    return parts.join('')
  }
  if (content !== null && typeof content === 'object' && typeof content.text === 'string') return content.text
  return ''
}

function parseArguments(args) {
  if (args === null || args === undefined) return undefined
  if (typeof args === 'object') return args
  if (typeof args !== 'string') return undefined
  try {
    const parsed = JSON.parse(args)
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

function pick(value, max) {
  if (typeof value !== 'string') return ''
  return preview(value, max ?? MAX_DETAIL)
}

function summarizeArguments(tool, args) {
  const value = parseArguments(args)
  if (value === undefined) return typeof args === 'string' ? preview(args, MAX_DETAIL) : ''
  const t = typeof tool === 'string' ? tool : ''
  if (t === 'ops_bash' || t === 'bash' || t === 'pwsh' || t === 'terminal' || t === 'ops_bash') {
    return pick(value.description, 60) || pick(value.command, MAX_DETAIL)
  }
  if (t === 'write' || t === 'edit' || t === 'str_replace_editor') {
    return pick(value.file_path, MAX_DETAIL) || pick(value.path, MAX_DETAIL)
  }
  if (Array.isArray(value.files) && value.files.length > 0) {
    const first = value.files[0]
    return pick(first?.path, MAX_DETAIL) || pick(value.files[0], MAX_DETAIL)
  }
  if (t === 'ops_read_files' || t === 'read_file' || t === 'ops_inspect_local_file') {
    return pick(value.path, MAX_DETAIL) || pick(value.files?.[0]?.path, MAX_DETAIL)
  }
  if (t === 'ops_grep' || t === 'grep') return pick(value.pattern, MAX_DETAIL)
  if (t === 'ops_glob' || t === 'glob') {
    const patterns = Array.isArray(value.pattern) ? value.pattern : [value.pattern]
    return pick(typeof patterns[0] === 'string' ? patterns[0] : '', MAX_DETAIL)
  }
  if (t === 'web_search') {
    const queries = Array.isArray(value.queries) ? value.queries : [value.query]
    return pick(typeof queries[0] === 'string' ? queries[0] : '', MAX_DETAIL)
  }
  if (t === 'todo_write' || t === 'TodoWrite') {
    const todos = Array.isArray(value.todos) ? value.todos : []
    const current = todos.find((todo) => todo && (todo.status === 'in_progress' || todo.status === 'inProgress'))
    if (current !== undefined && current !== null) return pick(String(current.content ?? ''), 60)
    return todos.length > 0 ? `${todos.length}` : ''
  }
  if (t === 'send_message' || t === 'spawn_teammate' || t === 'team_task_create' || t === 'wait_agent') {
    return pick(value.target, 40) || pick(value.name, 40) || pick(value.subject, 50)
  }
  if (t === 'skill') return pick(value.name, 40)
  if (t === 'ask_user_question') {
    const first = Array.isArray(value.questions) ? value.questions[0] : undefined
    return pick(first?.header, 40) || pick(first?.question, 50)
  }
  if (t === 'read_image' || t === 'present') return pick(value.file_path, MAX_DETAIL) || pick(value.path, MAX_DETAIL)
  for (const key of ['description', 'command', 'file_path', 'path', 'pattern', 'query', 'name', 'target']) {
    const text = pick(value[key], MAX_DETAIL)
    if (text !== '') return text
  }
  return ''
}

function preview(text, limit) {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (flat.length <= limit) return flat
  return `${flat.slice(0, limit - 1)}…`
}
