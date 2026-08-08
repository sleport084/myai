// cloud-auth.js — 云端认证模块
// 桌面端启动时先通过管理后台验证用户身份，替代纯本地 activation。
// 认证流程：用户输入账号密码 → POST 到管理后台 → 拿到 JWT → 本地缓存 → 后续启动自动验证
//
// 管理后台地址通过环境变量 CLOUD_AUTH_URL 配置，默认指向部署的服务器。
import fs from 'fs'
import path from 'path'
import { paths } from './paths.js'

const CLOUD_AUTH_URL = process.env.CLOUD_AUTH_URL || 'https://zy.tangdou2027.top/admin'
const TOKEN_FILE = path.join(paths.userDir, '.cloud-auth-token')
const USER_CACHE_FILE = path.join(paths.userDir, '.cloud-auth-user')

/**
 * 读取本地缓存的 token
 */
export function getCachedToken() {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf-8').trim()
  } catch {
    return null
  }
}

/**
 * 读取本地缓存的用户信息
 */
export function getCachedUser() {
  try {
    return JSON.parse(fs.readFileSync(USER_CACHE_FILE, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * 清除本地认证缓存（登出）
 */
export function clearAuth() {
  try { fs.unlinkSync(TOKEN_FILE) } catch {}
  try { fs.unlinkSync(USER_CACHE_FILE) } catch {}
}

/**
 * 验证本地缓存的 token 是否仍然有效
 * 调管理后台 GET /api/me
 * @returns {Promise<{valid: boolean, user?: object}>}
 */
export async function verifyToken(token) {
  if (!token) return { valid: false }
  try {
    const resp = await fetch(`${CLOUD_AUTH_URL}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!resp.ok) return { valid: false }
    const data = await resp.json()
    return { valid: true, user: data.user }
  } catch {
    // 网络错误时，如果有缓存 token，乐观放行（离线模式）
    const cached = getCachedUser()
    if (cached) return { valid: true, user: cached, offline: true }
    return { valid: false, networkError: true }
  }
}

/**
 * 登录管理后台
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ok: boolean, token?: string, user?: object, error?: string}>}
 */
export async function login(username, password) {
  try {
    const resp = await fetch(`${CLOUD_AUTH_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(8000),
    })
    const data = await resp.json()
    if (!resp.ok) return { ok: false, error: data.error || '登录失败' }

    // 缓存 token 和用户信息
    fs.writeFileSync(TOKEN_FILE, data.token, { mode: 0o600 })
    fs.writeFileSync(USER_CACHE_FILE, JSON.stringify(data.user), { mode: 0o600 })

    return { ok: true, token: data.token, user: data.user }
  } catch (err) {
    return { ok: false, error: `无法连接服务器: ${err.message}` }
  }
}

/**
 * 注册新用户
 */
export async function register(username, password, email = '') {
  try {
    const resp = await fetch(`${CLOUD_AUTH_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, email }),
      signal: AbortSignal.timeout(8000),
    })
    const data = await resp.json()
    if (!resp.ok) return { ok: false, error: data.error || '注册失败' }

    fs.writeFileSync(TOKEN_FILE, data.token, { mode: 0o600 })
    fs.writeFileSync(USER_CACHE_FILE, JSON.stringify(data.user), { mode: 0o600 })

    return { ok: true, token: data.token, user: data.user }
  } catch (err) {
    return { ok: false, error: `无法连接服务器: ${err.message}` }
  }
}

/**
 * 从管理后台拉取品牌配置（应用名/Logo/主题色等）
 * 客户端启动时调用，让管理后台能远程控制客户端品牌
 */
export async function fetchBranding() {
  try {
    const resp = await fetch(`${CLOUD_AUTH_URL}/api/branding`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  }
}

/**
 * 上报 token 消耗（客户端每次 LLM 调用后可选上报）
 * @param {string} token - JWT
 * @param {number} tokensUsed - 消耗的 token 数
 */
export async function reportTokenUsage(token, tokensUsed) {
  if (!token || !tokensUsed) return
  try {
    await fetch(`${CLOUD_AUTH_URL}/api/me/consume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ amount: tokensUsed }),
      signal: AbortSignal.timeout(3000),
    })
  } catch {
    // 静默失败，不影响用户使用
  }
}

export { CLOUD_AUTH_URL }
