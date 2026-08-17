import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '6f5c12c446ab15af',
  database: 'myai_admin',
  waitForConnections: true,
  connectionLimit: 10
})

// ── 建表(幂等)──────────────────────────────────────────
const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    username    VARCHAR(64)  NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,
    email       VARCHAR(128) DEFAULT '',
    role        VARCHAR(16)  NOT NULL DEFAULT 'user',
    status      VARCHAR(16)  NOT NULL DEFAULT 'active',
    token_quota BIGINT       NOT NULL DEFAULT 0,
    token_used  BIGINT       NOT NULL DEFAULT 0,
    avatar_url  VARCHAR(512) DEFAULT '',
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS token_transactions (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL,
    amount     INT NOT NULL,
    type       VARCHAR(32) NOT NULL,
    note       VARCHAR(255) DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS branding (
    config_key   VARCHAR(64) PRIMARY KEY,
    config_value TEXT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS relay_messages (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL,
    direction  VARCHAR(16) NOT NULL,
    content    MEDIUMTEXT,
    reply      MEDIUMTEXT,
    status     VARCHAR(16) NOT NULL DEFAULT 'pending',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    replied_at DATETIME NULL,
    INDEX idx_user_dir_status (user_id, direction, status),
    FOREIGN KEY (user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS desktop_sessions (
    user_id         INT PRIMARY KEY,
    last_heartbeat  DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
]
for (const sql of DDL) await pool.execute(sql).catch(() => {})

// ── LLM 模型供应商表(多供应商 Key 管理)────────────────────
// 每行一个供应商: deepseek / zhipu / minimax / duomi / openai 等
await pool.execute(`
  CREATE TABLE IF NOT EXISTS llm_providers (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(32)  NOT NULL,            -- deepseek/zhipu/minimax/openai/duomi
    label       VARCHAR(64)  NOT NULL,            -- 显示名: DeepSeek/智谱清言/MiniMax
    base_url    VARCHAR(256) NOT NULL,
    api_key     VARCHAR(256) NOT NULL DEFAULT '', -- ★ 管理员填写
    chat_endpoint  VARCHAR(128) NOT NULL DEFAULT '/v1/chat/completions',
    embed_endpoint VARCHAR(128) NOT NULL DEFAULT '/v1/embeddings',
    models      TEXT,                              -- 逗号分隔的模型列表
    enabled     TINYINT(1)   NOT NULL DEFAULT 1,
    sort_order  INT          NOT NULL DEFAULT 0,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`).catch(() => {})

// ── token 计价表(每个模型的平台单价,用于扣费)──────────────
// price_per_1k = 每 1000 token 扣多少平台 token(可加价)
await pool.execute(`
  CREATE TABLE IF NOT EXISTS llm_pricing (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    provider     VARCHAR(32)  NOT NULL,
    model        VARCHAR(64)  NOT NULL,
    price_input  DECIMAL(10,4) NOT NULL DEFAULT 1,   -- 输入 token 单价/1k
    price_output DECIMAL(10,4) NOT NULL DEFAULT 2,   -- 输出 token 单价/1k(通常更贵)
    UNIQUE KEY uk_model (provider, model)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`).catch(() => {})

// ── LLM 调用日志(计费凭证)──────────────────────────────
await pool.execute(`
  CREATE TABLE IF NOT EXISTS llm_usage_log (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id      INT NOT NULL,
    provider     VARCHAR(32),
    model        VARCHAR(64),
    input_tokens INT DEFAULT 0,
    output_tokens INT DEFAULT 0,
    cost_tokens  INT DEFAULT 0,                      -- 折算后扣除的平台 token
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id, created_at),
    FOREIGN KEY (user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`).catch(() => {})

// ── 阿里云 OSS 配置(单行 KV)─────────────────────────────
await pool.execute(`
  CREATE TABLE IF NOT EXISTS oss_config (
    config_key   VARCHAR(64) PRIMARY KEY,
    config_value TEXT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`).catch(() => {})

// ── 公共技能市场(管理员上传,所有用户可用)─────────────────
await pool.execute(`
  CREATE TABLE IF NOT EXISTS skills (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    title       VARCHAR(128) NOT NULL,
    description TEXT,
    category    VARCHAR(32)  DEFAULT '通用',
    content     MEDIUMTEXT,                  -- 技能 prompt/配置
    oss_key     VARCHAR(512) DEFAULT '',     -- OSS 存储 key(大文件)
    icon_url    VARCHAR(512) DEFAULT '',
    author      VARCHAR(64)  DEFAULT '官方',
    downloads   INT          NOT NULL DEFAULT 0,
    enabled     TINYINT(1)   NOT NULL DEFAULT 1,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`).catch(() => {})

// ── 用户文件(备份到 OSS)────────────────────────────────
await pool.execute(`
  CREATE TABLE IF NOT EXISTS user_files (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    filename    VARCHAR(256) NOT NULL,
    oss_key     VARCHAR(512) NOT NULL,
    size        BIGINT DEFAULT 0,
    mime_type   VARCHAR(128) DEFAULT '',
    kind        VARCHAR(32)  DEFAULT 'file',    -- file/memory/media/avatar
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_kind (user_id, kind),
    FOREIGN KEY (user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`).catch(() => {})

// ── 媒体配置 + 任务表(多米)──────────────────────────────
await pool.execute(`
  CREATE TABLE IF NOT EXISTS media_config (
    config_key   VARCHAR(64) PRIMARY KEY,
    config_value TEXT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`).catch(() => {})

await pool.execute(`
  CREATE TABLE IF NOT EXISTS media_tasks (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    kind        VARCHAR(16) NOT NULL,
    provider    VARCHAR(32) NOT NULL DEFAULT 'duomi',
    remote_id   VARCHAR(128) DEFAULT '',
    status      VARCHAR(16) NOT NULL DEFAULT 'pending',
    prompt      MEDIUMTEXT,
    result      MEDIUMTEXT,
    oss_key     VARCHAR(512) DEFAULT '',         -- 生成结果转存 OSS
    error       VARCHAR(512) DEFAULT '',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_kind (user_id, kind),
    INDEX idx_remote (remote_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`).catch(() => {})

// ── 默认数据 ──────────────────────────────────────────
// 默认 LLM 供应商
const DEFAULT_PROVIDERS = [
  { name: 'deepseek', label: 'DeepSeek', base_url: 'https://api.deepseek.com', models: 'deepseek-chat,deepseek-reasoner', sort_order: 1 },
  { name: 'zhipu',    label: '智谱清言',  base_url: 'https://open.bigmodel.cn/api/paas/v4', models: 'glm-4-plus,glm-4-flash,glm-4v', sort_order: 2 },
  { name: 'minimax',  label: 'MiniMax',  base_url: 'https://api.minimaxi.com/v1', models: 'abab6.5-chat,abab6.5s-chat', sort_order: 3 },
  { name: 'duomi',    label: '多米(中转)', base_url: 'https://duomiapi.com', models: 'gpt-4o,gpt-4o-mini,claude-3-5-sonnet', sort_order: 4 },
  { name: 'openai',   label: 'OpenAI',   base_url: 'https://api.openai.com', models: 'gpt-4o,gpt-4o-mini', sort_order: 5 },
]
for (const p of DEFAULT_PROVIDERS) {
  await pool.query(
    `INSERT IGNORE INTO llm_providers(name,label,base_url,models,sort_order) VALUES(?,?,?,?,?)`,
    [p.name, p.label, p.base_url, p.models, p.sort_order]
  )
}
// 默认计价(每 1k token 扣多少平台 token)
await pool.query(`INSERT IGNORE INTO llm_pricing(provider,model,price_input,price_output) VALUES
  ('deepseek','deepseek-chat',1,2),('deepseek','deepseek-reasoner',2,8),
  ('zhipu','glm-4-plus',5,10),('zhipu','glm-4-flash',1,1),
  ('minimax','abab6.5-chat',5,10),
  ('duomi','gpt-4o',10,30),('duomi','gpt-4o-mini',3,6),
  ('openai','gpt-4o',15,40)`)
// 默认 OSS 配置
await pool.query(`INSERT IGNORE INTO oss_config(config_key,config_value) VALUES
  ('region','oss-cn-hangzhou'),('access_key_id',''),('access_key_secret',''),
  ('bucket',''),('endpoint',''),('cdn_domain',''),('public_read','0')`)
// 默认媒体配置
await pool.query(`INSERT IGNORE INTO media_config(config_key,config_value) VALUES
  ('provider','duomi'),('base_url','https://duomiapi.com'),('api_key',''),
  ('image_model','gpt-image-2'),('image_endpoint','/v1/images/generations'),('image_async','1'),
  ('video_model','runway-gen3'),('video_endpoint','/api/video/runway/pro/generate'),
  ('music_model','suno-v4'),('music_endpoint','/api/suno/music/generate')`)

// 默认 admin
try {
  const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', ['admin'])
  if (rows.length === 0) {
    await pool.query('INSERT INTO users(username,password,role,status,token_quota) VALUES(?,?,?,?,?)',
      ['admin', bcrypt.hashSync('admin', 10), 'admin', 'active', 999999999])
  }
} catch {}

// ════════════════════════════════════════════════════════
// ── 用户 ──
// ════════════════════════════════════════════════════════
export async function createUser({ username, password, email = '', role = 'user' }) {
  await pool.query('INSERT INTO users(username,password,email,role) VALUES(?,?,?,?)', [username, password, email, role])
  const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username])
  return rows[0]
}
export async function getUserByUsername(u) {
  const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [u]); return rows[0]
}
export async function getUserById(id) {
  const [rows] = await pool.query('SELECT id,username,email,role,status,token_quota,token_used,avatar_url,created_at,updated_at FROM users WHERE id = ?', [id]); return rows[0]
}
export async function listUsers() {
  const [rows] = await pool.query('SELECT id,username,email,role,status,token_quota,token_used,avatar_url,created_at FROM users ORDER BY created_at DESC'); return rows
}
export async function updateUserStatus(id, status) {
  await pool.query('UPDATE users SET status = ?, updated_at = NOW() WHERE id = ?', [status, id])
}
export async function adjustTokenQuota(uid, delta, type, note = '') {
  await pool.query('UPDATE users SET token_quota = token_quota + ?, updated_at = NOW() WHERE id = ?', [delta, uid])
  await pool.query('INSERT INTO token_transactions(user_id,amount,type,note) VALUES(?,?,?,?)', [uid, delta, type, note])
}
export async function consumeTokens(uid, cost, provider, model, inputTokens, outputTokens) {
  await pool.query('UPDATE users SET token_used = token_used + ?, updated_at = NOW() WHERE id = ?', [cost, uid])
  await pool.query('INSERT INTO token_transactions(user_id,amount,type,note) VALUES(?,?,?,?)', [uid, -cost, 'consume', `${provider}/${model}`])
  await pool.query('INSERT INTO llm_usage_log(user_id,provider,model,input_tokens,output_tokens,cost_tokens) VALUES(?,?,?,?,?,?)',
    [uid, provider, model, inputTokens || 0, outputTokens || 0, cost])
}
export async function getTransactions(uid, limit = 50) {
  const [rows] = await pool.query('SELECT * FROM token_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [uid, limit]); return rows
}

// ── 品牌 ──
export async function getBranding() {
  const [rows] = await pool.query('SELECT config_key, config_value FROM branding')
  const o = {}; for (const r of rows) o[r.config_key] = r.config_value; return o
}
export async function updateBranding(updates) {
  for (const [k, v] of Object.entries(updates)) await pool.query('INSERT INTO branding(config_key,config_value) VALUES(?,?) ON DUPLICATE KEY UPDATE config_value=?', [k, String(v), String(v)])
  return getBranding()
}

// ════════════════════════════════════════════════════════
// ── LLM 供应商 ──
// ════════════════════════════════════════════════════════
export async function listProviders() {
  const [rows] = await pool.query('SELECT * FROM llm_providers ORDER BY sort_order, id'); return rows
}
export async function listEnabledProviders() {
  const [rows] = await pool.query('SELECT id,name,label,base_url,chat_endpoint,embed_endpoint,models,sort_order FROM llm_providers WHERE enabled=1 ORDER BY sort_order, id')
  return rows  // 注意:不含 api_key
}
export async function getProvider(id) {
  const [rows] = await pool.query('SELECT * FROM llm_providers WHERE id = ?', [id]); return rows[0]
}
export async function getProviderByName(name) {
  const [rows] = await pool.query('SELECT * FROM llm_providers WHERE name = ? AND enabled=1 ORDER BY id LIMIT 1', [name]); return rows[0]
}
export async function upsertProvider(data) {
  if (data.id) {
    const sets = [], vals = []
    for (const k of ['name','label','base_url','api_key','chat_endpoint','embed_endpoint','models','enabled','sort_order']) {
      if (data[k] !== undefined) { sets.push(k + '=?'); vals.push(data[k]) }
    }
    if (!sets.length) return getProvider(data.id)
    vals.push(data.id)
    await pool.query('UPDATE llm_providers SET ' + sets.join(',') + ' WHERE id=?', vals)
    return getProvider(data.id)
  }
  const [r] = await pool.query(
    'INSERT INTO llm_providers(name,label,base_url,api_key,chat_endpoint,embed_endpoint,models,enabled,sort_order) VALUES(?,?,?,?,?,?,?,?,?)',
    [data.name, data.label, data.base_url, data.api_key||'', data.chat_endpoint||'/v1/chat/completions', data.embed_endpoint||'/v1/embeddings', data.models||'', data.enabled??1, data.sort_order||0]
  )
  return getProvider(r.insertId)
}
export async function deleteProvider(id) {
  await pool.query('DELETE FROM llm_providers WHERE id=?', [id])
}

// ── 计价 ──
export async function listPricing() {
  const [rows] = await pool.query('SELECT * FROM llm_pricing ORDER BY provider, model'); return rows
}
export async function getPricing(provider, model) {
  const [rows] = await pool.query('SELECT * FROM llm_pricing WHERE provider=? AND model=?', [provider, model])
  return rows[0] || { price_input: 1, price_output: 2 }
}
export async function upsertPricing(provider, model, priceInput, priceOutput) {
  await pool.query('INSERT INTO llm_pricing(provider,model,price_input,price_output) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE price_input=?,price_output=?',
    [provider, model, priceInput, priceOutput, priceInput, priceOutput])
}

// ── OSS 配置 ──
export async function getOssConfig() {
  const [rows] = await pool.query('SELECT config_key, config_value FROM oss_config')
  const o = {}; for (const r of rows) o[r.config_key] = r.config_value; return o
}
export async function updateOssConfig(updates) {
  for (const [k, v] of Object.entries(updates)) await pool.query('INSERT INTO oss_config(config_key,config_value) VALUES(?,?) ON DUPLICATE KEY UPDATE config_value=?', [k, String(v), String(v)])
  return getOssConfig()
}

// ── 技能市场 ──
export async function listSkills(enabledOnly = false) {
  const sql = enabledOnly
    ? 'SELECT id,title,description,category,icon_url,author,downloads,enabled,skill_group,parent_id,oss_key,has_package,package_dir,trigger_words,version,LENGTH(content) as content_len,created_at,updated_at FROM skills WHERE enabled=1 ORDER BY skill_group, created_at DESC'
    : 'SELECT id,title,description,category,icon_url,author,downloads,enabled,skill_group,parent_id,oss_key,has_package,package_dir,trigger_words,version,LENGTH(content) as content_len,created_at,updated_at FROM skills ORDER BY skill_group, created_at DESC'
  const [rows] = await pool.query(sql); return rows
}
export async function createSkill(data) {
  const [r] = await pool.query(
    'INSERT INTO skills(title,description,category,content,oss_key,icon_url,author,enabled,skill_group,parent_id,has_package,package_dir,trigger_words,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [data.title, data.description||'', data.category||'通用', data.content||'', data.oss_key||'', data.icon_url||'', data.author||'官方', data.enabled??1, data.skill_group||'', data.parent_id||0, data.has_package||0, data.package_dir||'', data.trigger_words||'', data.version||1]
  )
  return r.insertId
}
export async function updateSkill(id, fields) {
  const sets = [], vals = []
  for (const [k, v] of Object.entries(fields)) { sets.push(k + '=?'); vals.push(v) }
  vals.push(id)
  await pool.query('UPDATE skills SET ' + sets.join(',') + ' WHERE id=?', vals)
}
export async function deleteSkill(id) { await pool.query('DELETE FROM skills WHERE id=?', [id]) }
export async function incSkillDownload(id) { await pool.query('UPDATE skills SET downloads=downloads+1 WHERE id=?', [id]) }

// ── 用户文件 ──
export async function listUserFiles(userId, kind) {
  const [rows] = await pool.query('SELECT * FROM user_files WHERE user_id=?' + (kind ? ' AND kind=?' : '') + ' ORDER BY created_at DESC', kind ? [userId, kind] : [userId])
  return rows
}
export async function addUserFile(userId, { filename, oss_key, size, mime_type, kind }) {
  const [r] = await pool.query('INSERT INTO user_files(user_id,filename,oss_key,size,mime_type,kind) VALUES(?,?,?,?,?,?)',
    [userId, filename, oss_key, size||0, mime_type||'', kind||'file'])
  return r.insertId
}
export async function deleteUserFile(userId, id) {
  await pool.query('DELETE FROM user_files WHERE id=? AND user_id=?', [id, userId])
}

// ── 媒体配置 + 任务 ──
export async function getMediaConfig() {
  const [rows] = await pool.query('SELECT config_key, config_value FROM media_config')
  const o = {}; for (const r of rows) o[r.config_key] = r.config_value; return o
}
export async function updateMediaConfig(updates) {
  for (const [k, v] of Object.entries(updates)) await pool.query('INSERT INTO media_config(config_key,config_value) VALUES(?,?) ON DUPLICATE KEY UPDATE config_value=?', [k, String(v), String(v)])
  return getMediaConfig()
}
export async function createMediaTask({ user_id, kind, provider = 'duomi', remote_id = '', prompt = '' }) {
  const [r] = await pool.query('INSERT INTO media_tasks(user_id,kind,provider,remote_id,prompt,status) VALUES(?,?,?,?,?,?)',
    [user_id, kind, provider, remote_id, prompt, remote_id ? 'processing' : 'pending'])
  return r.insertId
}
export async function getMediaTask(id) { const [rows] = await pool.query('SELECT * FROM media_tasks WHERE id = ?', [id]); return rows[0] }
export async function updateMediaTask(id, fields) {
  const sets = [], vals = []
  for (const [k, v] of Object.entries(fields)) { sets.push(k + ' = ?'); vals.push(v) }
  vals.push(id); await pool.query('UPDATE media_tasks SET ' + sets.join(', ') + ' WHERE id = ?', vals)
}

export { pool }
