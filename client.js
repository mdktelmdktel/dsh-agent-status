/**
 * dsh-agent-status — Client half (browser).
 *
 * Registers a live step pill into the Session header row
 * (`conversation.session.header.utilities`) and renders the Host's
 * `/agent-status/api/state` summary: what the agent is doing right now, which
 * step of the turn it is on, how long the turn has been running, and the todo
 * progress when the agent keeps a task list.
 *
 * Plain ES5-ish JavaScript inside the `window.__ModuleLoader__` handshake —
 * `react` comes from the shell's module table.
 */
window.__ModuleLoader__.load({
  id: 'dsh-agent-status',
  factory: function (require) {
    var React = require('react')
    var h = React.createElement

    var API_URL = '/agent-status/api/state'
    var POLL_MS = 1200
    var IDLE_HIDE_MS = 9000
    var MAX_LABEL = 42

    /* @type {{data: object|null}} — last payload, shared across remounts */
    var cache = { data: null }
    /* @type {object|null} — client context, set by apply() */
    var ctxRef = null

    var STR = {
      zh: {
        start: '解析请求…',
        think: '思考下一步…',
        reply: '整理回复…',
        done: '上一轮完成',
        step: '第 {n} 步',
        todo: '待办 {d}/{t}',
        toolCall: '调用 {t}',
        toolLabel: '工具',
        titleHead: 'Agent 当前进度',
        recent: '最近动作',
        todoNow: '当前待办',
        failed: '失败',
        ok: '完成',
        turn: '本轮',
      },
      en: {
        start: 'reading the request…',
        think: 'thinking…',
        reply: 'writing the reply…',
        done: 'last turn done',
        step: 'step {n}',
        todo: 'todo {d}/{t}',
        toolCall: 'calling {t}',
        toolLabel: 'tool',
        titleHead: 'Agent progress',
        recent: 'Recent actions',
        todoNow: 'Current todo',
        failed: 'failed',
        ok: 'done',
        turn: 'turn',
      },
    }

    var VERBS = {
      zh: {
        ops_bash: '执行命令',
        bash: '执行命令',
        pwsh: '执行命令',
        terminal: '操作终端',
        edit: '修改文件',
        write: '写入文件',
        str_replace_editor: '修改文件',
        ops_read_files: '读取文件',
        read_file: '读取文件',
        ops_inspect_local_file: '读取文件',
        read_image: '查看图片',
        ops_grep: '搜索代码',
        grep: '搜索代码',
        ops_glob: '查找文件',
        glob: '查找文件',
        ops_result: '展开结果',
        ops_discover_tools: '查找工具',
        web_search: '联网搜索',
        skill: '读取技能',
        todo_write: '更新任务清单',
        ask_user_question: '向你提问',
        present: '展示产物',
        send_message: '发消息',
        spawn_teammate: '派出队友',
        list_agents: '查看队友',
        wait_agent: '等待队友',
        interrupt_agent: '中断队友',
        team_task_create: '建协作任务',
        team_task_update: '更新协作任务',
        team_task_get: '读协作任务',
        team_task_list: '读协作任务',
        job_output: '取后台输出',
        job_kill: '停后台任务',
        memory_search: '检索记忆',
        memory_remember: '记录记忆',
        memory_update: '更新记忆',
        memory_read: '读取记忆',
        memory_project: '查项目记忆',
        memory_dream: '整理记忆',
        mail_send: '发邮件',
        mail_inbox: '看邮箱',
        mail_read: '读邮件',
        mail_wait: '等邮件',
        exit_plan_mode: '提交计划',
        plan: '做规划',
      },
      en: {
        ops_bash: 'running a command',
        bash: 'running a command',
        pwsh: 'running a command',
        terminal: 'driving the terminal',
        edit: 'editing files',
        write: 'writing files',
        str_replace_editor: 'editing files',
        ops_read_files: 'reading files',
        ops_grep: 'searching code',
        ops_glob: 'finding files',
        web_search: 'searching the web',
        skill: 'reading a skill',
        todo_write: 'updating the todo list',
        ask_user_question: 'asking you',
        present: 'presenting a file',
        send_message: 'messaging a teammate',
        spawn_teammate: 'spawning a teammate',
        list_agents: 'checking teammates',
        wait_agent: 'waiting for a teammate',
        job_output: 'reading background output',
        job_kill: 'stopping a background job',
      },
    }

    var CSS = [
      '.das-pill{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;',
      'max-width:min(46ch,34vw);height:24px;padding:0 10px;border-radius:999px;',
      'border:.5px solid var(--dsw-alias-border-l3,rgba(128,128,128,.28));',
      'background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.10));',
      'font-size:12px;line-height:1;font-family:inherit;white-space:nowrap;overflow:hidden;',
      'color:var(--dsw-alias-label-secondary,#6b7280);cursor:default;user-select:none}',
      '.das-dot{flex:none;width:6px;height:6px;border-radius:50%;',
      'background:var(--dsw-alias-label-secondary,#6b7280)}',
      '.das-pill[data-busy] .das-dot{background:var(--dsw-alias-brand-primary,#2563eb);',
      'animation:das-pulse 1.4s ease-in-out infinite}',
      '.das-pill[data-failed] .das-dot{background:var(--dsw-alias-state-error-primary,#b91c1c);animation:none}',
      '.das-pill[data-idle] .das-dot{background:var(--dsw-alias-state-success-primary,#16a34a);animation:none}',
      '@keyframes das-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.72)}}',
      '.das-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;',
      'color:var(--dsw-alias-label-primary,#1f2937)}',
      '.das-dim{flex:none;color:var(--dsw-alias-label-secondary,#6b7280)}',
      '.das-sep{flex:none;opacity:.45}',
      '.das-todo{flex:none;color:var(--dsw-alias-label-secondary,#6b7280)}',
      '.das-pill[data-idle] .das-text{color:var(--dsw-alias-label-secondary,#6b7280)}',
    ].join('')

    function tr(lang, key, vars) {
      var dict = STR[lang] || STR.en
      var template = dict[key] !== undefined ? dict[key] : STR.en[key]
      if (template === undefined) return key
      if (vars === undefined || vars === null) return template
      return template.replace(/\{(\w+)\}/g, function (match, name) {
        return vars[name] === undefined ? match : String(vars[name])
      })
    }

    function cut(text, limit) {
      var flat = String(text === undefined || text === null ? '' : text)
        .replace(/\s+/g, ' ')
        .trim()
      if (flat.length <= limit) return flat
      return flat.slice(0, limit - 1) + '…'
    }

    function fmtDur(ms) {
      var value = Number(ms)
      if (!isFinite(value) || value < 0) return ''
      var total = Math.round(value / 1000)
      if (total < 60) return total + 's'
      var minutes = Math.floor(total / 60)
      var seconds = total % 60
      if (minutes < 60) return minutes + ':' + (seconds < 10 ? '0' : '') + seconds
      var hours = Math.floor(minutes / 60)
      var rest = minutes % 60
      return hours + ':' + (rest < 10 ? '0' : '') + rest + 'h'
    }

    function activeLocale() {
      try {
        var service = ctxRef && ctxRef.locale
        if (service && typeof service.getLocale === 'function') {
          var active = service.getLocale().active
          if (active === 'zh' || active === 'en') return active
        }
      } catch (error) {
        /* the locale service is optional */
      }
      var lang = (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || ''
      return lang.indexOf('zh') === 0 ? 'zh' : 'en'
    }

    function useLocale() {
      var subscribe = React.useCallback(function (notify) {
        try {
          var service = ctxRef && ctxRef.locale
          if (service && typeof service.subscribe === 'function') return service.subscribe(notify)
        } catch (error) {
          /* fall through to the document observer */
        }
        if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document.documentElement) {
          return function () {}
        }
        var observer = new MutationObserver(notify)
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
        return function () {
          observer.disconnect()
        }
      }, [])
      var snapshot = React.useCallback(function () {
        return activeLocale()
      }, [])
      return React.useSyncExternalStore(subscribe, snapshot, snapshot)
    }

    function useStatus() {
      var pair = React.useState(cache.data)
      var data = pair[0]
      var setData = pair[1]
      React.useEffect(function () {
        var alive = true
        function tick() {
          fetch(API_URL, { headers: { accept: 'application/json' }, cache: 'no-store' })
            .then(function (response) {
              if (!response.ok) throw new Error('HTTP ' + response.status)
              return response.json()
            })
            .then(function (payload) {
              if (!alive || payload === null || typeof payload !== 'object') return
              cache.data = payload
              setData(payload)
            })
            .catch(function () {
              /* the Host half may not be mounted yet; keep the last payload */
            })
        }
        tick()
        var timer = setInterval(tick, POLL_MS)
        return function () {
          alive = false
          clearInterval(timer)
        }
      }, [])
      return data
    }

    function pickSession(payload, sessionId) {
      if (payload === null || typeof payload !== 'object') return undefined
      var sessions = payload.sessions
      if (sessions === null || typeof sessions !== 'object') return undefined
      if (sessionId !== undefined && sessionId !== null && sessionId !== '') {
        var own = sessions[sessionId]
        return own === null || typeof own !== 'object' ? undefined : own
      }
      var best
      for (var id in sessions) {
        if (!Object.prototype.hasOwnProperty.call(sessions, id)) continue
        var candidate = sessions[id]
        if (candidate === null || typeof candidate !== 'object') continue
        if (best === undefined) {
          best = candidate
          continue
        }
        if (candidate.busy === true && best.busy !== true) best = candidate
      }
      return best
    }

    function verbOf(tool, lang) {
      var table = VERBS[lang] || VERBS.en
      var name = String(tool || '')
      if (name === '') return ''
      if (table[name] !== undefined) return table[name]
      return lang === 'zh' ? tr('zh', 'toolCall', { t: name }) : name.replace(/_/g, ' ')
    }

    function StepBar(props) {
      var lang = useLocale()
      var payload = useStatus()
      var sessionId = props && (props.sessionId || (props.session && props.session.id))
      var state = pickSession(payload, sessionId)
      if (state === null || state === undefined || typeof state !== 'object') return null

      var busy = state.busy === true
      var endedMs = Number(state.endedMs)
      if (!busy && (!isFinite(endedMs) || endedMs < 0 || endedMs > IDLE_HIDE_MS)) return null

      var phase = String(state.phase || 'idle')
      var recent = Array.isArray(state.recent) ? state.recent : []
      var failed = phase === 'idle' && recent.length > 0 && recent[0].ok === false

      var text
      if (phase === 'tool') {
        var verb = verbOf(state.tool, lang)
        var detail = cut(state.detail, MAX_LABEL)
        text = detail === '' ? verb : verb + '：' + detail
      } else if (phase === 'reply') {
        var preview = cut(state.detail, MAX_LABEL)
        text = preview === '' ? tr(lang, 'reply') : preview
      } else if (phase === 'start') {
        text = tr(lang, 'start')
      } else if (phase === 'think') {
        text = tr(lang, 'think')
      } else {
        text = tr(lang, 'done')
      }

      var meta = []
      var step = Number(state.step)
      if (state.turn > 0 || step > 0) meta.push(tr(lang, 'step', { n: step > 0 ? step : 1 }))
      var duration = fmtDur(busy && Number(state.turnMs) > 0 ? state.turnMs : busy ? state.sinceMs : state.turnMs)
      if (duration !== '') meta.push(duration)
      var todo = state.todo
      var todoText = ''
      if (todo !== null && todo !== undefined && typeof todo === 'object' && Number(todo.total) > 0) {
        todoText = tr(lang, 'todo', { d: Number(todo.done) || 0, t: Number(todo.total) || 0 })
      }

      var titleLines = [tr(lang, 'titleHead') + ' · ' + (busy ? text : tr(lang, 'done'))]
      if (todo !== null && todo !== undefined && typeof todo === 'object' && todo.current) {
        titleLines.push(tr(lang, 'todoNow') + '：' + todo.current)
      }
      if (busy && state.tool) titleLines.push(tr(lang, 'toolLabel') + '：' + state.tool)
      if (detail !== undefined && phase === 'tool' && cut(state.detail, 200) !== '') {
        titleLines.push(cut(state.detail, 200))
      }
      if (recent.length > 0) {
        titleLines.push(tr(lang, 'recent') + '：')
        for (var i = 0; i < recent.length && i < 4; i += 1) {
          var item = recent[i] || {}
          var mark = item.ok === false ? '✗' : '✓'
          var span = fmtDur(item.ms)
          titleLines.push(
            '  ' + mark + ' ' + verbOf(item.tool, lang) + (item.detail ? '：' + cut(item.detail, 40) : '') + (span ? ' · ' + span : ''),
          )
        }
      }

      var attributes = { className: 'das-pill', title: titleLines.join('\n') }
      if (busy) attributes['data-busy'] = ''
      if (!busy) attributes['data-idle'] = ''
      if (failed) attributes['data-failed'] = ''

      var children = [h('span', { key: 'dot', className: 'das-dot' }), h('span', { key: 'text', className: 'das-text' }, text)]
      for (var m = 0; m < meta.length; m += 1) {
        children.push(h('span', { key: 'sep' + m, className: 'das-sep' }, '·'))
        children.push(h('span', { key: 'meta' + m, className: 'das-dim' }, meta[m]))
      }
      if (todoText !== '') {
        children.push(h('span', { key: 'sept', className: 'das-sep' }, '·'))
        children.push(h('span', { key: 'todo', className: 'das-todo' }, todoText))
      }
      return h('div', attributes, children)
    }

    function apply(ctx) {
      ctxRef = ctx
      ctx.effect(function () {
        if (typeof document === 'undefined') return function () {}
        var style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-agent-status')
        style.textContent = CSS
        document.head.appendChild(style)
        return function () {
          style.remove()
        }
      })
      ctx.slots.inject('conversation.session.header.utilities', function () {
        return ctx.slots.register(
          { name: 'conversation.session.header.utilities', id: 'agent-status', order: 20 },
          StepBar,
        )
      })
    }

    return { inject: ['slots', 'locale'], apply: apply }
  },
})
