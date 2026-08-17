// relay-poll.js — 桌面端中继轮询模块
// 桌面端启动后自动轮询管理后台，拉取手机端发来的消息，
// 通过本地 SSE 事件流捕获 AI 回复，再发回管理后台。
import fs from 'fs'
import path from 'path'
import http from 'http'
import { paths } from './paths.js'

const ADMIN_API = process.env.CLOUD_AUTH_URL || 'https://zy.tangdou2027.top/admin'
const POLL_INTERVAL_MS = 3000
const REPLY_TIMEOUT_MS = 120000  // 2 分钟超时(正常回复几十秒,报错会立即返回)

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
 * 把回复里的本地媒体路径(/media/chat/xxx.png 等)上传到管理服务器,
 * 替换为公网 URL,让手机端 H5 能直接看到图片/视频/音乐。
 */
async function uploadMediaInReply(reply, token) {
  if (!reply) return reply
  const fs = await import('fs')
  const path = await import('path')
  const { paths } = await import('./paths.js')
  const sandboxDir = paths.sandboxDir

  // 匹配本地媒体路径:/media/chat/xxx.png, /media/music/xxx.mp3, /media/video/xxx.mp4
  const mediaRegex = /(\/media\/(?:chat|music|video)\/[^\s<>)"']+\.(?:png|jpg|jpeg|webp|gif|mp3|wav|m4a|mp4|webm|mov))/gi
  const matches = [...reply.matchAll(mediaRegex)]
  if (matches.length === 0) return reply

  let result = reply
  for (const m of matches) {
    const localPath = m[1]
    try {
      // /media/chat/img.png → sandbox/media/chat/img.png
      // /media/music/x.mp3 → sandbox/music/x.mp3
      // /media/video/x.mp4 → sandbox/videos/x.mp4
      let filePath
      if (localPath.startsWith('/media/chat/')) filePath = path.join(sandboxDir, 'media', 'chat', path.basename(localPath))
      else if (localPath.startsWith('/media/music/')) filePath = path.join(sandboxDir, 'music', path.basename(localPath))
      else if (localPath.startsWith('/media/video/')) filePath = path.join(sandboxDir, 'videos', path.basename(localPath))

      if (!filePath || !fs.existsSync(filePath)) continue

      const buffer = fs.readFileSync(filePath)
      const base64 = buffer.toString('base64')
      const filename = 'relay_' + path.basename(localPath)
      const resp = await fetch(`${ADMIN_API}/api/media/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filename, base64 }),
        signal: AbortSignal.timeout(30000),
      })
      const data = await resp.json()
      if (data.ok && data.url) {
        result = result.split(localPath).join(data.url)
      }
    } catch (e) {
      console.log(`[relay] 媒体上传失败 ${localPath}: ${e.message}`)
    }
  }
  return result
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
              // 忽略连接前的事件(ts 是 ISO 字符串,转时间戳比较)
              if (event.ts && typeof event.ts === 'string') {
                const eventTime = new Date(event.ts).getTime()
                if (eventTime < startTime - 5000) continue
              }

              // response 事件 = AI 回复完成(finishTurn)
              if (event.type === 'response') {
                const content = event.content || (event.data && event.data.content)
                console.log(`[relay] SSE 收到 response, content长度=${(content||'').length}`)
                if (content) { finish(content); return }
                // content 为空 = AI 报错后发的空 response,不处理(等 error 事件)
              }

              // error 事件 = AI 处理报错(如 LLM Key 无效/余额不足)
              if (event.type === 'error') {
                const errMsg = (event.data && event.data.error) || event.error || 'AI 处理出错'
                console.log(`[relay] SSE 收到 error: ${errMsg}`)
                // 只在当前消息的错误时触发(检查 label 是否包含 mobile_relay)
                finish('（AI 处理失败：' + errMsg + '。请检查桌面端 LLM 配置。）')
                return
              }

              // message_dropped = 消息被丢弃(重试耗尽)
              if (event.type === 'message_dropped') {
                const reason = (event.data && event.data.reason) || event.reason || '未知原因'
                console.log(`[relay] SSE 收到 message_dropped: ${reason}`)
                finish('（消息处理失败：' + reason + '。请检查桌面端 LLM API Key 和余额。）')
                return
              }

              // message 事件 = 本地渠道直投回复
              if (event.type === 'message') {
                const d = event.data || event
                const content = d.content || event.content
                const from = d.from || event.from
                const to = d.to || event.to
                console.log(`[relay] SSE 收到 message from=${from} to=${to} content长度=${(content||'').length}`)
                if (content && (from === 'consciousness' || from === 'jarvis' || to === 'mobile_relay')) {
                  finish(content)
                  return
                }
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
        // 把本地媒体路径上传到服务器,替换为公网 URL(让手机端能看到图片/视频/音乐)
        const enrichedReply = await uploadMediaInReply(reply, token)
        console.log(`[relay] 消息 ${msg.id} 回复: ${(enrichedReply || '').slice(0, 80)}...`)

        await fetch(`${ADMIN_API}/api/relay/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: msg.id, reply: enrichedReply }),
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
