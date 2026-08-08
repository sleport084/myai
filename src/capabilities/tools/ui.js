import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { insertMemory } from '../../db.js'
import { emitEvent, emitUICommand, emitACUIEvent, hasACUIClient, addActiveUICard, removeActiveUICard, getActiveUICards } from '../../events.js'
import { SANDBOX_ROOT, isPathInside } from '../sandbox.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// inline-script draft registry (memory + disk fallback).
const draftCodeMap = new Map()   // { scratchId -> code }
const appIdToName  = new Map()   // { scratchId -> appName }
const DRAFT_CODE_MAP_MAX = 50    // Evict the oldest entry after this limit.
function addDraftCode(id, code) {
  if (draftCodeMap.size >= DRAFT_CODE_MAP_MAX) {
    draftCodeMap.delete(draftCodeMap.keys().next().value)
  }
  draftCodeMap.set(id, code)
}

// Called by api.js to persist app:saveState payloads.
export function persistAppState(componentId, state) {
  const name = appIdToName.get(componentId)
  if (!name) return false
  try {
    const statePath = path.resolve(SANDBOX_ROOT, 'apps', name, 'state.json')
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8')
    return true
  } catch { return false }
}

const ACUI_COMPONENTS_PATH = path.resolve(__dirname, '..', 'ui-components.json')
const ACUI_REGISTRY_PATH   = path.resolve(__dirname, '..', '..', 'ui', 'brain-ui', 'acui', 'registry.js')
const ACUI_COMPONENTS_DIR  = path.resolve(__dirname, '..', '..', 'ui', 'brain-ui', 'acui', 'components')

let _acuiComponentsCache = null
function loadACUIComponents() {
  if (!_acuiComponentsCache) {
    _acuiComponentsCache = JSON.parse(fs.readFileSync(ACUI_COMPONENTS_PATH, 'utf-8'))
  }
  return _acuiComponentsCache
}
function invalidateACUIComponentsCache() { _acuiComponentsCache = null }

// 校验并就地容错：number-like 字符串自动转 number，避免 LLM 把 "18" 当 18 传过来时硬挂。
function validateProps(propsSchema, props) {
  if (!props || typeof props !== 'object') return null
  for (const [name, spec] of Object.entries(propsSchema)) {
    let v = props[name]
    if (spec.required && (v === undefined || v === null)) {
      return `字段 ${name} 必填`
    }
    if (v === undefined || v === null) continue
    const t = spec.type
    if (t === 'number' && typeof v !== 'number') {
      // 容错：LLM 经常把数字当字符串传（"18"、"23.5"）。是合法 number-like 字符串就转一下。
      if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) {
        props[name] = Number(v)
        continue
      }
      return `字段 ${name} 必须为 number`
    }
    if (t === 'string' && typeof v !== 'string') return `字段 ${name} 必须为 string`
    if (t === 'array'  && !Array.isArray(v))    return `字段 ${name} 必须为 array`
    if (t === 'object' && (typeof v !== 'object' || Array.isArray(v))) return `字段 ${name} 必须为 object`
    if (t === 'boolean' && typeof v !== 'boolean') return `字段 ${name} 必须为 boolean`
  }
  return null
}

// 合并 LLM 给的 hint 和组件 propsSchema 默认值，按 placement 推断动画/拖动/遮罩默认。
function mergeHint(hint, def) {
  const h = hint && typeof hint === 'object' ? hint : {}
  const placement = ['notification', 'center', 'floating', 'stage'].includes(h.placement)
    ? h.placement
    : (def?.placement || 'notification')

  const enterDefaults = { notification: 'slide-from-right', center: 'scale-up', floating: 'fade-up', stage: 'stage-up' }
  const exitDefaults  = { notification: 'slide-to-right',   center: 'scale-down', floating: 'fade-down', stage: 'stage-down' }

  const draggable = typeof h.draggable === 'boolean' ? h.draggable
    : (typeof def?.draggable === 'boolean' ? def.draggable : (placement === 'floating'))
  const modal = typeof h.modal === 'boolean' ? h.modal
    : (typeof def?.modal === 'boolean' ? def.modal : (placement === 'center' || placement === 'stage'))

  const size = h.size ?? def?.size ?? 'md'

  // def.enter/exit 只在 placement=notification 时生效；切换到 center/floating/stage
  // 组件原来的 slide-from-right 就不合适了，按 placement 默认动画走。
  const usesDefAnim = placement === 'notification'
  return {
    placement,
    size,
    draggable,
    modal,
    enter: h.enter || (usesDefAnim ? def?.enter : null) || enterDefaults[placement],
    exit:  h.exit  || (usesDefAnim ? def?.exit  : null) || exitDefaults[placement],
  }
}

function defaultInlineHint(hint) {
  return mergeHint(hint, {
    placement: 'notification',
    size: 'md',
    enter: 'slide-from-right',
    exit: 'slide-to-right',
  })
}

function stripModuleSyntax(code) {
  return code
    .replace(/^\s*import\s[^\n]*\n/gm, '')
    .replace(/^\s*export\s+default\s+/gm, 'return ')
    .replace(/^\s*export\s*\{[^}]*\}[^\n]*\n/gm, '')
    .replace(/^\s*export\s+/gm, '')
}

function validateInlineScript(code) {
  if (!code || typeof code !== 'string') return '错误：code 必填字符串'
  if (!/export\s+default\s+class\s+extends\s+HTMLElement\b/.test(code)) {
    return '错误：code 必须包含 export default class extends HTMLElement'
  }
  try {
    new Function(stripModuleSyntax(code))
  } catch (e) {
    return `错误：代码语法预检失败 — ${e.message}`
  }
  return null
}

function execUIShowInline({ mode, template, styles, code, props, hint }) {
  if (mode === 'inline-template') {
    if (!template || typeof template !== 'string') return '错误：template 必填字符串'
    if (!hasACUIClient()) return '错误：当前没有 UI 客户端连接，请改用文字回答'
    const id = `scratch-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
    emitUICommand({
      op: 'mount',
      id,
      mode,
      template,
      styles,
      props: props || {},
      hint: defaultInlineHint(hint),
    })
    addActiveUICard(id, { component: mode })
    emitEvent('action', { tool: 'ui_show', summary: '推送 inline-template', detail: id })
    return JSON.stringify({ ok: true, id, mode })
  }

  if (mode === 'inline-script') {
    const err = validateInlineScript(code)
    if (err) return err
    if (!hasACUIClient()) return '错误：当前没有 UI 客户端连接，请改用文字回答'
    const id = `scratch-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
    const draftsRoot = path.resolve(SANDBOX_ROOT, 'apps', '.drafts')
    fs.mkdirSync(draftsRoot, { recursive: true })
    fs.writeFileSync(path.resolve(draftsRoot, `${id}.js`), code, 'utf-8')
    addDraftCode(id, code)
    emitUICommand({
      op: 'mount',
      id,
      mode,
      code,
      props: props || {},
      hint: defaultInlineHint(hint),
    })
    addActiveUICard(id, { component: mode })
    emitEvent('action', { tool: 'ui_show', summary: '推送 inline-script', detail: id })
    return JSON.stringify({ ok: true, id, mode })
  }

  return `错误：未知 mode "${mode}"`
}

export function execUIShow({ component, props, hint, mode, template, styles, code }) {
  if (mode) return execUIShowInline({ mode, template, styles, code, props, hint })
  console.log(`[ui_show] component=${component} props=${JSON.stringify(props)}`)
  if (!component) return '错误：未提供 component 或 mode'
  const components = loadACUIComponents()
  const def = components[component]
  if (!def) return `错误：组件 "${component}" 未注册（可用：${Object.keys(components).join(', ') || '无'}）`

  const propsErr = validateProps(def.propsSchema, props || {})
  if (propsErr) return `错误：props 校验失败 — ${propsErr}（实际 props=${JSON.stringify(props)}）`

  if (!hasACUIClient()) return '错误：当前没有 UI 客户端连接，请改用文字回答'

  // 单例组件：显示新卡前先关掉同类旧卡，避免动画重叠出现"两种"
  const SINGLETON_COMPONENTS = new Set(['SelfCheckStepCard'])
  if (SINGLETON_COMPONENTS.has(component)) {
    const existing = getActiveUICards().filter(c => c.component === component)
    for (const old of existing) {
      emitUICommand({ op: 'unmount', id: old.id })
      removeActiveUICard(old.id)
    }
  }

  const id = `${component.toLowerCase()}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
  emitUICommand({
    op: 'mount',
    id,
    component,
    props,
    hint: mergeHint(hint, def),
  })
  addActiveUICard(id, { component })
  emitEvent('action', { tool: 'ui_show', summary: `推送 ${component}`, detail: id })
  return JSON.stringify({ ok: true, id })
}

export function execUIHide({ id }) {
  if (!id) return '错误：未提供 id'
  if (!getActiveUICards().find(c => c.id === id)) return `错误：卡片 "${id}" 不存在或已关闭`
  if (!hasACUIClient()) return '错误：当前没有 UI 客户端连接'
  emitUICommand({ op: 'unmount', id })
  removeActiveUICard(id)
  emitEvent('action', { tool: 'ui_hide', summary: `关闭卡片`, detail: id })
  return JSON.stringify({ ok: true, id })
}

export function execUIUpdate({ id, props }) {
  if (!id) return '错误：未提供 id'
  if (!props || typeof props !== 'object' || Array.isArray(props)) return '错误：props 必须为对象'
  const card = getActiveUICards().find(c => c.id === id)
  if (!card) return `错误：卡片 "${id}" 不存在或已关闭`
  if (card.component) {
    const def = loadACUIComponents()[card.component]
    if (def) {
      const propsErr = validateProps(def.propsSchema, props)
      if (propsErr) return `错误：props 校验失败 — ${propsErr}`
    }
  }
  if (!hasACUIClient()) return '错误：当前没有 UI 客户端连接'
  emitUICommand({ op: 'update', id, props })
  emitEvent('action', { tool: 'ui_update', summary: `更新卡片`, detail: id })
  return JSON.stringify({ ok: true, id })
}


export function execUIPatch({ id, op, data }) {
  if (!id) return '错误：未提供 id'
  if (!op) return '错误：未提供 op'
  if (!getActiveUICards().find(c => c.id === id)) return `错误：卡片 "${id}" 不存在或已关闭`
  if (!hasACUIClient()) return '错误：当前没有 UI 客户端连接'
  emitUICommand({ op: 'patch', id, patchOp: op, data: data || {} })
  emitEvent('action', { tool: 'ui_patch', summary: `应用补丁 ${op}`, detail: id })
  return JSON.stringify({ ok: true, id, op })
}

export function execManageApp({ action, name, label, draft_id, state, hint }) {
  const appsRoot = path.resolve(SANDBOX_ROOT, 'apps')

  if (action === 'save') {
    if (!name) return '错误：save 操作必须提供 name'
    if (!draft_id) return '错误：save 操作必须提供 draft_id'
    // 从内存或草稿文件取代码
    let code = draftCodeMap.get(draft_id)
    if (!code) {
      const draftPath = path.resolve(appsRoot, '.drafts', `${draft_id}.js`)
      if (!fs.existsSync(draftPath)) return `错误：找不到草稿 ${draft_id}，请确认 draft_id 是 ui_show(mode="inline-script") 返回的 id`
      code = fs.readFileSync(draftPath, 'utf-8')
    }
    const appDir = path.resolve(appsRoot, name)
    fs.mkdirSync(appDir, { recursive: true })
    // 版本备份（若已有同名应用）
    const componentPath = path.resolve(appDir, 'component.js')
    const metaPath = path.resolve(appDir, 'meta.json')
    let newVersion = 1
    if (fs.existsSync(componentPath) && fs.existsSync(metaPath)) {
      try {
        const oldMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        const v = oldMeta.version || 1
        fs.copyFileSync(componentPath, path.resolve(appDir, `component.v${v}.js`))
        newVersion = v + 1
      } catch (_) {}
    }
    const meta = {
      name, label: label || name,
      created_at: new Date().toISOString(),
      last_used: new Date().toISOString(),
      version: newVersion,
      draft_id,
      hint: hint || { placement: 'floating', size: 'lg' },
    }
    fs.writeFileSync(componentPath, code, 'utf-8')
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    if (state) fs.writeFileSync(path.resolve(appDir, 'state.json'), JSON.stringify(state, null, 2), 'utf-8')
    appIdToName.set(draft_id, name)
    draftCodeMap.delete(draft_id)
    emitEvent('action', { tool: 'manage_app', summary: `保存应用 ${name}`, detail: draft_id })
    return JSON.stringify({ ok: true, name, path: `sandbox/apps/${name}/` })
  }

  if (action === 'open') {
    if (!name) return '错误：open 操作必须提供 name'
    const appDir = path.resolve(appsRoot, name)
    if (!fs.existsSync(appDir)) return `错误：应用 "${name}" 不存在，请先 save`
    const code = fs.readFileSync(path.resolve(appDir, 'component.js'), 'utf-8')
    const meta = JSON.parse(fs.readFileSync(path.resolve(appDir, 'meta.json'), 'utf-8'))
    let savedState = {}
    const statePath = path.resolve(appDir, 'state.json')
    if (!state && fs.existsSync(statePath)) {
      savedState = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    }
    const props = state || savedState
    const mountHint = hint || meta.hint || { placement: 'floating', size: 'lg' }
    const result = execUIShowInline({ mode: 'inline-script', code, props, hint: mountHint })
    try {
      const parsed = JSON.parse(result)
      if (parsed.ok) {
        appIdToName.set(parsed.id, name)
        meta.last_used = new Date().toISOString()
        fs.writeFileSync(path.resolve(appDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')
      }
    } catch (e) { console.warn(`[manage_app open] 解析挂载结果失败：${e.message}`) }
    emitEvent('action', { tool: 'manage_app', summary: `打开应用 ${name}`, detail: name })
    return result
  }

  if (action === 'list') {
    if (!fs.existsSync(appsRoot)) return JSON.stringify({ ok: true, apps: [] })
    const apps = fs.readdirSync(appsRoot, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== '.drafts')
      .map(d => {
        try { return JSON.parse(fs.readFileSync(path.resolve(appsRoot, d.name, 'meta.json'), 'utf-8')) }
        catch { return { name: d.name } }
      })
    return JSON.stringify({ ok: true, apps })
  }

  if (action === 'delete') {
    if (!name) return '错误：delete 操作必须提供 name'
    const appDir = path.resolve(appsRoot, name)
    if (!fs.existsSync(appDir)) return `错误：应用 "${name}" 不存在`
    fs.rmSync(appDir, { recursive: true })
    emitEvent('action', { tool: 'manage_app', summary: `删除应用 ${name}`, detail: name })
    return JSON.stringify({ ok: true, name, deleted: true })
  }

  return `错误：未知 action "${action}"，可用：save / open / list / delete`
}

function isPascalCase(name) { return /^[A-Z][A-Za-z0-9]*$/.test(name) }
function pascalToKebab(name) { return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase() }

const RESERVED_COMPONENT_NAMES = new Set(['Inline', 'System', 'Base', 'Test'])

export function execUIRegister({ component_name, code, props_schema, use_case, example_call }) {
  if (!component_name || !isPascalCase(component_name)) return '错误：component_name 必须为 PascalCase（如 TodoCard）'
  if (RESERVED_COMPONENT_NAMES.has(component_name)) return `错误：component_name "${component_name}" 是保留名`
  if (!code || typeof code !== 'string') return '错误：code 必填字符串'
  if (!props_schema || typeof props_schema !== 'object' || Array.isArray(props_schema)) return '错误：props_schema 必须为对象'
  if (!use_case || typeof use_case !== 'string') return '错误：use_case 必填'
  if (!example_call || typeof example_call !== 'string') return '错误：example_call 必填'

  // code 必须含 customElements.define & static tagName
  if (!/customElements\s*\.\s*define/.test(code)) return '错误：code 必须以 customElements.define(...) 注册收尾'
  if (!/static\s+tagName\s*=\s*['"`]/.test(code)) return '错误：code 必须含 static tagName = "acui-..."'

  // 占用检查
  const components = loadACUIComponents()
  if (components[component_name]) return `错误：组件名 "${component_name}" 已存在`

  // 语法预检：剥离顶层 import / export 行（new Function 不接受 module 语法）
  try {
    const stripped = code
      .replace(/^\s*import\s[^\n]*\n/gm, '')
      .replace(/^\s*export\s+default\s+/gm, '')
      .replace(/^\s*export\s*\{[^}]*\}[^\n]*\n/gm, '')
      .replace(/^\s*export\s+/gm, '')
    new Function(stripped)
  } catch (e) {
    return `错误：代码语法预检失败 — ${e.message}`
  }

  const kebab = pascalToKebab(component_name)
  const filePath = path.join(ACUI_COMPONENTS_DIR, `${kebab}.js`)

  // 文件名必须严格 kebab-case，且只能写入 components 目录内
  const resolved = path.resolve(filePath)
  if (!isPathInside(ACUI_COMPONENTS_DIR, resolved)) return '错误：目标路径越界'
  if (fs.existsSync(resolved)) return `错误：目标文件已存在：${kebab}.js`

  // 写组件文件
  fs.writeFileSync(resolved, code, 'utf-8')

  // 改 registry.js：在 import 区追加，COMPONENTS 对象内追加键
  let registry = fs.readFileSync(ACUI_REGISTRY_PATH, 'utf-8')
  const importLine = `import { ${component_name} } from './components/${kebab}.js'`
  if (!registry.includes(importLine)) {
    // 在最后一个 import 后追加
    registry = registry.replace(/((?:^import .*\n)+)/m, (m) => m + importLine + '\n')
  }
  // 在 COMPONENTS 对象里追加键
  if (!new RegExp(`\\b${component_name}\\s*[,}]`).test(registry)) {
    registry = registry.replace(/export const COMPONENTS = \{([\s\S]*?)\}/, (m, body) => {
      const trimmed = body.replace(/\s+$/, '')
      const sep = trimmed.endsWith(',') || trimmed === '' ? '' : ','
      return `export const COMPONENTS = {${trimmed}${sep}\n  ${component_name},\n}`
    })
  }
  fs.writeFileSync(ACUI_REGISTRY_PATH, registry, 'utf-8')

  // 改 ui-components.json
  components[component_name] = {
    propsSchema: props_schema,
    enter: 'slide-from-right',
    exit:  'slide-to-right',
  }
  fs.writeFileSync(ACUI_COMPONENTS_PATH, JSON.stringify(components, null, 2), 'utf-8')
  invalidateACUIComponentsCache()

  // seed skill.ui 记忆
  const skillContent = `[Skill UI] ${component_name}\nUse case: ${use_case}\nExample call: ${example_call}`
  try {
    insertMemory({
      mem_id: `skill-ui-${kebab}`,
      type: 'skill',
      content: skillContent,
      detail: skillContent,
      title: `UI component: ${component_name}`,
      tags: ['skill.ui', `component:${component_name}`],
      entities: [],
      timestamp: new Date().toISOString(),
    })
  } catch (e) {
    console.warn(`[ui_register] 写技能记忆失败：${e.message}（组件已注册成功）`)
  }

  // 通知前端热重载 registry
  emitACUIEvent('acui:reload', { component_name })

  emitEvent('action', { tool: 'ui_register', summary: `转正组件 ${component_name}`, detail: kebab })
  return JSON.stringify({ ok: true, component_name, file: `${kebab}.js` })
}

// ─────────────────────────────────────────────────────────────────────────────
// 任务管理工具（通过 context 回调通知 index.js）
