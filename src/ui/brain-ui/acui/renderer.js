// ACUI Renderer
// 三种执行模式：A 注册组件 / B 内联模板 / C 内联组件
// 优先级 A > B > C 由 Agent 在 prompt 里把握，前端只负责按 mode 路由。
// hint.placement 决定形态：notification（右上堆叠） / center（居中带遮罩） / floating（自由浮动可拖）

let COMPONENTS = {}

async function loadRegistry() {
  const url = `./registry.js?t=${Date.now()}`
  const mod = await import(url)
  COMPONENTS = mod.COMPONENTS || {}
}

const instances = new Map()

// 三个独立的 layer，分别承担三种 placement。client.js 传进来的 rootEl 用作 notification 层，
// 另外两层在 init 时自动挂到 document.body，互不干扰。
// 注意：只支持注册组件（Mode A），不支持 inline-template / inline-script。
let notificationHost = null
let centerHost = null
let floatingHost = null
let stageHost = null
let signalSink = null

// 全局 App 上下文注册表：{ [id]: { emit, onPatch } }
// 生成的组件在 connectedCallback 里通过 this._app = window.__acuiApps?.[this.id] 取到
window.__acuiApps = window.__acuiApps || {}

export async function initRenderer(rootEl, sink) {
  notificationHost = rootEl
  signalSink = sink

  centerHost = document.getElementById('acui-center-host')
  if (!centerHost) {
    centerHost = document.createElement('div')
    centerHost.id = 'acui-center-host'
    document.body.appendChild(centerHost)
  }

  floatingHost = document.getElementById('acui-floating-host')
  if (!floatingHost) {
    floatingHost = document.createElement('div')
    floatingHost.id = 'acui-floating-host'
    document.body.appendChild(floatingHost)
  }

  stageHost = document.getElementById('acui-stage-host')
  if (!stageHost) {
    stageHost = document.createElement('div')
    stageHost.id = 'acui-stage-host'
    document.body.appendChild(stageHost)
  }

  await loadRegistry()
}

export async function reloadRegistry() {
  try {
    await loadRegistry()
    console.log('[ACUI] registry 已热重载，可用组件：', Object.keys(COMPONENTS).join(', '))
  } catch (e) {
    console.warn('[ACUI] registry 重载失败：', e)
  }
}

export function mount(msg) {
  if (!notificationHost) return
  if (msg.mode === 'inline-template') return mountInlineTemplate(msg)
  if (msg.mode === 'inline-script') return mountInlineScript(msg)
  return mountRegistered(msg)
}

// ── 模式 A：注册组件 ──────────────────────────────────────────
function mountRegistered({ id, component, props, hint }) {
  const Cls = COMPONENTS[component]
  if (!Cls) {
    signalSink?.({ type: 'card.error', target: id, payload: { phase: 'mount', message: `unknown_component:${component}` } })
    return
  }

  const el = document.createElement(Cls.tagName)
  attachLifecycle(el, id, component, hint)
  el.props = props
  appendAndAnimate(el, id, component, hint)
}

// ── 模式 B：内联模板 ──────────────────────────────────────────
function mountInlineTemplate({ id, mode, template, styles, props, hint }) {
  const el = document.createElement('div')
  attachLifecycle(el, id, mode, hint)
  el.className = 'acui-inline-template'
  renderInlineTemplate(el, template, styles, props || {})
  appendAndAnimate(el, id, mode, hint)
  const inst = instances.get(id)
  if (inst) Object.assign(inst, { mode, template, styles, props: props || {} })
}

function renderInlineTemplate(el, template, styles, props) {
  const html = String(template || '').replace(/\$\{([^}]+)\}/g, (_, key) => {
    const value = props?.[String(key).trim()]
    if (Array.isArray(value)) return value.join('')
    return value ?? ''
  })
  const styleTag = styles ? `<style>${styles}</style>` : ''
  el.innerHTML = `${styleTag}${html}`
}

// ── 模式 C：内联组件 ──────────────────────────────────────────
async function mountInlineScript({ id, mode, code, props, hint }) {
  try {
    const blob = new Blob([code], { type: 'text/javascript' })
    const url = URL.createObjectURL(blob)
    let mod
    try {
      mod = await import(url)
    } finally {
      URL.revokeObjectURL(url)
    }

    const Cls = mod.default
    if (typeof Cls !== 'function' || !(Cls.prototype instanceof HTMLElement)) {
      signalSink?.({ type: 'card.error', target: id, payload: { phase: 'mount', message: 'invalid_inline_component' } })
      return
    }

    const tagName = `acui-inline-${String(id).replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`
    if (!customElements.get(tagName)) customElements.define(tagName, Cls)

    const el = document.createElement(tagName)
    attachLifecycle(el, id, mode, hint)
    el.props = props || {}
    appendAndAnimate(el, id, mode, hint)
    const inst = instances.get(id)
    if (inst) Object.assign(inst, { mode, code, props: props || {} })
  } catch (e) {
    console.warn('[ACUI] inline-script mount failed:', e)
    signalSink?.({ type: 'card.error', target: id, payload: { phase: 'mount', message: e.message } })
  }
}

// ── 公共：生命周期 + 入场 ─────────────────────────────────────
function attachLifecycle(el, id, component, hint) {
  el.id = id
  el.dataset.component = component

  const placement = hint?.placement || 'notification'
  el.dataset.placement = placement

  const defaultEnter = { center: 'scale-up', stage: 'stage-up', floating: 'fade-up' }
  const defaultExit  = { center: 'scale-down', stage: 'stage-down', floating: 'fade-down' }
  el.dataset.enter = hint?.enter || defaultEnter[placement] || 'slide-from-right'
  el.dataset.exit  = hint?.exit  || defaultExit[placement]  || 'slide-to-right'

  applySize(el, hint?.size)

  el.addEventListener('acui:dismiss', (e) => {
    unmount(id, e.detail?.by || 'unknown')
  })
  el.addEventListener('acui:action', (e) => {
    signalSink?.({ type: 'card.action', target: id, payload: e.detail || {} })
  })

  // 注册 App 上下文，供生成的组件在 connectedCallback 里通过
  // this._app = window.__acuiApps?.[this.id] 取到
  window.__acuiApps[id] = {
    emit(action, payload = {}) {
      signalSink?.({ type: 'card.action', target: id, payload: { action, payload } })
    },
    onPatch(handler) {
      document.addEventListener('acui:patch', (e) => {
        if (e.detail?.id === id) handler(e.detail)
      })
    },
  }
}

const SIZE_PRESETS = {
  sm: { w: 320 },
  md: { w: 420 },
  lg: { w: 600 },
  xl: { w: 820 },
}

function applySize(el, size) {
  let cfg = null
  if (typeof size === 'string' && SIZE_PRESETS[size]) cfg = SIZE_PRESETS[size]
  else if (size && typeof size === 'object') cfg = size

  if (!cfg) return
  if (cfg.w != null) el.style.width = typeof cfg.w === 'number' ? `${cfg.w}px` : cfg.w
  if (cfg.h != null) el.style.height = typeof cfg.h === 'number' ? `${cfg.h}px` : cfg.h
}

// 选哪个 host 容器；center 还要套一层 backdrop
function appendAndAnimate(el, id, component, hint) {
  const placement = hint?.placement || 'notification'
  let host = notificationHost
  let backdrop = null

  if (placement === 'center') {
    host = centerHost
    if (hint?.modal !== false) {
      backdrop = document.createElement('div')
      backdrop.className = 'acui-backdrop'
      backdrop.dataset.for = id
      backdrop.addEventListener('click', () => unmount(id, 'user'))
      centerHost.appendChild(backdrop)
    }
    centerHost.appendChild(el)
  } else if (placement === 'stage') {
    host = stageHost
    backdrop = document.createElement('div')
    backdrop.className = 'acui-backdrop acui-stage-backdrop'
    backdrop.dataset.for = id
    backdrop.addEventListener('click', () => unmount(id, 'user'))
    stageHost.appendChild(backdrop)
    stageHost.appendChild(el)
  } else if (placement === 'floating') {
    host = floatingHost
    floatingHost.appendChild(el)
    placeFloating(el)
    if (hint?.draggable !== false) makeDraggable(el)
  } else {
    notificationHost.appendChild(el)
  }

  instances.set(id, { el, component, mountedAt: Date.now(), backdrop, host })

  requestAnimationFrame(() => {
    el.classList.add('acui-enter-active')
    if (backdrop) backdrop.classList.add('acui-enter-active')
  })

  el.addEventListener('transitionend', () => {
    const preview = (el.shadowRoot?.textContent || el.textContent || '').trim().slice(0, 300)
    signalSink?.({ type: 'card.mounted', target: id, payload: { render_preview: preview } })
  }, { once: true })
}

let floatingOffset = 0
function placeFloating(el) {
  // 错开堆叠，避免新卡完全压在旧卡上
  const baseTop = 80
  const baseLeft = 120
  const step = 28
  el.style.position = 'absolute'
  el.style.top = `${baseTop + (floatingOffset % 6) * step}px`
  el.style.left = `${baseLeft + (floatingOffset % 6) * step}px`
  floatingOffset++
}

function makeDraggable(el) {
  // 用 mousedown 在卡片任意位置按下开始拖；按在交互元素上时不拖
  const NON_DRAG_TAGS = new Set(['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'OPTION', 'A', 'LABEL'])

  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    // composedPath 第一个目标若是表单元素则放过
    const path = e.composedPath ? e.composedPath() : [e.target]
    for (const node of path) {
      if (node === el) break
      if (node.nodeType === 1 && NON_DRAG_TAGS.has(node.tagName)) return
      if (node.nodeType === 1 && node.getAttribute && node.getAttribute('contenteditable') === 'true') return
    }

    const rect = el.getBoundingClientRect()
    const offsetX = e.clientX - rect.left
    const offsetY = e.clientY - rect.top
    const onMove = (ev) => {
      const x = Math.max(0, ev.clientX - offsetX)
      const y = Math.max(0, ev.clientY - offsetY)
      el.style.left = `${x}px`
      el.style.top  = `${y}px`
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      el.classList.remove('acui-dragging')
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    el.classList.add('acui-dragging')
    e.preventDefault()
  })
}

export function patch({ id, patchOp, data }) {
  document.dispatchEvent(new CustomEvent('acui:patch', {
    detail: { id, op: patchOp, data: data || {} }
  }))
}

export function update({ id, props }) {
  const inst = instances.get(id)
  if (!inst) return
  if (inst.mode === 'inline-template') {
    inst.props = { ...(inst.props || {}), ...props }
    renderInlineTemplate(inst.el, inst.template, inst.styles, inst.props)
    return
  }
  inst.el.props = { ...(inst.el.props || {}), ...props }
}

export function unmount(id, by = 'agent') {
  const inst = instances.get(id)
  if (!inst) return
  const dwell = Date.now() - inst.mountedAt
  inst.el.classList.add('acui-exit-active')
  inst.el.classList.remove('acui-enter-active')
  if (inst.backdrop) {
    inst.backdrop.classList.add('acui-exit-active')
    inst.backdrop.classList.remove('acui-enter-active')
  }

  const finalize = () => {
    if (inst.el.parentNode) inst.el.remove()
    if (inst.backdrop && inst.backdrop.parentNode) inst.backdrop.remove()
    instances.delete(id)
    signalSink?.({
      type: 'card.dismissed',
      target: id,
      payload: { by, dwell_ms: dwell }
    })
  }

  delete window.__acuiApps[id]

  let done = false
  const finalizeOnce = () => { if (!done) { done = true; finalize() } }
  inst.el.addEventListener('transitionend', finalizeOnce, { once: true })
  setTimeout(finalizeOnce, 400)
}
