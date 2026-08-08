// relay-poll.js — 桌面端中继轮询模块
// 桌面端启动后自动轮询管理后台，拉取手机端发来的消息，
// 通过本地 SSE 事件流捕获 AI 回复，再发回管理后台。
import fs from 'fs'
import path from 'path'
import http from 'http'
import { paths } from './paths.js'

const ADMIN_API = process.env.CLOUD_AUTH_URL || 'https://zy.tangdou2027.top/admin'
const POLL_INTERVAL_MS = 3000
const REPLY_TIMEOUT_MS = 180000  // 3 分钟超时

let polling = false
let localPort = 0
let timer = null
let tokenWarned = false
const processing = new Set()

// 多路径 token 查找
function findToken() {
  const candidates = [
    path.join(paths.userDir, '.cloud-auth-token'),
    path.join(process.env.BAILONGMA_USER_DIR || paths.userDir, '.cloud-auth-token'),
  ]
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'myai', '.cloud-auth-token'))
    candidates.push(path.join(process.env.APPDATA, 'MyAI', '.cloud-auth-token'))
  }
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
 *
 * 桌面端 AI 回复通过两种 SSE 事件推送：
 * - 'response' (finishTurn) — 标准回复完成
 * - 'message' (deliverFallbackReply / deliverDirectReply) — 本地渠道直投
 *
 * 两种都要监听，先收到的就是回复。
 */
function sendAndWaitForReply(content) {
  return new Promise((resolve) => {
    let resolved = false
    let sseReq = null

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        resolve('（回复超时，请稍后重试）')
      }
    }, REPLY_TIMEOUT_MS)

    function cleanup() {
      clearTimeout(timeoutId)
      if (sseReq) { try { sseReq.destroy() } catch {} }
    }

    function finish(reply) {
      if (resolved) return
      resolved = true
      cleanup()
      resolve(reply)
    }

    // SSE 缓冲区 — 事件以 \n\n 分隔
    let sseBuffer = ''
    // 记录 turn 开始后的消息，用于过滤旧事件
    const startTime = Date.now()

    // 1. 连接 SSE 事件流
    sseReq = http.get({
      hostname: '127.0.0.1',
      port: localPort,
      path: '/events',
      headers: { 'Accept': 'text/event-stream' },
      timeout: REPLY_TIMEOUT_MS + 5000,
    }, (resp) => {
      resp.setEncoding('utf-8')
      resp.on('data', (chunk) => {
        sseBuffer += chunk
        // SSE 事件以空行(\n\n)分隔
        const parts = sseBuffer.split('\n\n')
        sseBuffer = parts.pop() || '' // 最后一段可能不完整，保留

        for (const part of parts) {
          const lines = part.split('\n')
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const jsonStr = line.slice(6)
            try {
              const event = JSON.parse(jsonStr)
              // 忽略连接前的事件
              if (event.ts && typeof event.ts === 'number' && event.ts < startTime - 5000) continue

              // response 事件 = AI 回复完成(finishTurn)
              if (event.type === 'response' && event.content) {
                finish(event.content)
                return
              }

              // message 事件 = 本地渠道直投回复
              // 只接受 from='consciousness' 或 from='jarvis' 的消息作为回复
              if (event.type === 'message' && event.content &&
                  (event.from === 'consciousness' || event.from === 'jarvis' || event.to === 'mobile_relay')) {
                finish(event.content)
                return
              }
            } catch {}
          }
        }
      })

      resp.on('error', () => {
        if (!resolved) finish('（SSE 连接断开）')
      })
    })

    sseReq.on('error', () => {
      if (!resolved) finish('（无法连接本地后端）')
    })

    // 2. 发送消息到后端（触发 AI 回复）
    // 稍微延迟确保 SSE 连接已建立
    setTimeout(() => {
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
        timeout: 10000,
      }, (msgResp) => {
        msgResp.resume()
      })
      msgReq.on('error', () => {
        if (!resolved) finish('（发送消息失败）')
      })
      msgReq.write(postData)
      msgReq.end()
    }, 200)
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

    // 2. 逐条处理（串行）
    for (const msg of messages) {
      if (processing.has(msg.id)) continue
      processing.add(msg.id)
      console.log(`[relay] 处理消息 ${msg.id}: ${(msg.content || '').slice(0, 50)}...`)

      try {
        const reply = await sendAndWaitForReply(msg.content)
        console.log(`[relay] 消息 ${msg.id} 回复: ${(reply || '').slice(0, 80)}...`)

        await fetch(`${ADMIN_API}/api/relay/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: msg.id, reply }),
          signal: AbortSignal.timeout(10000),
        })

        console.log(`[relay] 消息 ${msg.id} 已回复并同步`)
      } catch (err) {
        console.warn(`[relay] 消息 ${msg.id} 处理失败:`, err?.message)
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
