// relay-poll.js — 桌面端中继轮询模块
// 桌面端启动后自动轮询管理后台，拉取手机端发来的消息，
// 通过本地 SSE 事件流捕获 AI 回复，再发回管理后台。
import fs from 'fs'
import path from 'path'
import { paths } from './paths.js'

const ADMIN_API = process.env.CLOUD_AUTH_URL || 'https://zy.tangdou2027.top/admin'
const POLL_INTERVAL_MS = 3000
const REPLY_TIMEOUT_MS = 120000  // AI 回复最长等待 2 分钟
const SSE_RECONNECT_DELAY = 2000

let polling = false
let localPort = 0
let timer = null
let tokenWarned = false
let processing = new Set()  // 正在处理中的消息 ID

// 多路径 token 查找
function findToken() {
  const candidates = [
    path.join(paths.userDir, '.cloud-auth-token'),
    path.join(process.env.BAILONGMA_USER_DIR || paths.userDir, '.cloud-auth-token'),
  ]
  // Windows: %APPDATA%\myai 或 %APPDATA%\MyAI（大小写都查）
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'myai', '.cloud-auth-token'))
    candidates.push(path.join(process.env.APPDATA, 'MyAI', '.cloud-auth-token'))
    candidates.push(path.join(process.env.APPDATA, 'xiaobailong', '.cloud-auth-token'))
  }
  // macOS: ~/Library/Application Support/myai 或 MyAI
  if (process.env.HOME) {
    candidates.push(path.join(process.env.HOME, 'Library', 'Application Support', 'myai', '.cloud-auth-token'))
    candidates.push(path.join(process.env.HOME, 'Library', 'Application Support', 'MyAI', '.cloud-auth-token'))
  }
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8').trim() } catch {}
  }
  return null
}

export function startRelayPoller(port) {
  localPort = port
  if (polling) return
  polling = true
  console.log('[relay] 启动中继轮询，本地端口', port, '，管理后台', ADMIN_API)
  const token = findToken()
  if (token) console.log('[relay] 云端认证 token 已找到，轮询激活')
  else console.log('[relay] 云端认证 token 未找到，等待登录后自动激活')

  timer = setInterval(pollAndProcess, POLL_INTERVAL_MS)
  pollAndProcess()
}

export function stopRelayPoller() {
  polling = false
  if (timer) { clearInterval(timer); timer = null }
}

/**
 * 发消息到本地后端 + 通过 SSE 等待 AI 回复
 * 模拟桌面端的完整 Turn 生命周期
 */
async function sendAndWaitForReply(content) {
  // 用 SSE 监听回复 + HTTP POST 发消息的组合
  // SSE 连接先开，确保不漏事件
  return new Promise(async (resolve) => {
    let resolved = false
    let sse = null
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        resolve('（回复超时，请稍后重试）')
      }
    }, REPLY_TIMEOUT_MS)

    function cleanup() {
      clearTimeout(timeoutId)
      if (sse) { try { sse.close() } catch {} }
    }

    function finish(reply) {
      if (resolved) return
      resolved = true
      cleanup()
      resolve(reply)
    }

    try {
      // 1. 连接 SSE 事件流（Node.js 用 HTTP 长连接）
      const http = await import('http')

      let buffer = ''
      const req = http.get({
        hostname: '127.0.0.1',
        port: localPort,
        path: '/events',
        headers: { 'Accept': 'text/event-stream' },
      }, (resp) => {
        resp.on('data', (chunk) => {
          buffer += chunk.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6))

              // 收到 AI 回复
              if (event.type === 'response' && event.content) {
                finish(event.content)
                return
              }

              // 工具调用中的进度（不结束，继续等）
              if (event.type === 'tool_call' || event.type === 'tool_executing') {
                // AI 在调工具，继续等
              }

              // 处理被中断
              if (event.type === 'processing_preempted') {
                finish('（处理被中断，请重试）')
                return
              }
            } catch {}
          }
        })

        resp.on('error', () => {
          if (!resolved) finish('（SSE 连接断开）')
        })
      })

      req.on('error', () => {
        if (!resolved) finish('（无法连接本地后端）')
      })

      // 2. 发送消息到后端（触发 AI 回复）
      const postData = JSON.stringify({
        from_id: 'mobile_relay',
        content: content,
        channel: 'API',
      })

      const msgReq = http.request({
        hostname: '127.0.0.1',
        port: localPort,
        path: '/message',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      }, (msgResp) => {
        msgResp.resume()
        msgResp.on('end', () => {
          // 消息已入队，等 SSE 推送回复
        })
      })

      msgReq.on('error', () => {
        if (!resolved) finish('（发送消息失败）')
      })
      msgReq.write(postData)
      msgReq.end()

    } catch (err) {
      if (!resolved) finish('（处理异常: ' + (err?.message || '未知错误') + '）')
    }
  })
}

async function pollAndProcess() {
  const token = findToken()
  if (!token) {
    if (!tokenWarned) {
      console.log('[relay] 未找到云端认证 token，中继轮询暂不启动')
      tokenWarned = true
    }
    return
  }
  if (!localPort) return
  if (tokenWarned) { console.log('[relay] 找到 token，轮询激活'); tokenWarned = false }

  try {
    // 1. 拉取待处理消息
    const pollResp = await fetch(`${ADMIN_API}/api/relay/poll`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!pollResp.ok) return
    const data = await pollResp.json()
    const messages = data.messages || []
    if (messages.length === 0) return

    console.log(`[relay] 收到 ${messages.length} 条消息`)

    // 2. 逐条处理（串行，避免并发 AI 调用冲突）
    for (const msg of messages) {
      if (processing.has(msg.id)) continue
      processing.add(msg.id)
      console.log(`[relay] 处理消息 ${msg.id}: ${msg.content?.slice(0, 50)}...`)

      try {
        // 发消息 + SSE 等待回复
        const reply = await sendAndWaitForReply(msg.content)
        console.log(`[relay] 消息 ${msg.id} 回复: ${reply?.slice(0, 50)}...`)

        // 3. 回复发回管理后台
        await fetch(`${ADMIN_API}/api/relay/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: msg.id, reply }),
          signal: AbortSignal.timeout(10000),
        })

        console.log(`[relay] 消息 ${msg.id} 已回复并同步`)
      } catch (err) {
        console.warn(`[relay] 消息 ${msg.id} 处理失败:`, err?.message)
        // 发送错误回复，避免手机端永远等
        try {
          await fetch(`${ADMIN_API}/api/relay/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ id: msg.id, reply: `（处理失败: ${err?.message || '未知错误'}）` }),
            signal: AbortSignal.timeout(5000),
          })
        } catch {}
      } finally {
        processing.delete(msg.id)
      }
    }
  } catch (err) {
    if (!err?.message?.includes('abort')) {
      console.warn('[relay] 轮询失败:', err?.message)
    }
  }
}
