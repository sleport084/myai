// relay-poll.js — 桌面端中继轮询模块
// 桌面端启动后自动轮询管理后台，拉取手机端发来的消息，
// 通过本地 /message API 处理后回复。
// 这样手机端不需要局域网也不需要公网IP，通过云端中继即可对话。
import { getCachedToken, getCachedUser } from './cloud-auth.js'
import { paths } from './paths.js'

const ADMIN_API = process.env.CLOUD_AUTH_URL || 'https://zy.tangdou2027.top/admin'
const POLL_INTERVAL_MS = 3000  // 每 3 秒轮询一次

let polling = false
let localPort = 0
let timer = null

/**
 * 启动中继轮询
 * @param {number} port - 本地后端 HTTP 端口
 */
export function startRelayPoller(port) {
  localPort = port
  if (polling) return
  polling = true
  console.log('[relay] 启动中继轮询，间隔', POLL_INTERVAL_MS, 'ms')

  timer = setInterval(pollAndProcess, POLL_INTERVAL_MS)
  // 立即执行一次
  pollAndProcess()
}

export function stopRelayPoller() {
  polling = false
  if (timer) { clearInterval(timer); timer = null }
}

async function pollAndProcess() {
  const token = getCachedToken()
  if (!token || !localPort) return

  try {
    // 1. 从管理后台拉取待处理消息
    const pollResp = await fetch(`${ADMIN_API}/api/relay/poll`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!pollResp.ok) return
    const data = await pollResp.json()
    const messages = data.messages || []

    // 2. 逐条处理：转发给本地后端的 /message API
    for (const msg of messages) {
      try {
        const localResp = await fetch(`http://127.0.0.1:${localPort}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from_id: 'mobile_relay',
            content: msg.content,
            channel: 'API',
          }),
          signal: AbortSignal.timeout(120000),  // AI 回复可能需要时间
        })

        // 3. 获取 AI 回复
        let reply = '（已处理）'
        if (localResp.ok) {
          const result = await localResp.json()
          reply = result.reply || result.content || '（已收到）'
        }

        // 4. 把回复发回管理后台
        await fetch(`${ADMIN_API}/api/relay/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: msg.id, reply }),
          signal: AbortSignal.timeout(5000),
        })

        console.log(`[relay] 消息 ${msg.id} 已处理并回复`)
      } catch (err) {
        console.warn(`[relay] 消息 ${msg.id} 处理失败:`, err?.message)
        // 标记为错误回复，避免卡住
        try {
          await fetch(`${ADMIN_API}/api/relay/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ id: msg.id, reply: `（处理失败: ${err?.message || '未知错误'}）` }),
            signal: AbortSignal.timeout(3000),
          })
        } catch {}
      }
    }
  } catch (err) {
    // 轮询失败（网络/认证问题），静默重试
    if (!err?.message?.includes('abort')) {
      console.warn('[relay] 轮询失败:', err?.message)
    }
  }
}
