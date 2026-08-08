// db.js — 管理后台数据层
// 使用 SQLite(开发期零配置),生产环境可切 MySQL(改连接即可)
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.ADMIN_DB || path.join(__dirname, 'admin.db')

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

// ── 建表 ──────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT    NOT NULL UNIQUE,
    password    TEXT    NOT NULL,
    email       TEXT    DEFAULT '',
    role        TEXT    NOT NULL DEFAULT 'user',   -- admin / user
    status      TEXT    NOT NULL DEFAULT 'active', -- active / suspended / expired
    token_quota INTEGER NOT NULL DEFAULT 0,        -- 剩余 token 配额
    token_used  INTEGER NOT NULL DEFAULT 0,        -- 已用 token
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS token_transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    amount      INTEGER NOT NULL,   -- 正数=充值,负数=消耗
    type        TEXT    NOT NULL,   -- recharge / consume / grant / refund
    note        TEXT    DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS branding (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- 默认品牌配置
  INSERT OR IGNORE INTO branding (key, value) VALUES
    ('app_name',        'MyAI'),
    ('app_name_cn',     'MyAI'),
    ('app_id',          'com.myai.app'),
    ('agent_name',      'MyAI'),
    ('logo_url',        ''),
    ('primary_color',   '#64ffda'),
    ('slogan',          '你的持续运行的个人数字助手');
`)

// 默认 admin 用户(密码 admin,首次登录后请改密码)
import bcrypt from 'bcryptjs'
const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin')
if (!existingAdmin) {
  const hash = bcrypt.hashSync('admin', 10)
  db.prepare('INSERT INTO users (username, password, role, status, token_quota) VALUES (?, ?, ?, ?, ?)').run('admin', hash, 'admin', 'active', 999999999)
}

// ── 用户 CRUD ─────────────────────────────────────────
export function createUser({ username, password, email = '', role = 'user' }) {
  db.prepare('INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)').run(username, password, email, role)
  return getUserByUsername(username)
}

export function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username)
}

export function getUserById(id) {
  return db.prepare('SELECT id, username, email, role, status, token_quota, token_used, created_at, updated_at FROM users WHERE id = ?').get(id)
}

export function listUsers() {
  return db.prepare('SELECT id, username, email, role, status, token_quota, token_used, created_at FROM users ORDER BY created_at DESC').all()
}

export function updateUserStatus(id, status) {
  db.prepare('UPDATE users SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, id)
}

export function adjustTokenQuota(userId, delta, type, note = '') {
  db.prepare('UPDATE users SET token_quota = token_quota + ?, updated_at = datetime(\'now\') WHERE id = ?').run(delta, userId)
  db.prepare('INSERT INTO token_transactions (user_id, amount, type, note) VALUES (?, ?, ?, ?)').run(userId, delta, type, note)
}

export function consumeToken(userId, amount) {
  const user = getUserById(userId)
  if (!user) throw new Error('用户不存在')
  if (user.status !== 'active') throw new Error('账号已停用')
  if (user.token_quota - user.token_used < amount) throw new Error('Token 余额不足')
  db.prepare('UPDATE users SET token_used = token_used + ?, updated_at = datetime(\'now\') WHERE id = ?').run(amount, userId)
  db.prepare('INSERT INTO token_transactions (user_id, amount, type, note) VALUES (?, ?, \'consume\', ?)').run(userId, -amount, 'API 调用消耗')
}

export function getTransactions(userId, limit = 50) {
  return db.prepare('SELECT * FROM token_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit)
}

// ── 品牌配置 ──────────────────────────────────────────
export function getBranding() {
  const rows = db.prepare('SELECT key, value FROM branding').all()
  const obj = {}
  for (const row of rows) obj[row.key] = row.value
  return obj
}

export function setBranding(key, value) {
  db.prepare('INSERT OR REPLACE INTO branding (key, value) VALUES (?, ?)').run(key, value)
}

export function updateBranding(updates) {
  for (const [key, value] of Object.entries(updates)) {
    setBranding(key, String(value))
  }
  return getBranding()
}

export { db }
