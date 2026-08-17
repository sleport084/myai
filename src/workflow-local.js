// workflow-local.js — 桌面端本地工作流引擎
// 客户在自己电脑上创建/定制工作流,本地调度本地执行,不依赖服务器
// 数据存本地 SQLite(jarvis.db),可选云端备份
import { getDB } from './db.js'
import { emitEvent } from './events.js'

const POLL_TICK_MS = 15 * 1000   // 调度器心跳

let schedulerTimer = null
let executing = false

// ── 建表(幂等) ─────────────────────────────────────────
function ensureTables() {
  const db = getDB()
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_workflows (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT DEFAULT '',
      spec        TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      runs_count  INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS local_cron (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id  INTEGER NOT NULL REFERENCES local_workflows(id) ON DELETE CASCADE,
      cron_expr    TEXT NOT NULL,
      enabled      INTEGER NOT NULL DEFAULT 1,
      last_run_at  TEXT,
      next_run_at  TEXT,
      run_count    INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS local_task_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER,
      trigger     TEXT DEFAULT 'manual',
      status      TEXT NOT NULL,
      result      TEXT,
      error       TEXT,
      duration_ms INTEGER,
      created_at  TEXT DEFAULT (datetime('now'))
    );
  `)
}

// ── cron 解析(同服务端实现) ─────────────────────────────
function nextCronRun(expr, from = new Date()) {
  const parts = String(expr).trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [mf, mh, mdom, mmon, mdow] = parts
  const d = new Date(from.getTime() + 60 * 1000)
  d.setSeconds(0, 0)
  for (let i = 0; i < 1051200; i++) {  // 最多找 2 年
    if (matchField(mf, d.getMinutes()) && matchField(mh, d.getHours())
      && matchDomMonDow(mdom, mmon, mdow, d)) return d
    d.setTime(d.getTime() + 60 * 1000)
  }
  return null
}
function matchField(field, value) {
  if (field === '*') return true
  for (const part of String(field).split(',')) {
    if (part.startsWith('*/')) { const n = parseInt(part.slice(2)); if (n > 0 && value % n === 0) return true }
    else if (part.includes('-')) { const [a, b] = part.split('-').map(Number); if (value >= a && value <= b) return true }
    else if (parseInt(part) === value) return true
  }
  return false
}
function matchDomMonDow(domF, monF, dowF, d) {
  const domOk = matchField(domF, d.getDate()), monOk = matchField(monF, d.getMonth() + 1), dowOk = matchField(dowF, d.getDay())
  if (domF !== '*' && dowF !== '*') return monOk && (domOk || dowOk)
  return domOk && monOk && dowOk
}

// ── CRUD(供本地 API 调用) ──────────────────────────────
export function listWorkflows() {
  ensureTables()
  const db = getDB()
  const rows = db.prepare('SELECT * FROM local_workflows ORDER BY id DESC').all()
  return rows.map(r => ({ ...r, spec: JSON.parse(r.spec), cron: getCronForWorkflow(r.id) }))
}
function getCronForWorkflow(workflowId) {
  const db = getDB()
  const c = db.prepare('SELECT * FROM local_cron WHERE workflow_id=? AND enabled=1').get(workflowId)
  return c ? { id: c.id, cron_expr: c.cron_expr, next_run_at: c.next_run_at, run_count: c.run_count } : null
}
export function createWorkflow({ name, description, spec, cron_expr }) {
  ensureTables()
  const db = getDB()
  validateSpec(spec)
  const r = db.prepare('INSERT INTO local_workflows(name, description, spec) VALUES(?,?,?)')
    .run(name, description || '', JSON.stringify(spec))
  const id = r.lastInsertRowid
  if (cron_expr) setCron(id, cron_expr)
  return id
}
export function updateWorkflow(id, { name, description, spec, enabled, cron_expr }) {
  ensureTables()
  const db = getDB()
  if (spec !== undefined) { validateSpec(spec); db.prepare("UPDATE local_workflows SET spec=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(spec), id) }
  if (name !== undefined) db.prepare('UPDATE local_workflows SET name=? WHERE id=?').run(name, id)
  if (description !== undefined) db.prepare('UPDATE local_workflows SET description=? WHERE id=?').run(description, id)
  if (enabled !== undefined) db.prepare('UPDATE local_workflows SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id)
  if (cron_expr !== undefined) { if (cron_expr) setCron(id, cron_expr); else db.prepare('DELETE FROM local_cron WHERE workflow_id=?').run(id) }
  return true
}
export function deleteWorkflow(id) {
  ensureTables()
  const db = getDB()
  db.prepare('DELETE FROM local_cron WHERE workflow_id=?').run(id)
  db.prepare('DELETE FROM local_workflows WHERE id=?').run(id)
  return true
}
function setCron(workflowId, cronExpr) {
  const db = getDB()
  const next = nextCronRun(cronExpr)
  if (!next) throw new Error('cron 表达式无效(需 5 段: 分 时 日 月 周)')
  const existing = db.prepare('SELECT id FROM local_cron WHERE workflow_id=?').get(workflowId)
  if (existing) {
    db.prepare('UPDATE local_cron SET cron_expr=?, enabled=1, next_run_at=? WHERE workflow_id=?').run(cronExpr, next.toISOString(), workflowId)
  } else {
    db.prepare('INSERT INTO local_cron(workflow_id, cron_expr, next_run_at) VALUES(?,?,?)').run(workflowId, cronExpr, next.toISOString())
  }
}

export function validateSpec(spec) {
  const validTypes = ['message', 'generate_image', 'notify', 'web_search', 'exec_command', 'api_call', 'delay', 'sequence', 'queue']
  function walk(node) {
    if (!node || typeof node !== 'object') throw new Error('spec 必须是对象')
    if (!node.type) throw new Error('动作缺少 type')
    if (!validTypes.includes(node.type)) throw new Error(`未知动作类型: ${node.type}`)
    if (node.type === 'sequence') { if (!Array.isArray(node.steps)) throw new Error('sequence 需要 steps 数组'); node.steps.forEach(walk) }
    if (node.type === 'queue') { if (!node.action) throw new Error('queue 需要 action'); walk(node.action) }
  }
  walk(spec)
}

export function listTaskLog(limit = 50) {
  ensureTables()
  const db = getDB()
  return db.prepare('SELECT l.*, w.name as workflow_name FROM local_task_log l LEFT JOIN local_workflows w ON l.workflow_id=w.id ORDER BY l.id DESC LIMIT ?').all(limit)
}

// ── 调度器 ─────────────────────────────────────────────
export function startLocalScheduler() {
  if (schedulerTimer) return
  ensureTables()
  const tick = async () => {
    try {
      const db = getDB()
      const due = db.prepare("SELECT * FROM local_cron WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at<=?").all(new Date().toISOString())
      for (const c of due) {
        const wf = db.prepare('SELECT * FROM local_workflows WHERE id=? AND enabled=1').get(c.workflow_id)
        if (wf) {
          console.log(`[workflow-local] 定时触发「${wf.name}」`)
          runWorkflowNow(c.workflow_id, 'cron').catch(e => console.warn('[workflow-local] 执行失败:', e.message))
        }
        const next = nextCronRun(c.cron_expr)
        db.prepare("UPDATE local_cron SET last_run_at=datetime('now'), next_run_at=?, run_count=run_count+1 WHERE id=?")
          .run(next ? next.toISOString() : null, c.id)
      }
    } catch (e) { console.warn('[workflow-local] 调度错误:', e.message) }
  }
  tick()
  schedulerTimer = setInterval(tick, POLL_TICK_MS)
  console.log(`[workflow-local] 本地工作流调度器已启动(${POLL_TICK_MS / 1000}s/次)`)
}

// ── 执行器 ─────────────────────────────────────────────
export async function runWorkflowNow(workflowId, trigger = 'manual') {
  ensureTables()
  const db = getDB()
  const wf = db.prepare('SELECT * FROM local_workflows WHERE id=? AND enabled=1').get(workflowId)
  if (!wf) throw new Error('工作流不存在或已禁用')
  const started = Date.now()
  emitEvent('workflow_started', { id: wf.id, name: wf.name, trigger })
  try {
    const result = await executeNode(JSON.parse(wf.spec), { deadline: Date.now() + 300000, depth: 0 })
    const duration = Date.now() - started
    db.prepare("UPDATE local_workflows SET runs_count=runs_count+1, last_run_at=datetime('now') WHERE id=?").run(workflowId)
    db.prepare('INSERT INTO local_task_log(workflow_id, trigger, status, result, duration_ms) VALUES(?,?,?,?,?)')
      .run(workflowId, trigger, 'done', JSON.stringify(result).slice(0, 20000), duration)
    emitEvent('workflow_finished', { id: wf.id, name: wf.name, trigger, status: 'done', duration_ms: duration })
    console.log(`[workflow-local] 「${wf.name}」完成(${(duration / 1000).toFixed(1)}s)`)
    return { ok: true, duration_ms: duration, result }
  } catch (e) {
    const duration = Date.now() - started
    db.prepare('INSERT INTO local_task_log(workflow_id, trigger, status, error, duration_ms) VALUES(?,?,?,?,?)')
      .run(workflowId, trigger, 'failed', String(e.message).slice(0, 2000), duration)
    emitEvent('workflow_finished', { id: wf.id, name: wf.name, trigger, status: 'failed', error: e.message })
    console.warn(`[workflow-local] 「${wf.name}」失败: ${e.message}`)
    throw e
  }
}

async function executeNode(node, ctx) {
  if (!node || typeof node !== 'object') throw new Error('无效的动作节点')
  if (Date.now() > ctx.deadline) throw new Error('工作流超时')
  if (ctx.depth > 10) throw new Error('嵌套过深')
  switch (node.type) {
    case 'message': {
      if (!node.content) throw new Error('message 需要 content')
      const reply = await sendToAgent(node.content)
      return { reply: String(reply).slice(0, 5000) }
    }
    case 'generate_image': {
      if (!node.prompt) throw new Error('generate_image 需要 prompt')
      const reply = await sendToAgent(`请生成一张图片: ${node.prompt}${node.aspect_ratio ? ` (比例 ${node.aspect_ratio})` : ''}`)
      return { reply: String(reply).slice(0, 5000) }
    }
    case 'web_search': {
      if (!node.query) throw new Error('web_search 需要 query')
      const reply = await sendToAgent(`搜索并总结: ${node.query}`)
      return { reply: String(reply).slice(0, 5000) }
    }
    case 'notify': {
      const title = node.title || 'MyAI 工作流'
      const body = node.body || ''
      emitEvent('notification', { title, body })
      showOSNotification(title, body)
      return { notified: true }
    }
    case 'exec_command': {
      const cmd = String(node.command || '')
      if (!cmd) throw new Error('exec_command 需要 command')
      const safe = /^(echo|date|ls|cat|pwd|whoami|python3?|node|git status|git log)/.test(cmd.trim())
      if (!safe) throw new Error(`exec_command 被安全策略拒绝(仅白名单命令): ${cmd.slice(0, 50)}`)
      const reply = await sendToAgent(`执行命令并告诉我结果: ${cmd}`)
      return { reply: String(reply).slice(0, 5000) }
    }
    case 'api_call': {
      if (!node.url) throw new Error('api_call 需要 url')
      const method = (node.method || 'GET').toUpperCase()
      const resp = await fetch(node.url, {
        method,
        headers: node.headers || { 'Content-Type': 'application/json' },
        body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(node.body || {}),
        signal: AbortSignal.timeout(Math.min(node.timeout_ms || 30000, 60000)),
      })
      const text = await resp.text()
      return { status: resp.status, body: text.slice(0, 5000) }
    }
    case 'delay': {
      const ms = Math.min(parseInt(node.ms || (node.seconds || 1) * 1000 || 1000), 60000)
      await new Promise(r => setTimeout(r, ms))
      return { delayed: ms }
    }
    case 'sequence': {
      const steps = Array.isArray(node.steps) ? node.steps : []
      const results = []
      for (const s of steps) {
        try { results.push(await executeNode(s, { ...ctx, depth: ctx.depth + 1 })) }
        catch (e) { if (node.onError === 'continue') { results.push({ error: e.message }); continue } throw e }
      }
      return { steps: results.length, results }
    }
    case 'queue':
      return executeNode(node.action, { ...ctx, depth: ctx.depth + 1 })
    default: throw new Error(`未知动作类型: ${node.type}`)
  }
}

// 发给本地 AI 并等回复(监听 SSE)
let localApiPort = 0
function sendToAgent(content) {
  return new Promise((resolve) => {
    let done = false
    let req = null
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); try { req?.destroy() } catch {} resolve(v) } }
    const timer = setTimeout(() => finish('(超时未回复)'), 240000)
    const startTime = Date.now()
    let buf = ''
    // 动态 import http 避免顶层依赖
    import('http').then(http => {
      req = http.get({ hostname: '127.0.0.1', port: localApiPort, path: '/events', headers: { Accept: 'text/event-stream' }, timeout: 250000 }, resp => {
        resp.setEncoding('utf-8')
        resp.on('data', chunk => {
          buf += chunk
          const parts = buf.split('\n\n'); buf = parts.pop() || ''
          for (const part of parts) {
            for (const line of part.split('\n')) {
              if (!line.startsWith('data: ')) continue
              try {
                const evt = JSON.parse(line.slice(6))
                if (evt.ts && typeof evt.ts === 'string' && new Date(evt.ts).getTime() < startTime - 5000) continue
                if (evt.type === 'response') { finish(evt.content || evt.data?.content || ''); return }
                if (evt.type === 'error') { finish('(AI错误: ' + ((evt.data?.error) || '') + ')'); return }
              } catch {}
            }
          }
        })
        resp.on('error', () => finish('(SSE断开)'))
      })
      req.on('error', () => finish('(连接失败)'))
      // 发消息
      setTimeout(() => {
        const postData = JSON.stringify({ from_id: 'workflow_local', content, channel: 'API' })
        const m = http.request({ hostname: '127.0.0.1', port: localApiPort, path: '/message', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }, timeout: 10000 }, r => r.resume())
        m.on('error', () => finish('(发送失败)'))
        m.write(postData); m.end()
      }, 300)
    })
  })
}

// ── OS 原生通知(参考小裂变: 去重 + 点击聚焦 + 尽力投递不阻塞) ──
const _notifyShownKeys = new Set()
function showOSNotification(title, body) {
  // 异步尽力投递: 通知失败绝不影响工作流
  setImmediate(() => {
    try {
      const dedupeKey = title + '|' + body
      if (_notifyShownKeys.has(dedupeKey)) return   // 去重(同内容只弹一次)
      if (_notifyShownKeys.size > 512) _notifyShownKeys.clear()
      _notifyShownKeys.add(dedupeKey)
      // 后端运行在 Electron 主进程内,动态取 electron
      import('electron').then(({ Notification, BrowserWindow }) => {
        if (!Notification?.isSupported?.()) return
        const n = new Notification({ title: String(title).slice(0, 80), body: String(body).slice(0, 240) })
        n.on('click', () => {   // 点击通知 → 聚焦主窗口
          try { const w = BrowserWindow.getAllWindows().find(x => !x.isDestroyed()); if (w) { w.show(); w.focus() } } catch {}
        })
        n.show()
      }).catch(() => {})
    } catch { /* best effort */ }
  })
}

export function initWorkflowLocal(port) {
  localApiPort = port
  startLocalScheduler()
}
