// server.js — MyAI 管理后台服务
// 启动: node server.js (开发) / npm start (生产)
// 端口: 3900 (默认)
import http from 'http'
import bcrypt from 'bcryptjs'
import { db, getUserByUsername, createUser, listUsers, updateUserStatus, adjustTokenQuota, getTransactions, getBranding, updateBranding } from './db.js'
import { signToken, verifyPassword, authMiddleware, adminOnly, JWT_SECRET } from './auth.js'

const PORT = process.env.ADMIN_PORT || 3900

// ── HTTP 工具 ──────────────────────────────────────────
function sendJson(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' })
  res.end(json)
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))) }
      catch { resolve({}) }
    })
  })
}

// ── 路由 ───────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const p = url.pathname
  const method = req.method

  // CORS preflight
  if (method === 'OPTIONS') { sendJson(res, 204, {}); return }

  try {
    // ── 公开接口 ──
    
    // POST /api/login — 管理员登录
    if (method === 'POST' && p === '/api/login') {
      const { username, password } = await readBody(req)
      const user = getUserByUsername(username || 'admin')
      if (!user) { sendJson(res, 401, { error: '用户不存在' }); return }
      const ok = await verifyPassword(password || '', user.password)
      if (!ok) { sendJson(res, 401, { error: '密码错误' }); return }
      if (user.status !== 'active') { sendJson(res, 403, { error: '账号已停用' }); return }
      const token = signToken(user.id, user.role)
      sendJson(res, 200, { token, user: { id: user.id, username: user.username, role: user.role } })
      return
    }

    // GET /api/branding — 公开品牌配置(客户端启动时拉取)
    if (method === 'GET' && p === '/api/branding') {
      sendJson(res, 200, getBranding())
      return
    }

    // POST /api/register — 用户注册(客户端用户注册)
    if (method === 'POST' && p === '/api/register') {
      const { username, password, email } = await readBody(req)
      if (!username || !password) { sendJson(res, 400, { error: '用户名和密码必填' }); return }
      const existing = getUserByUsername(username)
      if (existing) { sendJson(res, 409, { error: '用户名已存在' }); return }
      const hash = bcrypt.hashSync(password, 10)
      const user = createUser({ username, password: hash, email, role: 'user' })
      const token = signToken(user.id, 'user')
      sendJson(res, 200, { token, user: { id: user.id, username: user.username } })
      return
    }

    // ── 需要认证的接口 ──

    // GET /api/me — 当前用户信息
    if (method === 'GET' && p === '/api/me') {
      const result = await authMiddleware(async (req) => {
        const user = db.prepare('SELECT id, username, email, role, status, token_quota, token_used FROM users WHERE id = ?').get(req.userId)
        if (!user) return { status: 404, body: { error: '用户不存在' } }
        return { status: 200, body: { user } }
      })(req, res, url)
      if (result) sendJson(res, result.status, result.body)
      return
    }

    // ── 管理员接口 ──

    // GET /api/users — 用户列表
    if (method === 'GET' && p === '/api/users') {
      const result = await adminOnly(async () => {
        return { status: 200, body: { users: listUsers() } }
      })(req, res, url)
      if (result) sendJson(res, result.status, result.body)
      return
    }

    // POST /api/users/:id/status — 修改用户状态(开通/停用)
    if (method === 'POST' && p.startsWith('/api/users/') && p.endsWith('/status')) {
      const result = await adminOnly(async (req) => {
        const id = parseInt(p.split('/')[3])
        const { status } = await readBody(req)
        updateUserStatus(id, status)
        return { status: 200, body: { ok: true } }
      })(req, res, url)
      if (result) sendJson(res, result.status, result.body)
      return
    }

    // POST /api/users/:id/recharge — 充值 token
    if (method === 'POST' && p.startsWith('/api/users/') && p.endsWith('/recharge')) {
      const result = await adminOnly(async (req) => {
        const id = parseInt(p.split('/')[3])
        const { amount, note } = await readBody(req)
        adjustTokenQuota(id, amount, 'recharge', note || '管理员充值')
        return { status: 200, body: { ok: true } }
      })(req, res, url)
      if (result) sendJson(res, result.status, result.body)
      return
    }

    // GET /api/users/:id/transactions — 用户交易记录
    if (method === 'GET' && p.startsWith('/api/users/') && p.endsWith('/transactions')) {
      const result = await adminOnly(async (req) => {
        const id = parseInt(p.split('/')[3])
        return { status: 200, body: { transactions: getTransactions(id) } }
      })(req, res, url)
      if (result) sendJson(res, result.status, result.body)
      return
    }

    // GET/POST /api/branding/config — 品牌/Logo 配置(管理员)
    if (p === '/api/branding/config') {
      if (method === 'GET') {
        const result = await adminOnly(async () => {
          return { status: 200, body: getBranding() }
        })(req, res, url)
        if (result) sendJson(res, result.status, result.body)
      } else if (method === 'POST') {
        const result = await adminOnly(async (req) => {
          const body = await readBody(req)
          const updated = updateBranding(body)
          return { status: 200, body: { ok: true, branding: updated } }
        })(req, res, url)
        if (result) sendJson(res, result.status, result.body)
      }
      return
    }

    // ── 静态文件(管理后台 UI)──
    if (method === 'GET' && (p === '/' || p === '/index.html')) {
      const { readFileSync } = await import('fs')
      const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf-8')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }

    sendJson(res, 404, { error: 'Not found' })
  } catch (err) {
    console.error('[admin]', err.message)
    sendJson(res, 500, { error: err.message })
  }
})

server.listen(PORT, () => {
  console.log(`[admin] MyAI 管理后台运行在 http://localhost:${PORT}`)
  console.log(`[admin] 默认账号: admin / admin (首次登录后请改密码)`)
})
