// relay-poll.js — 桌面端中继轮询模块
// 桌面端启动后自动轮询管理后台，拉取手机端发来的消息，
// 通过本地 /message API 处理后回复。
// 这样手机端不需要局域网也不需要公网IP，通过云端中继即可对话。
import { getCachedToken, getCachedUser } from './cloud-auth.js'
import { paths } from './paths.js'
import fs from 'fs'
import path from 'path'

const ADMIN_API = process.env.CLOUD_AUTH_URL || 'https://zy.tangdou2027.top/admin'
const POLL_INTERVAL_MS = 3000  // 每 3 秒轮询一次

let polling = false
let localPort = 0
let timer = null
let tokenWarned = false

// 多路径 token 查找（兼容 main.cjs 写入路径和 paths.userDir）
function findToken() {
  // 路径1: paths.userDir（后端标准路径）
  const p1 = path.join(paths.userDir, '.cloud-auth-token')
  if (fs.existsSync(p1)) {
    try { return fs.readFileSync(p1, 'utf-8').trim() } catch {}
  }
  // 路径2: Electron userData 目录（通过环境变量）
  const userData = process.env.BAILONGMA_USER_DIR || paths.userDir
  const p2 = path.join(userData, '.cloud-auth-token')
  if (fs.existsSync(p2)) {
    try { return fs.readFileSync(p2, 'utf-8').trim() } catch {}
  }
  // 路径3: Windows %APPDATA%\MyAI
  const appData = process.env.APPDATA
  if (appData) {
    const p3 = path.join(appData, 'MyAI', '.cloud-auth-token')
    if (fs.existsSync(p3)) {
      try { return fs.readFileSync(p3, 'utf-8').trim() } catch {}
    }
  }
  // 路径4: 仓库根目录（开发模式）
  const p4 = path.resolve('.cloud-auth-token')
  if (fs.existsSync(p4)) {
    try { return fs.readFileSync(p4, 'utf-8').trim() } catch {}
  }
  return null
}

/**
 * 启动中继轮询
 * @param {number} port - 本地后端 HTTP 端口
 */
export function startRelayPoller(port) {
  localPort = port
  if (polling) return
  polling = true
  console.log('[relay] 启动中继轮询，本地端口', port, '，管理后台', ADMIN_API)
  // 检查 token 是否存在
  const token = findToken()
  if (token) {
    console.log('[relay] 云端认证 token 已找到，轮询激活')
  } else {
    console.log('[relay] 云端认证 token 未找到，等待登录后自动激活')
    console.log('[relay] 查找路径:', path.join(paths.userDir, '.cloud-auth-token'), '|', process.env.BAILONGMA_USER_DIR || '(无 BAILONGMA_USER_DIR)')
  }

  timer = setInterval(pollAndProcess, POLL_INTERVAL_MS)
  // 立即执行一次
  pollAndProcess()
}

export function stopRelayPoller() {
  polling = false
  if (timer) { clearInterval(timer); timer = null }
}

async function pollAndProcess() {
  const token = findToken() || getCachedToken()
  if (!token) {
    if (!tokenWarned) {
      console.log('[relay] 未找到云端认证 token，中继轮询暂不启动（请在桌面端登录账号）')
      tokenWarned = true
    }
    return
  }
  if (!localPort) {
    console.warn('[relay] 本地端口未设置')
    return
  }
  if (tokenWarned) {
    console.log('[relay] 找到 token，中继轮询已激活')
    tokenWarned = false
  }

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
