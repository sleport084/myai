// wechat-tools.js — 微信 UI Agent 工具层(P2)
// 把 wechat-ui.swift helper 包装成 AI 可调用的工具:
// wechat_snapshot(截图+AX树) / wechat_click / wechat_type / wechat_read(读当前聊天)
// 安全策略: 高危操作(不在本层,点击坐标即用户/AI决策) — 与 Chrome MCP 同模式
import { execFile } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { emitEvent } from '../../events.js'
import { paths } from '../../paths.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SWIFT_HELPER = path.join(__dirname, '..', '..', 'wechat', 'wechat-ui.swift')
const IS_MAC = process.platform === 'darwin'

// swift 解释执行(开发/打包后都可用, asar 内 .swift 会被 unpack)
function runHelper(args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (!IS_MAC) return resolve({ ok: false, error: 'wechat UI 工具目前仅支持 macOS (Windows 适配在 P4)' })
    execFile('swift', [SWIFT_HELPER, ...args], { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        // stdout 最后一行是 JSON
        const lines = String(stdout || '').trim().split('\n').filter(Boolean)
        for (let i = lines.length - 1; i >= 0; i--) {
          try { return resolve(JSON.parse(lines[i])) } catch {}
        }
        resolve({ ok: false, error: (err?.message || stderr || 'helper 无输出').slice(0, 200) })
      })
  })
}

// ── wechat_snapshot: 截图 + AX 树 → AI 视觉理解用 ──
export async function execWechatSnapshot(args = {}) {
  const depth = Math.min(Math.max(parseInt(args.depth) || 7, 1), 15)
  // 1. 确保微信前台(截屏质量 + AX 可读)
  const act = await runHelper(['activate'], 8000)
  if (!act.ok) return JSON.stringify({ ok: false, tool: 'wechat_snapshot', error: act.error, hint: '微信可能未运行。告诉用户先打开微信。' })
  // 2. AX 树(结构化)
  const tree = await runHelper(['tree', String(depth)], 20000)
  // 3. 截图(视觉)
  const fname = `wechat_snap_${Date.now()}.png`
  const fpath = path.join(paths.sandboxDir, 'media', 'wechat', fname)
  const fs = await import('fs')
  fs.mkdirSync(path.dirname(fpath), { recursive: true })
  const shot = await runHelper(['screenshot', fpath], 20000)

  emitEvent('action', { tool: 'wechat_snapshot', summary: '微信界面快照', detail: shot.ok ? fpath : shot.error })
  emitEvent('wechat_snapshot', { url: `/media/wechat/${fname}`, tree_ok: !!tree.ok })

  const treeSummary = tree.ok
    ? countTreeNodes(tree.tree) + ' 个元素(深度' + depth + ')'
    : 'AX 树不可用: ' + (tree.error || '').slice(0, 60)

  return JSON.stringify({
    ok: shot.ok || tree.ok,
    tool: 'wechat_snapshot',
    screenshot: shot.ok ? `/media/wechat/${fname}` : null,
    screenshot_note: shot.ok ? '截图已生成, 可配合 vision/analyze_image 或直接观察理解界面' : shot.error,
    ax_tree: tree.ok ? tree.tree : null,
    ax_tree_summary: treeSummary,
    hint: '截图路径在 screenshot 字段; AX 树含控件 name/role/frame(屏幕坐标), 点击用 wechat_click 传中心坐标',
  })
}

function countTreeNodes(node) {
  if (!node || typeof node !== 'object') return 0
  let n = 1
  for (const c of node.children || []) n += countTreeNodes(c)
  return n
}

// ── wechat_click: 点击坐标(拟人移动) ──
export async function execWechatClick(args = {}) {
  const x = parseFloat(args.x ?? args.X)
  const y = parseFloat(args.y ?? args.Y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    // 支持语义: 从 AX 树里找 name 匹配的元素点中心
    const name = String(args.name || args.element || '').trim()
    if (!name) return JSON.stringify({ ok: false, tool: 'wechat_click', error: '需要 x/y 坐标或 name(元素名)' })
    const found = await findElementCenter(name)
    if (!found) return JSON.stringify({ ok: false, tool: 'wechat_click', error: `AX 树中未找到名为「${name}」的元素`, hint: '先 wechat_snapshot 看界面结构' })
    return doClick(found.x, found.y, args.double, name)
  }
  return doClick(x, y, args.double)
}

async function doClick(x, y, dbl, name) {
  const clickArgs = ['click', String(Math.round(x)), String(Math.round(y))]
  if (dbl) clickArgs.push('double')
  const r = await runHelper(clickArgs)
  emitEvent('action', { tool: 'wechat_click', summary: `点击微信 ${Math.round(x)},${Math.round(y)}${name ? '(' + name + ')' : ''}` })
  return JSON.stringify({ ok: r.ok, tool: 'wechat_click', clicked: [Math.round(x), Math.round(y)], ...(name ? { name } : {}), ...(r.ok ? {} : { error: r.error }) })
}

// 在 AX 树里按 name 找元素中心(递归)
async function findElementCenter(name) {
  const tree = await runHelper(['tree', '12'], 20000)
  if (!tree.ok) return null
  const target = String(name).toLowerCase()
  const found = searchTree(tree.tree, target)
  return found
}
function searchTree(node, target) {
  if (!node || typeof node !== 'object') return null
  const n = String(node.name || node.desc || '').toLowerCase()
  if (n && (n === target || n.includes(target))) {
    const f = node.frame
    if (f) return { x: f.x + f.w / 2, y: f.y + f.h / 2 }
  }
  for (const c of node.children || []) {
    const r = searchTree(c, target)
    if (r) return r
  }
  return null
}

// ── wechat_type: 输入文本(Unicode 直写绕过输入法) ──
export async function execWechatType(args = {}) {
  const text = String(args.text ?? args.content ?? '').slice(0, 5000)
  if (!text) return JSON.stringify({ ok: false, tool: 'wechat_type', error: '需要 text' })
  // 可选: 先点击输入框
  if (args.click_x != null && args.click_y != null) {
    await runHelper(['click', String(args.click_x), String(args.click_y)])
    await sleep(200)
  }
  const r = await runHelper(['type', text], 60000)
  // 可选: 回车发送
  if (r.ok && args.enter) {
    await sleep(300)
    await runHelper(['key', 'return'])
  }
  emitEvent('action', { tool: 'wechat_type', summary: `微信输入 ${text.length} 字${args.enter ? '+回车' : ''}`, detail: text.slice(0, 40) })
  return JSON.stringify({ ok: r.ok, tool: 'wechat_type', typed_chars: text.length, sent: !!args.enter, ...(r.ok ? {} : { error: r.error }) })
}

// ── wechat_key: 按键 ──
export async function execWechatKey(args = {}) {
  const key = String(args.key || '').trim()
  const valid = ['return', 'enter', 'tab', 'esc', 'escape', 'space', 'delete', 'up', 'down', 'left', 'right']
  if (!valid.includes(key)) return JSON.stringify({ ok: false, error: `key 须为: ${valid.join('/')}` })
  const r = await runHelper(['key', key])
  return JSON.stringify({ ok: r.ok, tool: 'wechat_key', key })
}

// ── wechat_find: 找窗口信息 ──
export async function execWechatFind() {
  const r = await runHelper(['find'])
  return JSON.stringify({ ok: r.ok, tool: 'wechat_find', window: r.window || null, ...(r.ok ? {} : { error: r.error, hint: '微信未运行或主窗未开' }) })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
