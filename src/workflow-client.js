// workflow-client.js — 桌面端工作流执行器
// 轮询管理后台任务队列,领取任务并在本地执行 ActionSpec,上报结果
// 执行的动作在本地后端(localhost:3721)完成,因为浏览器/命令/图片生成都需要本地环境

import http from 'http'
import fs from 'fs'
import path from 'path'
import { paths } from './paths.js'

const ADMIN_API = process.env.CLOUD_AUTH_URL || 'https://zy.tangdou2027.top/admin'
const POLL_INTERVAL_MS = 20 * 1000
const WORKER_ID = 'desktop_' + process.pid

let localPort = 0
let pollTimer = null
let running = false

export function startWorkflowClient(port) {
  localPort = port
  if (pollTimer) return
  pollTimer = setInterval(pollAndExecute, POLL_INTERVAL_MS)
  setTimeout(pollAndExecute, 8000)  // 启动后 8 秒开始
  console.log(`[workflow] 桌面端工作流执行器已启动(worker=${WORKER_ID}, 每${POLL_INTERVAL_MS / 1000}s轮询)`)
}

// ── 轮询领取 + 执行 ──
async function pollAndExecute() {
  if (running) return  // 上一个还在执行(简单并发控制=1)
  running = true
  try {
    const token = findToken()
    if (!token) return
    // 领取一个任务
    const resp = await fetch(`${ADMIN_API}/api/tasks/poll?worker=${WORKER_ID}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    })
    if (!resp.ok) {
      if (resp.status === 401) console.warn('[workflow] token 已过期,请在应用内重新登录以恢复任务执行')
      return
    }
    const data = await resp.json()
    if (!data.task) return  // 无任务

    const task = data.task
    console.log(`[workflow] 领取任务 #${task.id} (workflow=${task.workflow_id || '-'}, 尝试 ${task.attempts}/${task.max_attempts || '∞'})`)
    try {
      const result = await executeSpec(task.action_spec, task.timeout_ms)
      await reportResult(token, task.id, true, result)
      console.log(`[workflow] 任务 #${task.id} 完成`)
    } catch (e) {
      console.warn(`[workflow] 任务 #${task.id} 失败: ${e.message}`)
      await reportResult(token, task.id, false, null, e.message)
    }
  } catch (e) {
    if (!e?.message?.includes('abort')) console.warn('[workflow] 轮询失败:', e.message)
  } finally {
    running = false
  }
}

// ── ActionSpec 执行器 ──
async function executeSpec(spec, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs
  return executeNode(spec, { deadline, depth: 0 })
}

async function executeNode(node, ctx) {
  if (!node || typeof node !== 'object') throw new Error('无效的动作节点')
  if (Date.now() > ctx.deadline) throw new Error('工作流超时')
  if (ctx.depth > 10) throw new Error('嵌套过深(>10)')

  switch (node.type) {
    case 'message': {
      // 发送消息给本地 AI(触发完整 agent turn),等待回复
      if (!node.content) throw new Error('message 需要 content')
      return await sendToLocalAgent(node.content)
    }
    case 'generate_image': {
      if (!node.prompt) throw new Error('generate_image 需要 prompt')
      return await sendToLocalAgent(`请生成一张图片: ${node.prompt}${node.aspect_ratio ? ` (比例 ${node.aspect_ratio})` : ''}`)
    }
    case 'web_search': {
      if (!node.query) throw new Error('web_search 需要 query')
      return await sendToLocalAgent(`搜索: ${node.query}`)
    }
    case 'notify': {
      // 桌面通知(经本地后端 SSE 事件)
      const title = node.title || 'MyAI 工作流'
      const body = node.body || ''
      await localEvent('notify', { title, body })
      return { notified: true, title }
    }
    case 'exec_command': {
      if (!node.command) throw new Error('exec_command 需要 command')
      // 高危: 只允许白名单命令模式
      const cmd = node.command
      const safe = /^(echo|date|ls|cat|pwd|whoami|python3?|node|git status|git log)/.test(cmd.trim())
      if (!safe) throw new Error(`exec_command 被安全策略拒绝(仅允许只读/白名单命令): ${cmd.slice(0, 60)}`)
      return await sendToLocalAgent(`执行命令并告诉我结果: ${cmd}`)
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
      const ms = Math.min(parseInt(node.ms || node.seconds * 1000 || 1000), 60000)
      await new Promise(r => setTimeout(r, ms))
      return { delayed: ms }
    }
    case 'sequence': {
      const steps = Array.isArray(node.steps) ? node.steps : []
      const results = []
      for (const step of steps) {
        try {
          results.push(await executeNode(step, { ...ctx, depth: ctx.depth + 1 }))
        } catch (e) {
          if (node.onError === 'continue') { results.push({ error: e.message }); continue }
          throw e
        }
      }
      return { steps: results.length, results }
    }
    case 'queue': {
      // queue 动作在桌面端直接同步执行(嵌套入队由服务端处理)
      return await executeNode(node.action, { ...ctx, depth: ctx.depth + 1 })
    }
    default:
      throw new Error(`未知动作类型: ${node.type}`)
  }
}

// ── 发送消息给本地 AI agent 并等待回复(复用 relay 的 SSE 监听模式) ──
function sendToLocalAgent(content) {
  return new Promise((resolve) => {
    let resolvedFlag = false
    let sseReq = null
    const timeoutId = setTimeout(() => {
      if (!resolvedFlag) { resolvedFlag = true; if (sseReq) try { sseReq.destroy() } catch {} resolve({ timeout: true, content: content.slice(0, 50) }) }
    }, 240000)  // 4 分钟

    const startTime = Date.now()
    let buffer = ''
    sseReq = http.get({
      hostname: '127.0.0.1', port: localPort, path: '/events',
      headers: { Accept: 'text/event-stream' }, timeout: 250000,
    }, (resp) => {
      resp.setEncoding('utf-8')
      resp.on('data', (chunk) => {
        buffer += chunk
        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''
        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue
            try {
              const evt = JSON.parse(line.slice(6))
              if (evt.ts && typeof evt.ts === 'string' && new Date(evt.ts).getTime() < startTime - 5000) continue
              if (evt.type === 'response') {
                const c = evt.content || (evt.data && evt.data.content)
                if (c && !resolvedFlag) { resolvedFlag = true; clearTimeout(timeoutId); try { sseReq.destroy() } catch {} resolve({ reply: c.slice(0, 5000) }) }
                return
              }
              if (evt.type === 'error' && !resolvedFlag) {
                const em = (evt.data && evt.data.error) || 'AI 处理出错'
                if (!resolvedFlag) { resolvedFlag = true; clearTimeout(timeoutId); try { sseReq.destroy() } catch {} resolve({ error: em }) }
                return
              }
            } catch {}
          }
        }
      })
      resp.on('error', () => { if (!resolvedFlag) { resolvedFlag = true; clearTimeout(timeoutId); resolve({ error: 'SSE 断开' }) } })
    })
    sseReq.on('error', () => { if (!resolvedFlag) { resolvedFlag = true; clearTimeout(timeoutId); resolve({ error: '无法连接本地后端' }) } })

    // 发消息
    setTimeout(() => {
      const postData = JSON.stringify({ from_id: `workflow_${WORKER_ID}`, content, channel: 'API' })
      const msgReq = http.request({
        hostname: '127.0.0.1', port: localPort, path: '/message', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }, timeout: 10000,
      }, (r) => r.resume())
      msgReq.on('error', () => { if (!resolvedFlag) { resolvedFlag = true; clearTimeout(timeoutId); resolve({ error: '发送失败' }) } })
      msgReq.write(postData); msgReq.end()
    }, 300)
  })
}

// ── 本地事件(通知等) ──
function localEvent(type, data) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ type, data })
    const req = http.request({
      hostname: '127.0.0.1', port: localPort, path: '/events/emit', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }, timeout: 5000,
    }, (r) => { r.resume(); resolve(true) })
    req.on('error', () => resolve(false))
    req.write(postData); req.end()
  })
}

// ── 结果上报 ──
async function reportResult(token, taskId, ok, result, error) {
  try {
    await fetch(`${ADMIN_API}/api/tasks/${taskId}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ worker: WORKER_ID, ok, result, error }),
      signal: AbortSignal.timeout(15000),
    })
  } catch (e) { console.warn(`[workflow] 上报任务 #${taskId} 结果失败:`, e.message) }
}

// ── token 查找(与 relay-poll 相同的多路径策略) ──
function findToken() {
  const candidates = [
    path.join(paths.userDir, '.cloud-auth-token'),
    path.join(process.cwd(), '.cloud-auth-token'),
  ]
  for (const p of candidates) {
    try { return fs.readFileSync(p, 'utf-8').trim() } catch {}
  }
  return null
}
