// workflow-engine.js — ActionSpec 工作流引擎 + 队列 + Cron 调度
// 架构: 服务端只存状态,桌面端轮询领取任务并在本地执行(浏览器/命令等需要本地环境)
import { pool } from './db.js'

const WORKER_LEASE_MS = 60 * 1000        // 租约 60 秒(客户端每 20 秒续约)
const MAX_QUEUE_JOBS = 5000

// ── Cron 表达式 → 下次执行时间 ──────────────────────────
// 支持: * * * * * / 数字 / */n / a-b / a,b
function nextCronRun(expr, from = new Date()) {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [mf, mh, mdom, mmon, mdow] = parts
  const d = new Date(from.getTime() + 60 * 1000)  // 从下一分钟开始
  d.setSeconds(0, 0)
  for (let i = 0; i < 525600 * 2; i++) {  // 最多找 2 年
    if (matchField(mf, d.getMinutes()) && matchField(mh, d.getHours())
      && matchDomMonDow(mdom, mmon, mdow, d)) {
      return d
    }
    d.setTime(d.getTime() + 60 * 1000)
  }
  return null
}

function matchField(field, value) {
  if (field === '*') return true
  for (const part of field.split(',')) {
    if (part.startsWith('*/')) {
      const n = parseInt(part.slice(2))
      if (n > 0 && value % n === 0) return true
    } else if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number)
      if (value >= a && value <= b) return true
    } else if (parseInt(part) === value) return true
  }
  return false
}

function matchDomMonDow(domF, monF, dowF, d) {
  const domOk = matchField(domF, d.getDate())
  const monOk = matchField(monF, d.getMonth() + 1)
  const dowOk = matchField(dowF, d.getDay())
  // 标准 cron: dom 和 dow 都非 * 时,任一匹配即可
  if (domF !== '*' && dowF !== '*') return monOk && (domOk || dowOk)
  return domOk && monOk && dowOk
}

// ── Cron 调度器: 每分钟检查到期任务,入队 ─────────────────
let cronTimer = null

export function startCronScheduler() {
  if (cronTimer) return
  const tick = async () => {
    try {
      // 找出到期且未执行的 cron 任务
      const [due] = await pool.query(
        'SELECT * FROM cron_jobs WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at<=NOW()'
      )
      for (const job of due) {
        // 入队
        const spec = job.action_spec || (job.workflow_id
          ? (await pool.query('SELECT spec FROM workflows WHERE id=?', [job.workflow_id]))[0][0]?.spec
          : null)
        if (spec) {
          await pool.query(
            'INSERT INTO task_queue(user_id, cron_job_id, workflow_id, action_spec, priority) VALUES(?,?,?,?,5)',
            [job.user_id, job.id, job.workflow_id, spec]
          )
        }
        const next = nextCronRun(job.cron_expr, new Date())
        await pool.query('UPDATE cron_jobs SET last_run_at=NOW(), next_run_at=?, run_count=run_count+1 WHERE id=?',
          [next, job.id])
      }
      // 补算没算 next_run_at 的
      const [noNext] = await pool.query('SELECT id, cron_expr FROM cron_jobs WHERE enabled=1 AND next_run_at IS NULL')
      for (const job of noNext) {
        const next = nextCronRun(job.cron_expr)
        if (next) await pool.query('UPDATE cron_jobs SET next_run_at=? WHERE id=?', [next, job.id])
        else await pool.query('UPDATE cron_jobs SET enabled=0 WHERE id=?', [job.id])  // 无效表达式,禁用
      }
    } catch (e) { console.error('[cron-scheduler]', e.message) }
  }
  tick()
  cronTimer = setInterval(tick, 30 * 1000)  // 每 30 秒检查
  console.log('[workflow] Cron 调度器已启动(30s/次)')
}

// ── 队列维护: 回收过期租约 / 清理历史 ────────────────────
export function startQueueMaintenance() {
  const tick = async () => {
    try {
      // 租约超时的 running 任务 → 回到 pending(如果还有重试次数)或标记失败
      const [expired] = await pool.query(
        "SELECT id, attempts, max_attempts FROM task_queue WHERE status='running' AND locked_at < (NOW() - INTERVAL 90 SECOND)"
      )
      for (const t of expired) {
        if (t.max_attempts > 0 && t.attempts < t.max_attempts) {
          await pool.query("UPDATE task_queue SET status='pending', locked_by='', locked_at=NULL WHERE id=?", [t.id])
        } else {
          await pool.query("UPDATE task_queue SET status='failed', error='执行超时(租约过期)', finished_at=NOW() WHERE id=?", [t.id])
        }
      }
      // 历史清理: 只留最近 500 条终态
      await pool.query(
        "DELETE FROM task_queue WHERE status IN ('done','failed') AND id < (SELECT min_id FROM (SELECT MIN(id) as min_id FROM (SELECT id FROM task_queue WHERE status IN ('done','failed') ORDER BY id DESC LIMIT 500) as t) as x)"
      )
    } catch (e) { console.error('[queue-maintenance]', e.message) }
  }
  tick()
  setInterval(tick, 60 * 1000)
  console.log('[workflow] 队列维护已启动(60s/次)')
}

// ── 任务领取(桌面端轮询, 支持退避时间 + 资源锁组) ─────────
export async function claimTask(workerId) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 资源锁: 同组只允许一个 running(空组不互斥)
    const [lockRows] = await conn.query(
      "SELECT DISTINCT lock_group FROM task_queue WHERE status='running' AND lock_group != ''"
    )
    const lockedGroups = lockRows.map(r => r.lock_group)
    // 候选: pending + 退避时间已到 + (无组 或 组未被锁), 优先级高优先
    const [rows] = await conn.query(
      "SELECT * FROM task_queue WHERE status='pending' AND (retry_next_at IS NULL OR retry_next_at<=NOW()) ORDER BY priority DESC, id ASC LIMIT 5 FOR UPDATE"
    )
    const task = rows.find(t => !t.lock_group || !lockedGroups.includes(t.lock_group))
    if (!task) { await conn.commit(); return null }
    await conn.query(
      "UPDATE task_queue SET status='running', locked_by=?, locked_at=NOW(), started_at=NOW(), attempts=attempts+1, retry_next_at=NULL WHERE id=?",
      [workerId, task.id]
    )
    await conn.commit()
    return {
      id: task.id,
      user_id: task.user_id,
      cron_job_id: task.cron_job_id,
      workflow_id: task.workflow_id,
      action_spec: JSON.parse(task.action_spec),
      timeout_ms: task.timeout_ms,
      attempts: task.attempts + 1,
      max_attempts: task.max_attempts
    }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// ── 任务结果上报 ───────────────────────────────────────
export async function reportTaskResult(taskId, workerId, ok, result, error) {
  let [rows] = await pool.query('SELECT * FROM task_queue WHERE id=?', [taskId])
  const task = rows[0]
  if (!task) throw new Error('任务不存在')
  if (task.status !== 'running') throw new Error('任务不在 running 状态')

  if (ok) {
    await pool.query(
      "UPDATE task_queue SET status='done', result=?, finished_at=NOW() WHERE id=?",
      [result ? JSON.stringify(result).slice(0, 100000) : null, taskId]
    )
    // 关联的工作流计数
    if (task.workflow_id) {
      await pool.query('UPDATE workflows SET runs_count=runs_count+1, last_run_at=NOW() WHERE id=?', [task.workflow_id])
    }
    return { ok: true, status: 'done' }
  }
  // 失败: 判断重试(指数退避: 10s → 20s → 40s → ... 上限 10 分钟)
  if (task.max_attempts > 0 && task.attempts < task.max_attempts) {
    const baseMs = 10 * 1000
    const backoffMs = Math.min(baseMs * Math.pow(2, task.attempts - 1), 10 * 60 * 1000)
    const retryNext = new Date(Date.now() + backoffMs)
    await pool.query(
      "UPDATE task_queue SET status='pending', locked_by='', locked_at=NULL, retry_next_at=?, error=? WHERE id=?",
      [retryNext, String(error).slice(0, 2000), taskId]
    )
    return { ok: false, status: 'pending', retry: true, attempts: task.attempts, max: task.max_attempts, retry_in_ms: backoffMs }
  }
  await pool.query(
    "UPDATE task_queue SET status='failed', error=?, finished_at=NOW() WHERE id=?",
    [String(error).slice(0, 2000), taskId]
  )
  return { ok: false, status: 'failed' }
}

// ── 权限: 获取用户技能/动作权限 ─────────────────────────
export async function getUserPermissions(userId) {
  const [uRows] = await pool.query('SELECT plan FROM users WHERE id=?', [userId])
  const plan = uRows[0]?.plan || 'pro'
  // 套餐默认权限
  const [pRows] = await pool.query('SELECT * FROM permission_plans WHERE name=?', [plan])
  const planCfg = pRows[0] || { skill_ids: '*', actions: '*', can_install: 1 }
  // 用户级覆盖(优先)
  const [overrides] = await pool.query(
    'SELECT skill_id, actions, can_install FROM user_permissions WHERE user_id=?', [userId]
  )
  const userCanInstall = overrides.length ? overrides[0].can_install : planCfg.can_install
  let allowedSkillIds = planCfg.skill_ids === '*' ? '*' : JSON.parse(planCfg.skill_ids || '[]')
  // 用户级技能授权追加
  for (const o of overrides) {
    if (o.skill_id != null) {
      if (Array.isArray(allowedSkillIds)) allowedSkillIds.push(o.skill_id)
    }
  }
  return {
    plan,
    can_install: !!userCanInstall,
    skill_ids: allowedSkillIds,
    actions: planCfg.actions || '*'
  }
}

// ── 工作流 CRUD 辅助 ───────────────────────────────────
export async function validateSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('spec 必须是对象')
  const validTypes = ['message', 'generate_image', 'notify', 'web_search', 'exec_command', 'api_call', 'delay', 'sequence', 'queue']
  function walk(node) {
    if (!node.type) throw new Error('ActionSpec 缺少 type')
    if (!validTypes.includes(node.type)) throw new Error(`未知动作类型: ${node.type}`)
    if (node.type === 'sequence') {
      if (!Array.isArray(node.steps)) throw new Error('sequence 需要 steps 数组')
      node.steps.forEach(walk)
    }
    if (node.type === 'queue') {
      if (!node.action) throw new Error('queue 需要 action')
      walk(node.action)
    }
  }
  walk(spec)
  return true
}

export { nextCronRun }
