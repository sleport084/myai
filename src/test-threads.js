// 线索模型（DynamicMemoryPool.md 第 8 章）纯算法测试。
// 不动数据库、不动 LLM、不动网络。
//
// 重点覆盖"专注栈四 bug 在线索模型下失去存在前提"的回归断言：
//   1. 干活不饿死：开放承诺钉住温度，任意墙钟时间后 warm 不降。
//   2. 指代性问询路由：前台在别处时"干得怎么样了"切回承诺线索。
//   3. 单关键词不误切换：与后台重叠=1 → 新建+ambiguous，前台明确切换需要重叠≥2。
//   4. 读时减法可自愈：温度由 buildThreadView 每轮重算，无任何"清理"状态突变。
//   5. focusStack → threads 迁移：栈顶=前台，conclusions 保留。
//
// prompt 集成（<thread> 渲染）需要 stub loader（prompt.js 间接接 DB）。
//
// Run: node src/test-threads.js
import { register } from 'node:module'
register('./test-prompt-split-loader.mjs', import.meta.url)

import {
  ensureThreadState, attributeUserMessage, buildThreadView, getForegroundThread,
  openCommitment, closeCommitment, touchCommitmentThread, latestOpenCommitment,
  mergeThreads, migrateFocusStackToThreads, threadTemperature, makeThread,
  isIndexicalProgressQuery, isLikelyOneOffLeaf,
  WARM_WINDOW_MS, COOL_WINDOW_MS, MAX_WARM_INJECTED,
} from './memory/threads.js'
import { buildSummarizeInput } from './memory/thread-summarize.js'
import { buildContextBlock } from './prompt.js'

let failed = 0
function assert(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`)
    failed++
    process.exitCode = 1
  } else {
    console.log(`PASS: ${label}`)
  }
}

function makeState() {
  return { threadState: { threads: [], foregroundId: null, commitments: [] } }
}

// 白盒造线索（绕开 token 切分偶然性）
function addThread(state, topic, { lastEventAgoMs = 0, foreground = false, conclusions = [] } = {}) {
  const ts = ensureThreadState(state)
  const t = makeThread(topic)
  t.lastEventAt = new Date(Date.now() - lastEventAgoMs).toISOString()
  t.createdAt = new Date(Date.now() - lastEventAgoMs - 60000).toISOString()
  t.conclusions = conclusions
  ts.threads.push(t)
  if (foreground) ts.foregroundId = t.id
  return t
}

console.log('— 基础归属 —')
{
  const state = makeState()
  const r1 = attributeUserMessage(state, '帮我 build realtime dashboard component integration 这个项目')
  assert(r1.event === 'created', '首条实质消息 → created')
  assert(getForegroundThread(state) === r1.thread, 'created 线索成为前台')

  const r2 = attributeUserMessage(state, '继续把 dashboard component 部分做完')
  assert(r2.event === 'continued', '前台重叠 ≥1 → continued')

  const r3 = attributeUserMessage(state, '今天广州的天气怎么样啊')
  assert(r3.event === 'noop', '天气叶子 → noop 不动线索')
  assert(getForegroundThread(state) === r1.thread, '叶子不改前台')
}

console.log('— Bug1 回归：干活不饿死（承诺钉温度） —')
{
  const state = makeState()
  const t = addThread(state, ['alpha', 'mainline', 'project'], { foreground: true })
  openCommitment(state, { text: '完成 alpha 项目部署', threadId: t.id })
  // 模拟"干活很久没人说话"：lastEventAt 推到 3 天前（远超 COOL_WINDOW）
  t.lastEventAt = new Date(Date.now() - COOL_WINDOW_MS - 24 * 3600 * 1000).toISOString()
  // 前台让位给别的线索，t 退到后台
  addThread(state, ['beta', 'chat', 'topic'], { foreground: true })
  assert(threadTemperature(state, t) === 'warm', '开放承诺钉住温度：3 天没动静仍 warm 不降')
  closeCommitment(state, { threadId: t.id })
  assert(threadTemperature(state, t) === 'cold', '承诺关闭后按 lastEventAt 自然降温为 cold')

  // touchCommitmentThread：Agent 干活刷新承诺线索
  const c = openCommitment(state, { text: '继续 alpha', threadId: t.id })
  const before = t.hitCount
  assert(touchCommitmentThread(state) === true, '工具调用 touch 承诺线索成功')
  assert(t.hitCount === before + 1, 'touch 刷新 hitCount')
  assert(latestOpenCommitment(state).id === c.id, 'latestOpenCommitment 取到该承诺')
}

console.log('— Bug2 回归：指代性问询路由到开放承诺 —')
{
  const state = makeState()
  const morning = addThread(state, ['火星', '科幻', '小说'], { foreground: true })
  const evening = addThread(state, ['alpha', 'mainline', 'project'])
  openCommitment(state, { text: '晚上把 alpha 项目部署完', threadId: evening.id })
  // 前台仍是早上的线索（专注栈时代这里必然答错）
  ensureThreadState(state).foregroundId = morning.id

  assert(isIndexicalProgressQuery('干得怎么样了'), '"干得怎么样了"识别为指代性问询')
  const r = attributeUserMessage(state, '干得怎么样了？')
  assert(r.event === 'resumed' && r.thread === evening, '进度问询切回承诺线索（不是早上的前台）')
  assert(r.via === 'commitment', '路由途径 = commitment')
  assert(getForegroundThread(state) === evening, '前台指针移到承诺线索')
  assert(r.switchedFrom === morning, '旧前台作为 switchedFrom 交给摘要器')

  // 明示压过暗示：进度句式但显式点名另一条线索（重叠≥2）→ 不抢路由
  const r2 = attributeUserMessage(state, '火星 科幻 那个故事进展如何了')
  assert(r2.thread !== evening, '显式点名其他线索时进度路由让位')
}

console.log('— Bug3 回归：单关键词不误切换 —')
{
  const state = makeState()
  const old = addThread(state, ['项目', '部署', '配置'], { lastEventAgoMs: 3600 * 1000 })
  addThread(state, ['现在', '聊天', '随便'], { foreground: true })
  // 与 old 仅"项目"一个词重叠 → 不应切换
  const r = attributeUserMessage(state, '新项目 newunique freshwords 方案讨论一下')
  assert(r.event === 'created', '重叠=1 → 新建线索而不是切换')
  assert(r.ambiguousWith === old, '弱信号候选交给分类器仲裁（ambiguousWith）')
  assert(getForegroundThread(state) === r.thread, '新线索置前台')

  // 重叠 ≥2 → 才允许切换
  const state2 = makeState()
  const target = addThread(state2, ['alpha', 'mainline', 'project'], { lastEventAgoMs: 3600 * 1000 })
  addThread(state2, ['当前', '闲聊', '话题'], { foreground: true })
  const r2 = attributeUserMessage(state2, '回到 alpha mainline 那个事接着弄')
  assert(r2.event === 'resumed' && r2.thread === target, '重叠≥2 → resumed 切换')
}

console.log('— Bug2 衍生：冷前台不被短消息续命 —')
{
  const state = makeState()
  const stale = addThread(state, ['古老', '话题', '词组'], { foreground: true, lastEventAgoMs: COOL_WINDOW_MS + 3600 * 1000 })
  const r = attributeUserMessage(state, '嗯嗯好的呢')
  assert(r.event === 'noop', '关键词稀薄短消息不给 cold 前台续命')
  assert(stale.hitCount === 1, '冷前台 hitCount 未被刷新')
}

console.log('— 并发承诺：按 id 精确关闭 + 路由 —')
{
  const state = makeState()
  const ta = addThread(state, ['任务A', '编程', '动画'])
  const tb = addThread(state, ['任务B', '调研', '报告'], { foreground: true })
  const ca = openCommitment(state, { text: '做完动画项目', threadId: ta.id })
  const cb = openCommitment(state, { text: '写完调研报告', threadId: tb.id })
  // 单任务槽位场景：任务 B 完成，必须只关 B 的承诺（不带 id 的旧行为会误关最老的 A）
  const closed = closeCommitment(state, { commitmentId: cb.id, status: 'done' })
  assert(closed === cb, '按 id 关闭命中 B')
  assert(ca.status === 'open', 'A 的承诺不被误关（单任务槽位下的旧 bug）')
  assert(latestOpenCommitment(state) === ca, '此后指代性问询路由回 A（唯一开放承诺）')
  // 两个都开着时：latestOpenCommitment 取最新（"咋样了"默认指最近布置的事）
  const cb2 = openCommitment(state, { text: '再做一个 B2', threadId: tb.id })
  assert(latestOpenCommitment(state) === cb2, '多承诺并存时取最新创建的')
}

console.log('— 合并修正（分类器判 same 后） —')
{
  const state = makeState()
  const a = addThread(state, ['alpha', 'project'], { conclusions: ['我完成了部署'] })
  const b = addThread(state, ['alpha', 'deploy'], { foreground: true, conclusions: ['我修好了配置'] })
  openCommitment(state, { text: '完成 alpha', threadId: b.id })
  const merged = mergeThreads(state, b.id, a.id)
  assert(merged === a, 'mergeThreads 返回目标线索')
  assert(ensureThreadState(state).threads.length === 1, '合并后只剩一条线索')
  assert(a.conclusions.includes('我修好了配置'), '结论合并保留')
  assert(latestOpenCommitment(state).threadId === a.id, '承诺过户到目标线索')
  assert(ensureThreadState(state).foregroundId === a.id, '前台指针跟随合并')
}

console.log('— 读时减法：buildThreadView —')
{
  const state = makeState()
  const fg = addThread(state, ['当前', '工作', '主线'], { foreground: true })
  openCommitment(state, { text: '把主线做完', threadId: fg.id })
  addThread(state, ['温暖', '近期', '话题'], { lastEventAgoMs: 60 * 1000, conclusions: ['我聊过这个'] })
  addThread(state, ['凉了', '昨天', '话题'], { lastEventAgoMs: WARM_WINDOW_MS + 3600 * 1000 })
  addThread(state, ['冷掉', '上周', '话题'], { lastEventAgoMs: COOL_WINDOW_MS + 3600 * 1000 })
  for (let i = 0; i < MAX_WARM_INJECTED + 2; i++) {
    addThread(state, [`warm${i}a`, `warm${i}b`], { lastEventAgoMs: (i + 2) * 60 * 1000, conclusions: [`结论${i}`] })
  }
  const view = buildThreadView(state)
  assert(view.foreground === fg, 'view.foreground = 前台线索')
  assert(view.foregroundCommitment?.text === '把主线做完', 'view 带前台开放承诺')
  assert(view.background.length === MAX_WARM_INJECTED, `warm 注入配额 = ${MAX_WARM_INJECTED}（少即是强约束注入结果）`)
  assert(view.background.every(x => x.temperature === 'warm'), 'cool/cold 不进注入视图')
  // 自愈性：把凉线索"拾起"（模拟用户重提）后再算，立刻回到视图
  const coolThread = ensureThreadState(state).threads.find(t => t.topic[0] === '凉了')
  coolThread.lastEventAt = new Date().toISOString()
  const view2 = buildThreadView(state)
  assert(view2.background.some(x => x.thread === coolThread), '温度读时重算：重新活跃立刻回到视图（无需任何恢复动作）')
}

console.log('— focusStack 迁移 —')
{
  const legacy = [
    { topic: ['早上', '项目'], startedAt: '2026-06-10T08:00:00Z', lastSeenTick: 5, hitCount: 4, conclusions: ['我早上完成了初版'] },
    { topic: ['晚上', '任务'], startedAt: '2026-06-10T20:00:00Z', lastSeenTick: 30, hitCount: 2, conclusions: [] },
  ]
  const migrated = migrateFocusStackToThreads(legacy)
  assert(migrated.threads.length === 2, '两帧 → 两线索')
  assert(migrated.foregroundId === migrated.threads[1].id, '栈顶 = 前台')
  assert(migrated.threads[0].conclusions[0] === '我早上完成了初版', 'conclusions 保留')
  assert(migrated.commitments.length === 0, '旧模型无承诺概念，迁移为空')
}

console.log('— 摘要器输入（纯函数） —')
{
  const t = makeThread(['alpha', 'project'])
  t.summary = '我已部署了第一版'
  const input = buildSummarizeInput(t, {
    conversations: [
      { from_id: 'user', to_id: 'jarvis', timestamp: '2026-06-10T21:00:00Z', content: '部署到测试环境' },
      { from_id: 'jarvis', to_id: 'user', timestamp: '2026-06-10T21:01:00Z', content: '好，我来弄' },
    ],
    actionLogs: [{ timestamp: '2026-06-10T21:02:00Z', tool: 'exec_command', summary: 'deploy to staging', status: 'ok' }],
  })
  assert(input.includes('[Previous summary — do not restate] 我已部署了第一版'), '增量摘要带上一版摘要')
  assert(input.includes('user -> You'), '对话行带方向标')
  assert(input.includes('exec_command'), '工具调用入摘要输入')
}

console.log('— prompt 渲染：<thread> / <threads-background> —')
{
  const state = makeState()
  const fg = addThread(state, ['alpha', 'project'], { foreground: true })
  fg.label = 'alpha 部署'
  fg.summary = '我已部署了第一版'
  openCommitment(state, { text: '把 alpha 项目部署完', threadId: fg.id })
  addThread(state, ['火星', '科幻'], { lastEventAgoMs: 60 * 1000, conclusions: ['用户提议写火星故事，我列了大纲'] })

  const ctx = buildContextBlock({ threadView: buildThreadView(state) })
  assert(ctx.includes('<thread topic="alpha 部署"'), '<thread> 用 label 作 topic')
  assert(ctx.includes('Open commitment'), '前台带开放承诺行')
  assert(ctx.includes('把 alpha 项目部署完'), '承诺文本注入')
  assert(ctx.includes('report on it'), '进度问询指向承诺的指令在')
  assert(ctx.includes('<threads-background>'), '后台线索段在')
  assert(ctx.includes('火星'), '后台线索结论/关键词可见')

  // 遗留路径：threadView 缺省时 focusStack 渲染照旧（旧测试兼容）
  const legacyCtx = buildContextBlock({
    focusStack: [{ topic: ['legacy', 'topic'], startedAtTick: 1, lastSeenTick: 2, hitCount: 3, conclusions: [] }],
    focusTickCounter: 3,
  })
  assert(legacyCtx.includes('<focus topic="legacy, topic"'), '遗留 focusStack 渲染保持')
}

console.log('— 杂项 —')
{
  assert(isLikelyOneOffLeaf('今天天气怎么样'), '天气句识别为叶子')
  assert(!isLikelyOneOffLeaf('帮我修复项目里的部署脚本'), '实质任务不是叶子')
  assert(!isIndexicalProgressQuery('帮我写一篇五千字的长文章把这个问题展开讲讲清楚，从历史背景开始一直讲到现在的最新进展'), '长文请求不是指代性问询')
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILURE(S)`)
