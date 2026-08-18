import http from 'http'
import bcrypt from 'bcryptjs'
import {
  getUserByUsername, getUserById, createUser, listUsers, updateUserStatus,
  adjustTokenQuota, consumeTokens, getTransactions, getBranding, updateBranding,
  listProviders, listEnabledProviders, getProvider, getProviderByName, upsertProvider, deleteProvider,
  listPricing, getPricing, upsertPricing,
  getOssConfig, updateOssConfig,
  listSkills, createSkill, updateSkill, deleteSkill, incSkillDownload,
  listUserFiles, addUserFile, deleteUserFile,
  getMediaConfig, updateMediaConfig, createMediaTask, getMediaTask, updateMediaTask,
  pool
} from './db.js'
import { signToken, verifyPassword, authMiddleware, adminOnly } from './auth.js'
import {
  startCronScheduler, startQueueMaintenance, claimTask, reportTaskResult,
  getUserPermissions, validateSpec, nextCronRun
} from './workflow-engine.js'

const PORT = process.env.ADMIN_PORT || 3900

// 启动调度器(cron + 队列维护)
startCronScheduler()
startQueueMaintenance()

function sj(res, s, b) {
  res.writeHead(s, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' })
  res.end(JSON.stringify(b))
}
function rb(req) {
  return new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => { try { r(JSON.parse(Buffer.concat(c).toString())) } catch { r({}) } }) })
}

// ── URL 响应解析(从抓取的文本提取技能信息)──
function parseUrlResponse(resp, text, url) {
  let title = '', description = '', content = text, category = '通用', icon = ''
  const ct = (resp.headers.get('content-type') || '').toLowerCase()

  // JSON 格式
  if (ct.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try {
      const j = JSON.parse(text)
      const obj = Array.isArray(j) ? j[0] : j
      title = obj.name || obj.title || ''
      description = obj.description || obj.desc || ''
      content = obj.content || obj.prompt || obj.body || text
      category = obj.category || obj.type || '通用'
      icon = obj.icon || obj.emoji || ''
    } catch {}
  }

  // YAML front matter (---)
  if (!title && text.startsWith('---')) {
    const end = text.indexOf('\n---', 3)
    if (end > 0) {
      const front = text.slice(3, end)
      const body = text.slice(end + 4).trim()
      front.split('\n').forEach(line => {
        const mm = line.match(/^(\w+):\s*(.*)$/)
        if (!mm) return
        const [, k, v] = mm
        if (k === 'name' || k === 'title') title = v
        else if (k === 'description' || k === 'desc') description = v
        else if (k === 'category' || k === 'type') category = v
        else if (k === 'icon' || k === 'emoji') icon = v
      })
      if (!content || content === text) content = body
      if (!description) description = body.slice(0, 100)
    }
  }

  // Markdown 格式
  if (!title && (ct.includes('markdown') || text.startsWith('#'))) {
    const lines = text.split('\n')
    title = (lines.find(l => l.startsWith('#')) || '').replace(/^#+\s*/, '')
    const bodyStart = text.indexOf('\n\n')
    if (bodyStart > 0) description = text.slice(bodyStart + 2, bodyStart + 142).replace(/[#*`\n]/g, '').trim()
  }

  // HTML 解析
  if (ct.includes('html') || text.includes('<html') || text.includes('<!DOCTYPE') || text.includes('<HTML')) {
    const titleMatch = text.match(/<title>([^<]*)<\/title>/i)
    if (titleMatch) title = titleMatch[1].trim()
    // 提取 meta description
    const descMatch = text.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    if (descMatch && !description) description = descMatch[1].trim().slice(0, 150)
    // 提取正文(去 script/style/tags)
    content = text
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    if (!description) description = content.slice(0, 150)
  }

  // 从 URL 文件名推断 title
  if (!title) {
    const fname = url.split('/').pop() || ''
    title = fname.replace(/\.\w+$/, '').replace(/[-_]/g, ' ').trim() || '导入的技能'
  }

  // 智能分类
  category = category !== '通用' ? category : smartClassify(title, description, content)

  return {
    status: 200,
    body: {
      ok: true,
      skill: {
        title: title.slice(0, 128),
        description: description.slice(0, 300),
        content: content.slice(0, 50000),
        category,
        icon_url: icon
      }
    }
  }
}

// 智能分类(根据关键词推断)
function smartClassify(title, description, content) {
  const text = (title + ' ' + description + ' ' + (content || '').slice(0, 500)).toLowerCase()
  const rules = [
    { cat: '编程', kw: ['python', 'javascript', '代码', 'code', '编程', '开发', 'api', '函数', 'bug', 'react', 'vue', 'java', 'sql', 'git', '框架', '前端', '后端', 'css', 'html', 'typescript'] },
    { cat: '办公', kw: ['周报', '会议', '邮件', '简历', '工作', '总结', '计划', '报告', '文档', 'excel', 'ppt', '演示', '汇报', '日程', '效率'] },
    { cat: '学习', kw: ['数学', '物理', '化学', '历史', '英语', '考试', '学习', '课程', '知识', '练习', '教材', '仓颉', '输入法', '翻译'] },
    { cat: '创意', kw: ['故事', '小说', '文案', '创意', '设计', '写作', '诗歌', '歌词', '剧本', '起名', '品牌', '广告'] },
    { cat: '生活', kw: ['健身', '运动', '烹饪', '旅游', '健康', '医疗', '法律', '天气', '音乐', '摄影'] },
  ]
  let best = '通用', bestScore = 0
  for (const r of rules) {
    let score = 0
    for (const k of r.kw) { if (text.includes(k)) score++ }
    if (score > bestScore) { bestScore = score; best = r.cat }
  }
  return best
}

// ── 技能安全检查 ──
// 检测技能内容是否包含有害/危险指令,返回 {safe, reason}
function checkSkillSafety(title, content) {
  const text = (title + '\n' + content).toLowerCase()
  const dangers = [
    { pattern: /rm\s+-rf\s+\//, reason: '包含危险命令 rm -rf /' },
    { pattern: /format\s+[c-z]:/i, reason: '包含格式化磁盘命令' },
    { pattern: /del\s+\/[fsq]\s+/i, reason: '包含强制删除命令' },
    { pattern: /mkfs/i, reason: '包含文件系统格式化命令' },
    { pattern: /dd\s+if=.*of=\/dev/i, reason: '包含磁盘写入命令 dd' },
    { pattern: /:\(\)\{\s*:\|:&\s*\};?:/, reason: '包含 fork 炸弹' },
    { pattern: /curl\s+.*\|\s*(ba)?sh/i, reason: '包含远程脚本执行(管道到 shell)' },
    { pattern: /wget\s+.*\|\s*(ba)?sh/i, reason: '包含远程脚本执行(管道到 shell)' },
    { pattern: /chmod\s+777\s+\//i, reason: '包含不安全权限设置 chmod 777' },
    { pattern: /netcat|nc\s+-l/i, reason: '包含后门监听命令' },
    { pattern: /reverse\s*shell|反弹\s*shell/i, reason: '包含反弹 shell 指令' },
    { pattern: /keylog|键盘记录/i, reason: '包含键盘记录器相关内容' },
    { pattern: /eval\s*\(\s*atob/i, reason: '包含 base64 编码的可疑执行' },
    { pattern: /document\.cookie|窃取.*cookie/i, reason: '包含 Cookie 窃取代码' },
    { pattern: /bitcoin.*miner|挖矿/i, reason: '包含挖矿相关内容' },
    { pattern: /sql\s*injection|sql\s*注入/i, reason: '包含 SQL 注入指导' },
    { pattern: /xss\s*attack|xss\s*攻击/i, reason: '包含 XSS 攻击指导' },
    { pattern: /phishing|钓鱼.*网站/i, reason: '包含钓鱼相关内容' },
  ]
  for (const d of dangers) {
    if (d.pattern.test(text)) return { safe: false, reason: d.reason }
  }
  // 检查是否以可执行代码为主(而非提示词)
  const codePatterns = ['#!/bin/', '#!/', '<script', '<?php', 'import os', 'require(\'child', 'subprocess.call']
  let codeHits = 0
  for (const p of codePatterns) { if (text.includes(p.toLowerCase())) codeHits++ }
  if (codeHits >= 2) return { safe: false, reason: '内容看起来像可执行代码而非 AI 提示词，可能有害' }
  return { safe: true }
}

// ── 技能内容解析(支持 JSON / Markdown / YAML / 纯文本)──
function parseSkillContent(raw, filename) {
  let title = '', description = '', content = raw, category = '通用', icon = ''

  // JSON 格式
  if (raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
    try {
      const j = JSON.parse(raw)
      const obj = Array.isArray(j) ? j[0] : j
      title = obj.name || obj.title || ''
      description = obj.description || obj.desc || ''
      content = obj.content || obj.prompt || obj.body || raw
      category = obj.category || obj.type || '通用'
      icon = obj.icon || obj.emoji || ''
    } catch {}
  }
  // YAML front matter (---)
  if (!title && raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3)
    if (end > 0) {
      const front = raw.slice(3, end)
      const body = raw.slice(end + 4).trim()
      front.split('\n').forEach(line => {
        const mm = line.match(/^(\w+):\s*(.*)$/)
        if (!mm) return
        const [, k, v] = mm
        if (k === 'name' || k === 'title') title = v
        else if (k === 'description' || k === 'desc') description = v
        else if (k === 'category' || k === 'type') category = v
        else if (k === 'icon' || k === 'emoji') icon = v
      })
      content = body
      if (!description) description = body.slice(0, 100)
    }
  }
  // Markdown 格式
  if (!title && raw.startsWith('#')) {
    const lines = raw.split('\n')
    title = (lines.find(l => l.startsWith('#')) || '').replace(/^#+\s*/, '')
    const bodyStart = raw.indexOf('\n\n')
    if (bodyStart > 0) description = raw.slice(bodyStart + 2, bodyStart + 142).replace(/[#*`\n]/g, '').trim()
  }
  // 从文件名推断标题
  if (!title && filename) title = filename.replace(/\.\w+$/, '')
  if (!title) title = '导入的技能'
  // 如果 content 还是原始 raw, 且有 title, 则去掉标题行
  return {
    title: title.slice(0, 128),
    description: (description || content.slice(0, 150)).slice(0, 300),
    content: content.slice(0, 50000),  // 提高到 50KB
    category,
    icon_url: icon
  }
}

// ── 调用上游 LLM(OpenAI 兼容)──────────────────────────
async function callLLM({ base_url, endpoint, api_key, body, method = 'POST' }) {
  const url = base_url.replace(/\/$/, '') + endpoint
  const headers = { 'Content-Type': 'application/json' }
  // 兼容多种认证: Authorization Bearer + 多米的 ?key=
  if (api_key) headers['Authorization'] = 'Bearer ' + api_key
  // 多米特殊:同时加 ?key=
  const urlWithKey = base_url.includes('duomi') && api_key
    ? url + (url.includes('?') ? '&' : '?') + 'key=' + api_key
    : url
  const resp = await fetch(urlWithKey, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body) })
  const text = await resp.text()
  let json; try { json = JSON.parse(text) } catch { json = { _raw: text } }
  return { ok: resp.ok, status: resp.status, json }
}

const server = http.createServer(async (req, res) => {
  const rawUrl = new URL(req.url, 'http://localhost')
  let p = rawUrl.pathname
  if (p.startsWith('/admin')) p = p.replace(/^\/admin/, '') || '/'
  const m = req.method
  if (m === 'OPTIONS') { sj(res, 204, {}); return }

  try {
    // ═══ 公开接口 ═══
    if (m === 'POST' && p === '/api/login') {
      const { username, password } = await rb(req)
      const u = await getUserByUsername(username || 'admin')
      if (!u) { sj(res, 401, { error: '用户不存在' }); return }
      if (!(await verifyPassword(password || '', u.password))) { sj(res, 401, { error: '账号或密码错误' }); return }
      if (u.status !== 'active') { sj(res, 403, { error: '账号已停用' }); return }
      sj(res, 200, { token: signToken(u.id, u.role), user: { id: u.id, username: u.username, role: u.role } })
      return
    }
    if (m === 'GET' && p === '/api/branding') { sj(res, 200, await getBranding()); return }
    if (m === 'POST' && p === '/api/register') {
      const { username, password, email } = await rb(req)
      if (!username || !password) { sj(res, 400, { error: '用户名密码必填' }); return }
      if (await getUserByUsername(username)) { sj(res, 409, { error: '用户名已存在' }); return }
      const u = await createUser({ username, password: bcrypt.hashSync(password, 10), email })
      sj(res, 200, { token: signToken(u.id, 'user'), user: { id: u.id, username: u.username } })
      return
    }

    // 公开:可用模型列表(脱敏,无 Key)
    if (m === 'GET' && p === '/api/llm/providers') {
      sj(res, 200, { providers: await listEnabledProviders() }); return
    }
    // 公开:技能市场(带 token 时按套餐过滤)
    if (m === 'GET' && p === '/api/skills') {
      let skills = await listSkills(true)
      // 权限强制执行: 有登录态则按套餐过滤可见技能
      const authHeader = req.headers.authorization
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const t = authHeader.slice(7)
          const decoded = await import('jsonwebtoken').then(j => j.default.decode(t))
          if (decoded?.userId) {
            const perms = await getUserPermissions(decoded.userId)
            if (perms.skill_ids !== '*') {
              const allowed = new Set(Array.isArray(perms.skill_ids) ? perms.skill_ids : JSON.parse(perms.skill_ids || '[]'))
              const before = skills.length
              skills = skills.filter(s => allowed.has(s.id))
              console.log(`[permissions] 用户${decoded.userId}(${perms.plan}) 技能过滤: ${before} → ${skills.length}`)
            }
          }
        } catch { /* token 无效 → 不过滤(公开列表) */ }
      }
      sj(res, 200, { skills: skills.map(s => ({
        id: s.id, title: s.title, description: s.description, category: s.category,
        icon_url: s.icon_url, author: s.author, downloads: s.downloads,
        skill_group: s.skill_group || '', parent_id: s.parent_id || 0,
        version: s.version || 1, updated_at: s.updated_at || null,
        has_package: s.has_package || 0,
        content_len: s.content_len || (s.content ? s.content.length : 0),
        oss_key: s.oss_key || ''
      })) }); return
    }

    // GET /api/skills/:id — 公开获取单个技能内容(无需登录,供桌面端/手机端使用)
    if (m === 'GET' && /^\/api\/skills\/\d+$/.test(p)) {
      const id = parseInt(p.split('/').pop())
      const [rows] = await pool.query('SELECT * FROM skills WHERE id=? AND enabled=1', [id])
      if (!rows.length) { sj(res, 404, { error: '技能不存在' }); return }
      const skill = rows[0]
      // 大文件从磁盘读取
      if ((!skill.content || skill.content.length === 0) && skill.oss_key) {
        try {
          const { readFileSync, existsSync } = await import('fs')
          const fpath = './public' + skill.oss_key
          if (existsSync(fpath)) skill.content = readFileSync(fpath, 'utf-8')
        } catch {}
      }
      // 计下载量
      try { await pool.query('UPDATE skills SET downloads=downloads+1 WHERE id=?', [id]) } catch {}
      sj(res, 200, { skill: {
        id: skill.id, title: skill.title, content: skill.content || '', category: skill.category,
        has_package: skill.has_package || 0, package_dir: skill.package_dir || '',
        trigger_words: skill.trigger_words || '', skill_group: skill.skill_group || ''
      } })
      return
    }

    // GET /api/skills/:id/files — 列出结构化包内文件(公开)
    if (m === 'GET' && /^\/api\/skills\/\d+\/files$/.test(p)) {
      const id = parseInt(p.split('/')[3])
      const [rows] = await pool.query('SELECT package_dir, has_package FROM skills WHERE id=? AND enabled=1', [id])
      const sk = rows[0]
      if (!sk || !sk.has_package || !sk.package_dir) { sj(res, 404, { error: '该技能没有结构化包' }); return }
      try {
        const { readdirSync, statSync } = await import('fs')
        const pathMod = await import('path')
        const pkgDir = './public' + sk.package_dir
        const files = []
        function walk(dir) {
          for (const ent of readdirSync(dir, { withFileTypes: true })) {
            const full = pathMod.join(dir, ent.name)
            const rel = pathMod.relative(pkgDir, full)
            if (ent.isDirectory()) walk(full)
            else files.push({ path: rel, size: statSync(full).size })
          }
        }
        walk(pkgDir)
        sj(res, 200, { files })
      } catch (e) { sj(res, 500, { error: '读取包目录失败: ' + e.message }) }
      return
    }

    // GET /api/skills/:id/file?path=xxx — 下载包内单个文件(公开,防目录穿越)
    if (m === 'GET' && /^\/api\/skills\/\d+\/file$/.test(p)) {
      const id = parseInt(p.split('/')[3])
      const relPath = (rawUrl.searchParams.get('path') || '').replace(/\.\./g, '').replace(/^\/+/, '')
      if (!relPath) { sj(res, 400, { error: '缺少 path' }); return }
      const [rows] = await pool.query('SELECT package_dir, has_package FROM skills WHERE id=? AND enabled=1', [id])
      const sk = rows[0]
      if (!sk || !sk.has_package || !sk.package_dir) { sj(res, 404, { error: '该技能没有结构化包' }); return }
      const { createReadStream, existsSync, statSync } = await import('fs')
      const pathMod = await import('path')
      const fpath = pathMod.join('./public' + sk.package_dir, relPath)
      const resolved = pathMod.resolve(fpath)
      const rootResolved = pathMod.resolve('./public' + sk.package_dir)
      if (!resolved.startsWith(rootResolved + pathMod.sep)) { sj(res, 403, { error: 'forbidden' }); return }
      if (!existsSync(fpath)) { sj(res, 404, { error: '文件不存在' }); return }
      const ext = pathMod.extname(fpath).toLowerCase()
      const mimes = { '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.py': 'text/plain; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.sh': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg' }
      res.writeHead(200, { 'Content-Type': mimes[ext] || 'application/octet-stream', 'Content-Length': statSync(fpath).size })
      createReadStream(fpath).pipe(res)
      return
    }

    if (m === 'GET' && p === '/api/me') {
      const r = await authMiddleware(async (req) => {
        const u = await getUserById(req.userId)
        if (!u) return { status: 404, body: { error: '不存在' } }
        const [ds] = await pool.query('SELECT * FROM desktop_sessions WHERE user_id=?', [req.userId])
        return { status: 200, body: { user: u, desktop: ds[0] || null, providers: await listEnabledProviders() } }
      })(req, res)
      if (r) sj(res, r.status, r.body); return
    }

    // ═══ 消息中继 ═══
    if (m === 'POST' && p === '/api/relay/send') {
      const r = await authMiddleware(async (req) => {
        const { content } = await rb(req)
        if (!content) return { status: 400, body: { error: '内容不能为空' } }
        const [result] = await pool.query('INSERT INTO relay_messages(user_id,direction,content,status) VALUES(?,"to_desktop",?,"pending")', [req.userId, content])
        return { status: 200, body: { ok: true, id: result.insertId } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }
    if (m === 'GET' && p === '/api/relay/poll') {
      const r = await authMiddleware(async (req) => {
        await pool.query('INSERT INTO desktop_sessions(user_id,last_heartbeat) VALUES(?,NOW()) ON DUPLICATE KEY UPDATE last_heartbeat=NOW()', [req.userId])
        const [rows] = await pool.query('SELECT id,content,created_at FROM relay_messages WHERE user_id=? AND direction="to_desktop" AND status="pending" ORDER BY created_at ASC', [req.userId])
        if (rows.length) await pool.query('UPDATE relay_messages SET status="processing" WHERE id IN (?)', [rows.map(r => r.id)])
        return { status: 200, body: { messages: rows } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }
    if (m === 'POST' && p === '/api/relay/reply') {
      const r = await authMiddleware(async (req) => {
        const { id, reply } = await rb(req)
        await pool.query('UPDATE relay_messages SET reply=?,status="replied",replied_at=NOW() WHERE id=? AND user_id=?', [reply, id, req.userId])
        return { status: 200, body: { ok: true } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }
    if (m === 'GET' && p === '/api/relay/messages') {
      const r = await authMiddleware(async (req) => {
        const since = rawUrl.searchParams.get('since_id') || '0'
        const [rows] = await pool.query('SELECT id,content,reply,status,created_at,replied_at FROM relay_messages WHERE user_id=? AND id>? ORDER BY id DESC LIMIT 20', [req.userId, parseInt(since)])
        return { status: 200, body: { messages: rows } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }
    if (m === 'GET' && p === '/api/relay/desktop-status') {
      const r = await authMiddleware(async (req) => {
        const [rows] = await pool.query('SELECT last_heartbeat,TIMESTAMPDIFF(SECOND,last_heartbeat,NOW()) as ago FROM desktop_sessions WHERE user_id=?', [req.userId])
        return { status: 200, body: { online: rows.length > 0 && rows[0].ago < 30, lastSeen: rows[0]?.last_heartbeat || null } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // ════════════════════════════════════════════════════════
    // LLM 代理(统一聊天接口 — 平台卖 token 核心逻辑)
    // 客户端传 { provider, model, messages, stream? }
    // 后端按 provider 路由到对应供应商 Key,按 model 计价扣费
    // ════════════════════════════════════════════════════════
    if (m === 'POST' && p === '/api/llm/chat') {
      const r = await authMiddleware(async (req) => {
        const body = await rb(req)
        const providerName = body.provider || 'deepseek'
        const provider = await getProviderByName(providerName)
        if (!provider || !provider.api_key) return { status: 503, body: { error: `供应商 ${providerName} 未配置或未启用` } }
        const model = body.model || (provider.models || '').split(',')[0] || 'gpt-4o'
        const user = await getUserById(req.userId)
        if (user.status !== 'active') return { status: 403, body: { error: '账号已停用' } }

        const payload = {
          model,
          messages: body.messages || [],
          temperature: body.temperature ?? 0.7,
          ...(body.max_tokens ? { max_tokens: body.max_tokens } : {}),
          ...(body.stream ? { stream: true } : {}),
        }

        // 流式:透传 SSE(流式暂不计费,或按预估计费)
        if (body.stream) {
          try {
            const upstreamUrl = provider.base_url.replace(/\/$/, '') + (provider.chat_endpoint || '/v1/chat/completions')
            const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + provider.api_key }
            let fullUrl = upstreamUrl
            if (provider.base_url.includes('duomi')) fullUrl += (fullUrl.includes('?') ? '&' : '?') + 'key=' + provider.api_key
            const upResp = await fetch(fullUrl, { method: 'POST', headers, body: JSON.stringify(payload) })
            if (!upResp.ok || !upResp.body) {
              const t = await upResp.text().catch(() => '')
              return { status: 502, body: { error: '上游错误', status: upResp.status, detail: t.slice(0, 300) } }
            }
            res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' })
            const reader = upResp.body.getReader()
            while (true) { const { done, value } = await reader.read(); if (done) break; res.write(value) }
            res.end()
            return null
          } catch (e) { return { status: 502, body: { error: '流式请求失败: ' + e.message } } }
        }

        // 同步:调用上游 + 计费
        const result = await callLLM({
          base_url: provider.base_url,
          endpoint: provider.chat_endpoint || '/v1/chat/completions',
          api_key: provider.api_key,
          body: payload,
        })
        if (!result.ok) return { status: 502, body: { error: '上游错误', status: result.status, detail: result.json } }

        // ★ 计费:按实际 token 用量
        const usage = result.json?.usage
        if (usage) {
          const pricing = await getPricing(providerName, model)
          const inputT = usage.prompt_tokens || 0
          const outputT = usage.completion_tokens || 0
          // 成本 = 输入token * 输入单价 + 输出token * 输出单价(每1k)
          const cost = Math.ceil(inputT * pricing.price_input / 1000 + outputT * pricing.price_output / 1000)
          if (cost > 0) {
            if (user.token_quota - user.token_used < cost) {
              return { status: 402, body: { error: 'Token 余额不足,请充值', cost, balance: user.token_quota - user.token_used } }
            }
            await consumeTokens(req.userId, cost, providerName, model, inputT, outputT)
          }
          result.json._billing = { cost, balance: (user.token_quota - user.token_used - cost) }
        }
        return { status: 200, body: result.json }
      })(req, res)
      if (r) sj(res, r.status, r.body)
      return
    }

    // 向量
    if (m === 'POST' && p === '/api/llm/embeddings') {
      const r = await authMiddleware(async (req) => {
        const body = await rb(req)
        const provider = await getProviderByName(body.provider || 'deepseek')
        if (!provider?.api_key) return { status: 503, body: { error: '供应商未配置' } }
        const result = await callLLM({ base_url: provider.base_url, endpoint: provider.embed_endpoint || '/v1/embeddings', api_key: provider.api_key, body: { model: body.model || (provider.models||'').split(',')[0], input: body.input } })
        if (!result.ok) return { status: 502, body: { error: '上游错误', detail: result.json } }
        return { status: 200, body: result.json }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // ═══ 阿里云 OSS — 客户端直传凭证 / 列文件 ═══
    // POST /api/oss/sts — 返回临时上传凭证(STS 简化版:直接返回配置,生产环境应生成临时 STS)
    if (m === 'POST' && p === '/api/oss/sts') {
      const r = await authMiddleware(async (req) => {
        const cfg = await getOssConfig()
        if (!cfg.access_key_id || !cfg.bucket) return { status: 503, body: { error: 'OSS 未配置' } }
        // 简化模式:直接返回配置(客户端用 ali-oss SDK 直传)
        // 生产环境建议改用 STS 临时凭证,这里预留接口
        return { status: 200, body: {
          region: cfg.region,
          bucket: cfg.bucket,
          endpoint: cfg.endpoint,
          accessKeyId: cfg.access_key_id,
          accessKeySecret: cfg.access_key_secret,
          cdnDomain: cfg.cdn_domain || '',
          userPrefix: `users/${req.userId}/`,  // 用户专属前缀
        } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // GET /api/files — 用户文件列表
    if (m === 'GET' && p === '/api/files') {
      const r = await authMiddleware(async (req) => {
        const kind = rawUrl.searchParams.get('kind') || ''
        return { status: 200, body: { files: await listUserFiles(req.userId, kind) } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }
    // POST /api/files — 登记用户上传的文件
    if (m === 'POST' && p === '/api/files') {
      const r = await authMiddleware(async (req) => {
        const b = await rb(req)
        const id = await addUserFile(req.userId, { filename: b.filename, oss_key: b.oss_key, size: b.size, mime_type: b.mime_type, kind: b.kind })
        return { status: 200, body: { ok: true, id } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }
    // DELETE /api/files/:id
    if (m === 'DELETE' && p.startsWith('/api/files/')) {
      const r = await authMiddleware(async (req) => {
        const id = parseInt(p.split('/').pop())
        await deleteUserFile(req.userId, id)
        return { status: 200, body: { ok: true } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // GET /api/skills/:id/download — 下载技能(计下载量,混合存储自动拉取)
    if (m === 'GET' && p.startsWith('/api/skills/') && p.endsWith('/download')) {
      const r = await authMiddleware(async (req) => {
        const id = parseInt(p.split('/')[3])
        const [rows] = await pool.query('SELECT * FROM skills WHERE id=? AND enabled=1', [id])
        if (!rows.length) return { status: 404, body: { error: '技能不存在' } }
        await incSkillDownload(id)
        const skill = rows[0]
        // 如果 content 为空但有 oss_key(大文件存储),从文件读取
        if ((!skill.content || skill.content.length === 0) && skill.oss_key) {
          try {
            const { readFileSync, existsSync } = await import('fs')
            const fpath = './public' + skill.oss_key
            if (existsSync(fpath)) {
              skill.content = readFileSync(fpath, 'utf-8')
            }
          } catch {}
        }
        return { status: 200, body: { skill } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // ═══ 媒体 API(多米)═══
    if (m === 'POST' && p === '/api/media/image') {
      const r = await authMiddleware(async (req) => {
        const cfg = await getMediaConfig()
        if (!cfg.api_key) return { status: 503, body: { error: '媒体 API 未配置 Key' } }
        const body = await rb(req)
        if (!body.prompt) return { status: 400, body: { error: '缺少 prompt' } }
        const isAsync = cfg.image_async === '1'
        const payload = { prompt: body.prompt, model: body.model || cfg.image_model || 'gpt-image-2', n: body.n || 1 }
        if (body.size) payload.size = body.size
        else if (body.aspect_ratio) {
          const map = { '1:1':'1024x1024','16:9':'1792x1024','9:16':'1024x1792','4:3':'1024x768','3:4':'768x1024' }
          payload.size = map[body.aspect_ratio] || '1024x1024'
        }
        const taskId = await createMediaTask({ user_id: req.userId, kind: 'image', provider: cfg.provider || 'duomi', prompt: body.prompt })
        const ep = (cfg.image_endpoint || '/v1/images/generations') + (isAsync ? '?async=true' : '')
        const result = await callLLM({ base_url: cfg.base_url, endpoint: ep, api_key: cfg.api_key, body: payload })
        if (isAsync && (result.json?.task_id || result.json?.id || result.json?.data?.task_id || result.json?.data?.id)) {
          const rid = result.json.task_id || result.json.id || result.json.data?.task_id || result.json.data?.id
          await updateMediaTask(taskId, { remote_id: String(rid), status: 'processing' })
          return { status: 200, body: { task_id: taskId, remote_id: rid, status: 'processing', async: true } }
        }
        const urls = []
        if (Array.isArray(result.json?.data)) for (const it of result.json.data) { if (it.url) urls.push(it.url); else if (it.b64_json) urls.push('data:image/png;base64,' + it.b64_json) }
        else if (result.json?.data?.image_urls) urls.push(...result.json.data.image_urls)
        if (!urls.length) { await updateMediaTask(taskId, { status: 'failed', error: JSON.stringify(result.json).slice(0,500) }); return { status: 502, body: { error: '上游未返回图片', detail: result.json } } }
        await updateMediaTask(taskId, { status: 'done', result: JSON.stringify(urls) })
        return { status: 200, body: { task_id: taskId, urls, status: 'done' } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }
    if (m === 'GET' && p.startsWith('/api/media/task/')) {
      const r = await authMiddleware(async (req) => {
        const id = parseInt(p.split('/').pop())
        const task = await getMediaTask(id)
        if (!task || task.user_id !== req.userId) return { status: 404, body: { error: '任务不存在' } }
        if (task.status === 'processing' && task.remote_id) {
          const cfg = await getMediaConfig()
          if (cfg.api_key) {
            try {
              // 多米/标准:GET /v1/tasks/{id}?key=xxx
              const result = await callLLM({ base_url: cfg.base_url, endpoint: '/v1/tasks/' + task.remote_id, api_key: cfg.api_key, method: 'GET' })
              const j = result.json
              const urls = []
              // 多米格式: state="succeeded", data.images[].url
              if (j?.state === 'succeeded') {
                if (Array.isArray(j?.data?.images)) for (const img of j.data.images) { if (img.url) urls.push(img.url) }
                else if (j?.data?.url) urls.push(j.data.url)
                else if (j?.data?.image_url) urls.push(j.data.image_url)
              }
              // 兼容其他格式
              else if (j?.data?.url) urls.push(j.data.url)
              else if (j?.data?.image_url) urls.push(j.data.image_url)
              else if (j?.url) urls.push(j.url)
              else if (Array.isArray(j?.data?.image_urls)) urls.push(...j.data.image_urls)

              if (urls.length) {
                await updateMediaTask(id, { status: 'done', result: JSON.stringify(urls) })
                task.status = 'done'; task.result = JSON.stringify(urls)
              } else if (j?.state === 'error' || j?.status === 'failed' || j?.data?.status === 'failed') {
                await updateMediaTask(id, { status: 'failed', error: j?.error || '上游失败' })
                task.status = 'failed'
              }
              // pending/running → 保持 processing,前端继续轮询
            } catch (e) { console.log('[media task] query err', e.message) }
          }
        }
        const out = { id: task.id, status: task.status, kind: task.kind }
        if (task.status === 'done') { try { out.urls = JSON.parse(task.result) } catch {} }
        if (task.status === 'failed') out.error = task.error
        return { status: 200, body: out }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }
    if (m === 'POST' && p === '/api/media/video') {
      const r = await authMiddleware(async (req) => {
        const cfg = await getMediaConfig()
        if (!cfg.api_key) return { status: 503, body: { error: '媒体 API 未配置 Key' } }
        const body = await rb(req)
        if (!body.prompt) return { status: 400, body: { error: '缺少 prompt' } }
        const taskId = await createMediaTask({ user_id: req.userId, kind: 'video', provider: cfg.provider || 'duomi', prompt: body.prompt })
        const result = await callLLM({ base_url: cfg.base_url, endpoint: cfg.video_endpoint || '/api/video/runway/pro/generate', api_key: cfg.api_key, body: { prompt: body.prompt, model: body.model || cfg.video_model } })
        const rid = result.json?.task_id || result.json?.id || result.json?.data?.task_id || result.json?.data?.id
        if (rid) { await updateMediaTask(taskId, { remote_id: String(rid), status: 'processing' }); return { status: 200, body: { task_id: taskId, remote_id: rid, status: 'processing' } } }
        await updateMediaTask(taskId, { status: 'failed', error: JSON.stringify(result.json).slice(0,500) })
        return { status: 502, body: { error: '上游未返回任务 ID' } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }
    if (m === 'POST' && p === '/api/media/music') {
      const r = await authMiddleware(async (req) => {
        const cfg = await getMediaConfig()
        if (!cfg.api_key) return { status: 503, body: { error: '媒体 API 未配置 Key' } }
        const body = await rb(req)
        if (!body.prompt) return { status: 400, body: { error: '缺少 prompt' } }
        const taskId = await createMediaTask({ user_id: req.userId, kind: 'music', provider: cfg.provider || 'duomi', prompt: body.prompt })
        const result = await callLLM({ base_url: cfg.base_url, endpoint: cfg.music_endpoint || '/api/suno/music/generate', api_key: cfg.api_key, body: { prompt: body.prompt, model: body.model || cfg.music_model } })
        const rid = result.json?.task_id || result.json?.id || result.json?.data?.task_id || result.json?.data?.id
        if (rid) { await updateMediaTask(taskId, { remote_id: String(rid), status: 'processing' }); return { status: 200, body: { task_id: taskId, remote_id: rid, status: 'processing' } } }
        await updateMediaTask(taskId, { status: 'failed', error: JSON.stringify(result.json).slice(0,500) })
        return { status: 502, body: { error: '上游未返回任务 ID' } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // ════════════════════════════════════════════════════════
    // ═══ 管理员接口 ═══
    // ════════════════════════════════════════════════════════
    if (m === 'GET' && p === '/api/users') {
      const r = await adminOnly(async () => ({ status: 200, body: { users: await listUsers() } }))(req, res); if (r) sj(res, r.status, r.body); return
    }
    if (m === 'POST' && p.startsWith('/api/users/') && p.endsWith('/status')) {
      const r = await adminOnly(async (req) => { const id = parseInt(p.split('/')[3]); const { status } = await rb(req); await updateUserStatus(id, status); return { status: 200, body: { ok: true } } })(req, res); if (r) sj(res, r.status, r.body); return
    }
    if (m === 'POST' && p.startsWith('/api/users/') && p.endsWith('/recharge')) {
      const r = await adminOnly(async (req) => { const id = parseInt(p.split('/')[3]); const { amount } = await rb(req); await adjustTokenQuota(id, amount, 'recharge'); return { status: 200, body: { ok: true } } })(req, res); if (r) sj(res, r.status, r.body); return
    }
    if (m === 'GET' && p.startsWith('/api/users/') && p.endsWith('/transactions')) {
      const r = await adminOnly(async () => ({ status: 200, body: { transactions: await getTransactions(parseInt(p.split('/')[3])) } }))(req, res); if (r) sj(res, r.status, r.body); return
    }

    // 品牌配置
    if (p === '/api/branding/config') {
      if (m === 'GET') { const r = await adminOnly(async () => ({ status: 200, body: await getBranding() }))(req, res); if (r) sj(res, r.status, r.body) }
      else if (m === 'POST') { const r = await adminOnly(async r => { const b = await rb(r); return { status: 200, body: { ok: true, branding: await updateBranding(b) } } })(req, res); if (r) sj(res, r.status, r.body) }
      return
    }

    // ═══ LLM 供应商管理(管理员)═══
    if (m === 'GET' && p === '/api/admin/providers') {
      const r = await adminOnly(async () => ({ status: 200, body: { providers: await listProviders(), pricing: await listPricing() } }))(req, res); if (r) sj(res, r.status, r.body); return
    }
    if ((m === 'POST' || m === 'PUT') && p === '/api/admin/providers') {
      const r = await adminOnly(async (req) => {
        const b = await rb(req)
        const provider = await upsertProvider(b)
        return { status: 200, body: { ok: true, provider } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }
    if (m === 'DELETE' && p.startsWith('/api/admin/providers/')) {
      const r = await adminOnly(async () => { await deleteProvider(parseInt(p.split('/').pop())); return { status: 200, body: { ok: true } } })(req, res); if (r) sj(res, r.status, r.body); return
    }
    // 计价管理
    if ((m === 'POST' || m === 'PUT') && p === '/api/admin/pricing') {
      const r = await adminOnly(async (req) => {
        const b = await rb(req)
        await upsertPricing(b.provider, b.model, parseFloat(b.price_input), parseFloat(b.price_output))
        return { status: 200, body: { ok: true } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // ═══ OSS 配置(管理员)═══
    if (p === '/api/admin/oss') {
      if (m === 'GET') { const r = await adminOnly(async () => ({ status: 200, body: await getOssConfig() }))(req, res); if (r) sj(res, r.status, r.body) }
      else if (m === 'POST') { const r = await adminOnly(async r => { const b = await rb(r); return { status: 200, body: { ok: true, config: await updateOssConfig(b) } } })(req, res); if (r) sj(res, r.status, r.body) }
      return
    }

    // ═══ 技能管理(管理员)═══
    if (m === 'GET' && p === '/api/admin/skills') {
      const r = await adminOnly(async () => ({ status: 200, body: { skills: await listSkills(false) } }))(req, res); if (r) sj(res, r.status, r.body); return
    }
    if ((m === 'POST' || m === 'PUT') && p === '/api/admin/skills') {
      const r = await adminOnly(async (req) => {
        const b = await rb(req)
        // 安全检查
        const safety = checkSkillSafety(b.title || '', b.content || '')
        if (!safety.safe) return { status: 400, body: { error: '安全检查未通过: ' + safety.reason } }

        // 混合存储:大文件(>=100KB)存磁盘,小文件存数据库
        const SIZE_THRESHOLD = 100 * 1024  // 100KB
        let content = b.content || ''
        let ossKey = b.oss_key || ''

        if (content.length >= SIZE_THRESHOLD) {
          // 写到 public/skills/ 目录,通过 HTTP 访问
          const { writeFileSync, mkdirSync, existsSync } = await import('fs')
          const skillsDir = './public/skills'
          if (!existsSync(skillsDir)) mkdirSync(skillsDir, { recursive: true })
          const safeName = (b.title || 'skill').replace(/[^\w\u4e00-\u9fa5]/g, '_').slice(0, 40)
          const fileName = safeName + '_' + Date.now() + '.txt'
          writeFileSync(skillsDir + '/' + fileName, content, 'utf-8')
          ossKey = '/skills/' + fileName  // 用 oss_key 字段存访问路径
          content = ''  // 数据库不存大内容
          b._large = true
        }

        b.content = content
        b.oss_key = ossKey
        if (b.id) { await updateSkill(b.id, b); return { status: 200, body: { ok: true } } }
        const id = await createSkill(b)
        return { status: 200, body: { ok: true, id, storage: b._large ? 'file' : 'db' } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }
    if (m === 'DELETE' && p.startsWith('/api/admin/skills/')) {
      const r = await adminOnly(async () => { await deleteSkill(parseInt(p.split('/').pop())); return { status: 200, body: { ok: true } } })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // ═══ 技能导入(管理员)— 从 URL 抓取内容自动生成技能 ═══
    if (m === 'POST' && p === '/api/admin/skills/import-url') {
      const r = await adminOnly(async (req) => {
        const b = await rb(req)
        let url = (b.url || '').trim()
        if (!url) return { status: 400, body: { error: '缺少 url' } }

        // 清理 URL 中的特殊字符(复制粘贴时可能混入)
        url = url
          .replace(/[\u2010-\u2015\uff0d]/g, '-')   // 各种特殊连字符 → 普通 -
          .replace(/[\u200b-\u200f\u202a-\u202e\ufeff\ufffc\ufffd]/g, '') // 零宽字符/对象替换符/控制符 → 删除
          .replace(/\s+/g, '')                        // 空白 → 删除
          .trim()

        // 验证 URL 格式
        if (!/^https?:\/\/[^\s]+$/i.test(url)) {
          return { status: 400, body: { error: 'URL 格式不正确，请输入 http:// 或 https:// 开头的链接' } }
        }

        try {
          // 完整的浏览器 User-Agent(避免被网站拦截)
          const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

          // GitHub blob URL → 自动转 raw URL(获取原始文件内容而非 HTML)
          const ghBlob = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/)
          if (ghBlob) {
            url = 'https://raw.githubusercontent.com/' + ghBlob[1] + '/' + ghBlob[2] + '/' + ghBlob[3]
          }

          // GitHub 仓库主页 URL → 优先用 API 获取 README(避免 HTML 太大 fetch 失败)
          const ghRepo = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/?)(?:\?|#.*)?$/)
          if (ghRepo && !ghBlob && !url.includes('/blob/') && !url.includes('/tree/')) {
            const owner = ghRepo[1]
            const repo = ghRepo[2].replace(/\.git$/, '')
            try {
              const apiResp = await fetch('https://api.github.com/repos/' + owner + '/' + repo + '/readme', {
                headers: { 'User-Agent': UA, 'Accept': 'application/vnd.github.v3.raw' },
                signal: AbortSignal.timeout(15000),
              })
              if (apiResp.ok) {
                const readmeText = await apiResp.text()
                const result = parseUrlResponse(apiResp, readmeText, url)
                // 如果标题是 README,换成仓库名
                if (result.body.skill && (!result.body.skill.title || result.body.skill.title.toLowerCase() === 'readme')) {
                  result.body.skill.title = repo
                }
                return result
              }
            } catch (e) {
              console.log('[import-url] GitHub API failed:', e.message)
            }
            // API 失败 → 提示用上传文件方式
            return { status: 502, body: { error: '无法直接抓取 GitHub 仓库内容。请尝试：1) 用具体文件的 blob 链接；2) 或下载文件后用「上传文件」导入。' } }
          }

          // 完整的浏览器 User-Agent — 已在上方定义
          const resp = await fetch(url, {
            signal: AbortSignal.timeout(20000),
            headers: {
              'User-Agent': UA,
              'Accept': 'text/plain,text/markdown,application/json,text/html,*/*',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
            redirect: 'follow',
          })
          if (!resp.ok) {
            // 对 403/401 尝试不带 UA 重试(某些 CDN 拦截非浏览器 UA)
            if (resp.status === 403 || resp.status === 401) {
              const resp2 = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'follow' })
              if (!resp2.ok) return { status: 502, body: { error: '目标网站拒绝访问(HTTP ' + resp.status + ')。该网站可能有反爬保护，请下载文件后用「上传文件」方式导入。' } }
              return parseUrlResponse(resp2, await resp2.text(), url)
            }
            return { status: 502, body: { error: '抓取失败: HTTP ' + resp.status + '(' + resp.statusText + ')' } }
          }
          const text = await resp.text()
          return parseUrlResponse(resp, text, url)
        } catch (e) { return { status: 502, body: { error: '抓取失败: ' + e.message } } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // ═══ 技能导入(管理员)— 上传文件解析(支持压缩包) ═══
    if (m === 'POST' && p === '/api/admin/skills/import-file') {
      const r = await adminOnly(async (req) => {
        const b = await rb(req)
        const filename = String(b.filename || 'upload')
        const isArchive = /\.(zip|tar|tar\.gz|tgz)$/i.test(filename)

        // 处理压缩包:解压后找技能文件
        if (isArchive && b.base64) {
          const { execSync } = await import('child_process')
          const { writeFileSync, mkdirSync, readdirSync, readFileSync, rmSync } = await import('fs')
          const os = await import('os')
          const pathMod = await import('path')
          const tmpDir = pathMod.join(os.tmpdir(), 'skill_import_' + Date.now())
          try {
            mkdirSync(tmpDir, { recursive: true })
            const archivePath = pathMod.join(tmpDir, filename)
            writeFileSync(archivePath, Buffer.from(b.base64, 'base64'))

            // 解压
            if (/\.zip$/i.test(filename)) {
              execSync(`unzip -o -q "${archivePath}" -d "${tmpDir}"`, { timeout: 10000 })
            } else {
              execSync(`tar -xf "${archivePath}" -C "${tmpDir}"`, { timeout: 10000 })
            }

            // 找技能文件(.json/.md/.yaml/.txt/.skill)
            const skillFiles = []
            const packageFiles = []
            function walkDir(dir) {
              for (const ent of readdirSync(dir, { withFileTypes: true })) {
                const full = pathMod.join(dir, ent.name)
                if (ent.isDirectory()) walkDir(full)
                else if (ent.name === 'SKILL.md') packageFiles.push(full)
                else if (/\.(json|md|yaml|yml|txt|skill)$/i.test(ent.name)) skillFiles.push(full)
              }
            }
            walkDir(tmpDir)

            if (skillFiles.length === 0 && packageFiles.length === 0) return { status: 400, body: { error: '压缩包内未找到技能文件(.json/.md/.yaml/.txt/.skill)' } }

            // 技能组名:用压缩包文件名(去掉扩展名)
            const groupName = filename.replace(/\.(zip|tar|tar\.gz|tgz)$/i, '').replace(/[^\w\u4e00-\u9fa5\-_]/g, '_').slice(0, 60)

            // ── 结构化技能包: 有 SKILL.md → 保留完整目录到 public/skills/包名/ ──
            if (packageFiles.length > 0) {
              const pkgSkillMd = packageFiles[0]
              const pkgRoot = pathMod.dirname(pkgSkillMd)
              const raw = readFileSync(pkgSkillMd, 'utf-8')
              const parsed = parseSkillContent(raw, 'SKILL.md')
              // 提取触发词(SKILL.md front-matter 或正文里的 "触发词：" 行)
              const trigMatch = raw.match(/触发词[：:]\s*(.+)/) || raw.match(/triggers?[：:]\s*(.+)/i)
              const triggerWords = trigMatch ? trigMatch[1].replace(/[、，,]/g, ',').split(',').map(s => s.trim()).filter(Boolean).slice(0, 10).join(',') : ''

              // 把整个包目录复制到 public/skills/包名/
              const pkgName = (parsed.title || groupName).replace(/[^\w\u4e00-\u9fa5\-_]/g, '_').slice(0, 50)
              const destDir = './public/skills/pkg_' + Date.now() + '_' + pkgName
              execSync(`cp -r "${pkgRoot}" "${destDir}"`, { timeout: 5000 })
              // 计算包内文件清单
              const pkgList = []
              function listPkg(dir) {
                for (const ent of readdirSync(dir, { withFileTypes: true })) {
                  const full = pathMod.join(dir, ent.name)
                  if (ent.isDirectory()) listPkg(full)
                  else pkgList.push(pathMod.relative(destDir, full))
                }
              }
              listPkg(destDir)

              // 安全检查所有脚本文件
              for (const f of packageFiles.concat(skillFiles.filter(f => /\.(sh|py|js)$/i.test(f)))) {
                const rawF = readFileSync(f, 'utf-8')
                const safety = checkSkillSafety(parsed.title, rawF)
                if (!safety.safe) {
                  execSync(`rm -rf "${destDir}"`)
                  return { status: 400, body: { error: '技能包安全检查未通过: ' + safety.reason } }
                }
              }

              parsed.skill_group = groupName
              parsed.trigger_words = triggerWords
              parsed.has_package = 1
              parsed.package_dir = destDir.replace('./public', '')
              // 包说明: 文件列表
              parsed.description = (parsed.description || '') + (pkgList.length > 1 ? ` [包内含 ${pkgList.length} 个文件]` : '')

              const safety = checkSkillSafety(parsed.title, parsed.content)
              if (!safety.safe) return { status: 400, body: { error: '安全检查未通过: ' + safety.reason } }
              // 独立更新: 同名包已存在 → 升版本更新,而非重复创建
              const [existing] = await pool.query('SELECT id, version, package_dir FROM skills WHERE title=? AND skill_group=? LIMIT 1', [parsed.title, groupName])
              let id, isNew = true, version = 1
              if (existing.length && existing[0].package_dir) {
                // 删旧包目录,更新记录
                try { execSync(`rm -rf "./public${existing[0].package_dir}"`) } catch {}
                version = (existing[0].version || 1) + 1
                await pool.query('UPDATE skills SET description=?, content=?, category=?, icon_url=?, trigger_words=?, has_package=1, package_dir=?, version=? WHERE id=?',
                  [parsed.description, parsed.content, parsed.category, parsed.icon_url, parsed.trigger_words, parsed.package_dir, version, existing[0].id])
                id = existing[0].id
                isNew = false
              } else {
                id = await createSkill(parsed)
              }
              try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
              return { status: 200, body: { ok: true, skill: { ...parsed, id, version }, updated: !isNew, version, package: { files: pkgList }, group: groupName } }
            }

            // 如果只有一个文件,返回解析结果让用户确认(附带 group 名)
            if (skillFiles.length === 1) {
              const raw = readFileSync(skillFiles[0], 'utf-8')
              const parsed = parseSkillContent(raw, pathMod.basename(skillFiles[0]))
              parsed.skill_group = groupName
              return { status: 200, body: { ok: true, skill: parsed, group: groupName } }
            }

            // 多个文件:批量导入,归到同一个技能组,做安全检查
            const imported = []
            const rejected = []
            for (const f of skillFiles) {
              const raw = readFileSync(f, 'utf-8')
              const parsed = parseSkillContent(raw, pathMod.basename(f))
              // 安全检查
              const safety = checkSkillSafety(parsed.title, parsed.content)
              if (!safety.safe) { rejected.push({ title: parsed.title, reason: safety.reason }); continue }
              parsed.skill_group = groupName
              parsed.category = parsed.category || groupName  // 没有分类的用组名
              const id = await createSkill(parsed)
              imported.push({ id, title: parsed.title })
            }
            try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
            return { status: 200, body: { ok: true, group: groupName, skills: imported, rejected } }
          } catch (e) {
            try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
            return { status: 500, body: { error: '解压失败: ' + e.message } }
          }
        }

        // 普通文本文件
        const raw = String(b.content || b.text || '')
        if (!raw) return { status: 400, body: { error: '缺少文件内容' } }
        const parsed = parseSkillContent(raw, filename)
        return { status: 200, body: { ok: true, skill: parsed } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // ═══ 媒体配置(管理员)═══
    if (p === '/api/admin/media') {
      if (m === 'GET') { const r = await adminOnly(async () => ({ status: 200, body: await getMediaConfig() }))(req, res); if (r) sj(res, r.status, r.body) }
      else if (m === 'POST') { const r = await adminOnly(async r => { const b = await rb(r); return { status: 200, body: { ok: true, config: await updateMediaConfig(b) } } })(req, res); if (r) sj(res, r.status, r.body) }
      return
    }

    // ═══ 测试上游连通(管理员)═══
    if (m === 'POST' && p === '/api/admin/test') {
      const r = await adminOnly(async (req) => {
        const b = await rb(req)
        const base = (b.base_url || '').replace(/\/$/, '')
        const apiKey = b.api_key || ''
        try {
          let fullUrl, headers = {}, method = 'GET'

          if (base.includes('duomi') || base.includes('wike')) {
            // 多米:用余额查询接口测试(非 OpenAI 兼容,/v1/models 不存在)
            fullUrl = 'https://api.wike.cc/api/account/get?key=' + encodeURIComponent(apiKey)
          } else if (b.endpoint && b.endpoint !== '/v1/models') {
            // 指定了自定义端点
            fullUrl = base + b.endpoint
            if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey
          } else {
            // 标准 OpenAI 兼容:GET /v1/models
            fullUrl = base + '/v1/models'
            if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey
          }

          const resp = await fetch(fullUrl, { method, headers })
          const text = await resp.text()

          // 多米特殊判断:HTTP 200 但 JSON code:403 = key 错;code:200 或有 balance = 成功
          let ok = resp.ok
          if (base.includes('duomi') || base.includes('wike')) {
            try {
              const j = JSON.parse(text)
              ok = !!((j.code === 200) || (j.data && j.data.balance !== undefined))
            } catch {}
          }

          return { status: 200, body: { ok, status: resp.status, sample: text.slice(0, 300) } }
        } catch (e) { return { status: 200, body: { ok: false, status: 0, sample: e.message } } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // ═══ 媒体上传(桌面端把本地图片上传,获取公网 URL 给手机端)═══
    if (m === 'POST' && p === '/api/media/upload') {
      const r = await authMiddleware(async (req) => {
        const body = await rb(req)
        // body: { filename, base64, mime_type }
        if (!body.base64 || !body.filename) return { status: 400, body: { error: '缺少 base64 或 filename' } }
        const { writeFile, mkdir } = await import('fs/promises')
        const { existsSync } = await import('fs')
        const dir = './public/uploads/' + req.userId
        if (!existsSync(dir)) await mkdir(dir, { recursive: true })
        const safeName = String(body.filename).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
        const fpath = dir + '/' + safeName
        await writeFile(fpath, Buffer.from(body.base64, 'base64'))
        const publicUrl = (process.env.PUBLIC_BASE_URL || 'https://zy.tangdou2027.top/admin') + '/uploads/' + req.userId + '/' + safeName
        return { status: 200, body: { ok: true, url: publicUrl } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // ═══ 公开静态文件:技能大文件(无需认证)═══
    if (m === 'GET' && p.startsWith('/skills/')) {
      const { createReadStream, existsSync, statSync } = await import('fs')
      const relPath = p.slice('/skills/'.length).replace(/\.\./g, '')
      const fpath = './public/skills/' + relPath
      if (!existsSync(fpath)) { sj(res, 404, { error: '文件不存在' }); return }
      try {
        const stat = statSync(fpath)
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=3600' })
        createReadStream(fpath).pipe(res)
      } catch { sj(res, 404, { error: '读取失败' }) }
      return
    }

    // ═══ 公开静态文件:上传的媒体(无需认证)═══
    if (m === 'GET' && p.startsWith('/uploads/')) {
      const { createReadStream, statSync, existsSync } = await import('fs')
      const relPath = p.slice('/uploads/'.length).replace(/\.\./g, '')  // 防目录穿越
      const fpath = './public/uploads/' + relPath
      if (!existsSync(fpath)) { sj(res, 404, { error: '文件不存在' }); return }
      const ext = fpath.split('.').pop().toLowerCase()
      const mime = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif', mp4:'video/mp4', webm:'video/webm', mp3:'audio/mpeg', wav:'audio/wav' }[ext] || 'application/octet-stream'
      try {
        const stat = statSync(fpath)
        res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=86400' })
        createReadStream(fpath).pipe(res)
      } catch { sj(res, 404, { error: '读取失败' }) }
      return
    }

    // ════════════════════════════════════════════════════════
    // ═══ 工作流系统 (ActionSpec) ═══
    // ════════════════════════════════════════════════════════

    // GET /api/workflows — 列表(自己的 + 公共的)
    if (m === 'GET' && p === '/api/workflows') {
      const r = await authMiddleware(async (req) => {
        const [rows] = await pool.query(
          'SELECT id, user_id, name, description, spec, enabled, runs_count, last_run_at, created_at FROM workflows WHERE user_id IN (0, ?) ORDER BY id DESC',
          [req.userId]
        )
        return { status: 200, body: { workflows: rows.map(w => ({ ...w, spec: JSON.parse(w.spec) })) } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // POST /api/workflows — 创建
    if (m === 'POST' && p === '/api/workflows') {
      const r = await authMiddleware(async (req) => {
        const b = await rb(req)
        if (!b.name) return { status: 400, body: { error: '缺少 name' } }
        // 套餐限制: free 用户最多 3 个云端工作流
        const perms = await getUserPermissions(req.userId)
        if (perms.plan === 'free') {
          const [cnt] = await pool.query('SELECT COUNT(*) as n FROM workflows WHERE user_id=?', [req.userId])
          if (cnt[0].n >= 3) return { status: 403, body: { error: '免费套餐最多创建 3 个云端工作流,升级 Pro 解锁无限(本地工作流不受限)' } }
        }
        let spec = b.spec
        if (typeof spec === 'string') { try { spec = JSON.parse(spec) } catch { return { status: 400, body: { error: 'spec 不是合法 JSON' } } } }
        try { validateSpec(spec) } catch (e) { return { status: 400, body: { error: e.message } } }
        // 从 queue 包装提取策略(priority/maxAttempts/timeout/lockGroup)
        let priority = 0
        if (spec.type === 'queue' && spec.options) {
          const o = spec.options
          priority = Math.min(Math.max(parseInt(o.priority) || 0, 0), 100)
          // queue 包装在服务端展开为直接动作 + 策略
          spec = spec.action
          if (o.timeoutMs) b._timeout = o.timeoutMs
        }
        const [result] = await pool.query(
          'INSERT INTO workflows(user_id, name, description, spec) VALUES(?,?,?,?)',
          [req.userId, b.name, b.description || '', JSON.stringify(spec)]
        )
        return { status: 200, body: { ok: true, id: result.insertId } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // PUT /api/workflows/:id — 更新
    if (m === 'PUT' && p.startsWith('/api/workflows/')) {
      const r = await authMiddleware(async (req) => {
        const id = parseInt(p.split('/')[3])
        const b = await rb(req)
        let spec = b.spec
        if (typeof spec === 'string') { try { spec = JSON.parse(spec) } catch { return { status: 400, body: { error: 'spec 不是合法 JSON' } } } }
        try { validateSpec(spec) } catch (e) { return { status: 400, body: { error: e.message } } }
        await pool.query(
          'UPDATE workflows SET name=?, description=?, spec=?, enabled=? WHERE id=? AND user_id IN (0,?)',
          [b.name || '', b.description || '', JSON.stringify(spec), b.enabled === false ? 0 : 1, id, req.userId]
        )
        return { status: 200, body: { ok: true } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // DELETE /api/workflows/:id
    if (m === 'DELETE' && p.startsWith('/api/workflows/')) {
      const r = await authMiddleware(async (req) => {
        const id = parseInt(p.split('/')[3])
        await pool.query('DELETE FROM workflows WHERE id=? AND user_id IN (0,?)', [id, req.userId])
        await pool.query('DELETE FROM cron_jobs WHERE workflow_id=?', [id])
        return { status: 200, body: { ok: true } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // POST /api/workflows/:id/run — 立即执行(入队)
    if (m === 'POST' && p.match(/^\/api\/workflows\/\d+\/run$/)) {
      const r = await authMiddleware(async (req) => {
        const id = parseInt(p.split('/')[3])
        const [rows] = await pool.query('SELECT * FROM workflows WHERE id=? AND user_id IN (0,?) AND enabled=1', [id, req.userId])
        if (!rows.length) return { status: 404, body: { error: '工作流不存在或已禁用' } }
        const [result] = await pool.query(
          'INSERT INTO task_queue(user_id, workflow_id, action_spec, priority) VALUES(?,?,?,10)',
          [req.userId, id, rows[0].spec]
        )
        return { status: 200, body: { ok: true, task_id: result.insertId } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // ═══ 定时任务 (cron) ═══

    // GET /api/cron-jobs
    if (m === 'GET' && p === '/api/cron-jobs') {
      const r = await authMiddleware(async (req) => {
        const [rows] = await pool.query(
          'SELECT c.*, w.name as workflow_name FROM cron_jobs c LEFT JOIN workflows w ON c.workflow_id=w.id WHERE c.user_id=? ORDER BY c.id DESC',
          [req.userId]
        )
        return { status: 200, body: { jobs: rows.map(j => ({ ...j, action_spec: j.action_spec ? JSON.parse(j.action_spec) : null })) } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // POST /api/cron-jobs — 创建定时任务
    if (m === 'POST' && p === '/api/cron-jobs') {
      const r = await authMiddleware(async (req) => {
        const b = await rb(req)
        if (!b.name || !b.cron_expr) return { status: 400, body: { error: '缺少 name 或 cron_expr' } }
        const next = nextCronRun(b.cron_expr)
        if (!next) return { status: 400, body: { error: 'cron 表达式无效(需 5 段: 分 时 日 月 周)' } }
        let actionSpec = null
        if (b.action_spec) {
          actionSpec = typeof b.action_spec === 'string' ? b.action_spec : JSON.stringify(b.action_spec)
          try { validateSpec(JSON.parse(actionSpec)) } catch (e) { return { status: 400, body: { error: e.message } } }
        } else if (!b.workflow_id) {
          return { status: 400, body: { error: '需要 action_spec 或 workflow_id' } }
        }
        const [result] = await pool.query(
          'INSERT INTO cron_jobs(user_id, name, cron_expr, workflow_id, action_spec, next_run_at) VALUES(?,?,?,?,?,?)',
          [req.userId, b.name, b.cron_expr, b.workflow_id || null, actionSpec, next]
        )
        return { status: 200, body: { ok: true, id: result.insertId, next_run_at: next } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // PUT /api/cron-jobs/:id — 更新/启停
    if (m === 'PUT' && p.startsWith('/api/cron-jobs/')) {
      const r = await authMiddleware(async (req) => {
        const id = parseInt(p.split('/')[3])
        const b = await rb(req)
        if (b.enabled === false || b.enabled === true) {
          await pool.query('UPDATE cron_jobs SET enabled=? WHERE id=? AND user_id=?', [b.enabled ? 1 : 0, id, req.userId])
          if (b.enabled) {
            const next = nextCronRun(b.cron_expr || '* * * * *')
            await pool.query('UPDATE cron_jobs SET next_run_at=? WHERE id=?', [next, id])
          }
        } else if (b.cron_expr) {
          const next = nextCronRun(b.cron_expr)
          if (!next) return { status: 400, body: { error: 'cron 表达式无效' } }
          await pool.query('UPDATE cron_jobs SET name=?, cron_expr=?, next_run_at=? WHERE id=? AND user_id=?',
            [b.name, b.cron_expr, next, id, req.userId])
        }
        return { status: 200, body: { ok: true } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // DELETE /api/cron-jobs/:id
    if (m === 'DELETE' && p.startsWith('/api/cron-jobs/')) {
      const r = await authMiddleware(async (req) => {
        await pool.query('DELETE FROM cron_jobs WHERE id=? AND user_id=?', [parseInt(p.split('/')[3]), req.userId])
        return { status: 200, body: { ok: true } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // ═══ 任务队列 (桌面端轮询) ═══

    // GET /api/tasks/poll?worker=xxx — 桌面端领取任务
    if (m === 'GET' && p === '/api/tasks/poll') {
      const r = await authMiddleware(async (req) => {
        const workerId = rawUrl.searchParams.get('worker') || 'desktop'
        const task = await claimTask(workerId)
        return { status: 200, body: { task } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // POST /api/tasks/:id/result — 上报结果
    if (m === 'POST' && p.match(/^\/api\/tasks\/\d+\/result$/)) {
      const r = await authMiddleware(async (req) => {
        const id = parseInt(p.split('/')[3])
        const b = await rb(req)
        const out = await reportTaskResult(id, b.worker || 'desktop', b.ok !== false, b.result, b.error)
        return { status: 200, body: out }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // GET /api/tasks — 任务历史
    if (m === 'GET' && p === '/api/tasks') {
      const r = await authMiddleware(async (req) => {
        const limit = Math.min(parseInt(rawUrl.searchParams.get('limit') || '50'), 200)
        const [rows] = await pool.query(
          'SELECT id, cron_job_id, workflow_id, status, priority, attempts, error, LEFT(result, 500) as result_preview, created_at, started_at, finished_at FROM task_queue WHERE user_id=? ORDER BY id DESC LIMIT ?',
          [req.userId, limit]
        )
        return { status: 200, body: { tasks: rows } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // ═══ 权限下发 ═══

    // GET /api/permissions — 当前用户权限(技能/动作/套餐)
    if (m === 'GET' && p === '/api/permissions') {
      const r = await authMiddleware(async (req) => {
        const perms = await getUserPermissions(req.userId)
        // 过滤技能列表
        const allSkills = await listSkills(true)
        const visibleSkills = perms.skill_ids === '*'
          ? allSkills
          : allSkills.filter(s => perms.skill_ids.includes(s.id))
        return { status: 200, body: { ...perms, skills_count: visibleSkills.length, total_skills: allSkills.length } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // ═══ 管理员: 用户套餐管理 ═══
    if (m === 'POST' && p.startsWith('/api/users/') && p.endsWith('/plan')) {
      const r = await adminOnly(async (req) => {
        const id = parseInt(p.split('/')[3])
        const { plan } = await rb(req)
        if (!['free', 'pro', 'enterprise'].includes(plan)) return { status: 400, body: { error: '套餐必须是 free/pro/enterprise' } }
        await pool.query('UPDATE users SET plan=? WHERE id=?', [plan, id])
        return { status: 200, body: { ok: true } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // 管理员: 任务总览
    if (m === 'GET' && p === '/api/admin/tasks') {
      const r = await adminOnly(async () => {
        const [stats] = await pool.query(
          "SELECT status, COUNT(*) as cnt FROM task_queue GROUP BY status"
        )
        const [recent] = await pool.query(
          'SELECT t.id, t.user_id, u.username, t.status, t.error, t.created_at, t.finished_at FROM task_queue t LEFT JOIN users u ON t.user_id=u.id ORDER BY t.id DESC LIMIT 30'
        )
        return { status: 200, body: { stats, recent } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // ═══ 版本管理(在线升级) ═══
    // GET /api/version?platform=mac-x64 — 公开, 客户端检查更新
    if (m === 'GET' && p === '/api/version') {
      const platform = rawUrl.searchParams.get('platform') || ''
      const [rows] = await pool.query(
        'SELECT platform, version, notes, file_url, created_at FROM app_versions WHERE platform=? ORDER BY id DESC LIMIT 1',
        [platform]
      )
      sj(res, 200, rows[0] || { platform, version: null })
      return
    }

    // GET /api/admin/versions — 管理员: 全部版本历史
    if (m === 'GET' && p === '/api/admin/versions') {
      const r = await adminOnly(async () => {
        const [rows] = await pool.query('SELECT * FROM app_versions ORDER BY id DESC LIMIT 50')
        return { status: 200, body: { versions: rows } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // POST /api/admin/versions — 管理员: 发布新版本
    if (m === 'POST' && p === '/api/admin/versions') {
      const r = await adminOnly(async (req) => {
        const b = await rb(req)
        if (!b.platform || !b.version) return { status: 400, body: { error: '缺少 platform/version' } }
        await pool.query('INSERT INTO app_versions(platform, version, notes, file_url) VALUES(?,?,?,?)',
          [b.platform, b.version, b.notes || '', b.file_url || ''])
        return { status: 200, body: { ok: true } }
      })(req, res); if (r) sj(res, r.status, r.body); return
    }

    // ═══ 静态页面 ═══
    if (m === 'GET' && (p === '/' || p === '/index.html')) {
      const { readFileSync } = await import('fs')
      try { res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); res.end(readFileSync('./public/index.html', 'utf-8')) }
      catch { sj(res, 200, { ok: true, message: 'MyAI Admin' }) }
      return
    }
    if (m === 'GET' && (p === '/m' || p === '/m/' || p === '/mobile')) {
      const { readFileSync } = await import('fs')
      try { res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); res.end(readFileSync('./public/mobile.html', 'utf-8')) }
      catch { sj(res, 200, { ok: true }) }
      return
    }
    sj(res, 404, { error: 'Not found' })
  } catch (e) { console.error('[admin]', e.message, e.stack); sj(res, 500, { error: e.message }) }
})

server.listen(PORT, () => console.log('MyAI Admin v2 ' + PORT + ' (多模型+OSS+媒体)'))
