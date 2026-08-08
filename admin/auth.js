// auth.js — JWT 认证中间件
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { getUserByUsername } from './db.js'

const JWT_SECRET = process.env.JWT_SECRET || 'myai-admin-secret-change-in-production'
const JWT_EXPIRES = '7d'

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash)
}

export function signToken(userId, role) {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES })
}

export function authMiddleware(handler) {
  return async (req, res, url) => {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { status: 401, body: { error: '未登录' } }
    }
    const token = authHeader.slice(7)
    try {
      const decoded = jwt.verify(token, JWT_SECRET)
      req.userId = decoded.userId
      req.role = decoded.role
      return handler(req, res, url)
    } catch {
      return { status: 401, body: { error: 'Token 已过期' } }
    }
  }
}

export function adminOnly(handler) {
  return authMiddleware((req, res, url) => {
    if (req.role !== 'admin') return { status: 403, body: { error: '需要管理员权限' } }
    return handler(req, res, url)
  })
}

export { JWT_SECRET }
