// Windows: 把控制台代码页切到 UTF-8，避免中文 stdout 显示为乱码
if (process.platform === 'win32') {
  try {
    require('child_process').execSync('chcp 65001', { stdio: 'ignore', windowsHide: true })
  } catch (_) {}
}

const { app, BaseWindow, BrowserWindow, WebContentsView, View, webContents, session, shell, dialog, Menu, ipcMain, Tray, nativeImage, systemPreferences } = require('electron')
const path = require('path')
const fs = require('fs')
const net = require('net')
const http = require('http')
const { EventEmitter } = require('events')
const { pathToFileURL } = require('url')
const { autoUpdater } = require('electron-updater')
// 内置浏览器子系统(用系统 Chrome,不打包 Chromium)
const { BROWSER_EMBED_PARTITION, createBrowserEmbedHost } = require('./browser-embed-host.cjs')
const { createBrowserDataStore } = require('./browser-data.cjs')
const { createMyAIChromeManager } = require('./bailongma-chrome.cjs')
const { bundledBrowserRoot } = require('./playwright-runtime.cjs')

// 暴露 systemPreferences 给 src 层：macos-speech.js 需要它调 askForMediaAccess('microphone')
// 来申请 macOS 麦克风权限（TCC）。不注入的话本地 ASR 首次使用会因无权限而失败。
globalThis.bailongmaSystemPreferences = systemPreferences

const IS_DEV = !app.isPackaged
const WINDOWS_APP_USER_MODEL_ID = 'com.myai.app'
const USER_DIR = app.getPath('userData')
const CODE_ROOT = app.getAppPath()
const RESOURCE_ROOT = CODE_ROOT
const BACKEND_ENTRY = path.join(CODE_ROOT, 'src', 'index.js')

// 持久化日志：把 console.* 镜像到 USER_DIR/logs/myai.log，
// 安装版没有 stdout 的情况下，卡死/崩溃后还能 tail 这个文件复盘。
// 简易 rotate：> 5MB 时把当前文件改名 .old（覆盖上一份 .old），下次写入重开。
const LOG_DIR = path.join(USER_DIR, 'logs')
const LOG_FILE = path.join(LOG_DIR, 'myai.log')
const LOG_FILE_OLD = path.join(LOG_DIR, 'myai.old.log')
const LOG_MAX_BYTES = 5 * 1024 * 1024
try { fs.mkdirSync(LOG_DIR, { recursive: true }) } catch {}
function rotateLogIfNeeded() {
  try {
    const stat = fs.statSync(LOG_FILE)
    if (stat.size > LOG_MAX_BYTES) {
      try { fs.rmSync(LOG_FILE_OLD, { force: true }) } catch {}
      try { fs.renameSync(LOG_FILE, LOG_FILE_OLD) } catch {}
    }
  } catch {}
}
function writeLog(level, args) {
  let line
  try {
    line = args.map(a => {
      if (typeof a === 'string') return a
      if (a instanceof Error) return a.stack || a.message
      try { return JSON.stringify(a) } catch { return String(a) }
    }).join(' ')
  } catch { line = '[log-serialize-failed]' }
  const ts = new Date().toISOString()
  const out = `${ts} [${level}] ${line}\n`
  try { fs.appendFileSync(LOG_FILE, out) } catch {}
}
// Hijack 一次就够；后端 import 在同一进程，console.* 引用的是同一个 console 对象。
// 把原始方法存起来，appendFile 失败时仍能输出到 stdout/stderr（开发模式可见）。
;(function installLogHijack() {
  const levels = ['log', 'info', 'warn', 'error', 'debug']
  for (const level of levels) {
    const original = console[level]?.bind(console) || (() => {})
    console[level] = (...args) => {
      try { original(...args) } catch {}
      try {
        rotateLogIfNeeded()
        writeLog(level, args)
      } catch {}
    }
  }
})()
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? (reason.stack || reason.message) : String(reason))
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.stack || err?.message || String(err))
})
console.log(`[main] MyAI ${app.getVersion()} starting, logs → ${LOG_FILE}`)

// ── GPU 适配器偏好（Windows 多显卡：核显 + 独显笔记本） ──
// Windows 的逐应用显卡偏好存在 HKCU\...\DirectX\UserGpuPreferences
// （与系统设置→屏幕→显示卡的逐应用选项同源），这里按 config 替自己的 exe 维护一条：
//   'discrete'=2 高性能（独显） 'integrated'=1 省电（核显） 'system'=删除条目跟随系统（默认）
// config.json 顶级字段 gpuPreference 可改。
//
// 默认跟随系统（= Optimus 上落核显）是实测出来的：v2.1.399 试过默认独显优先，
// MX450 上 3D 只占 9% 却另付 10% 的 copy 引擎过路费——屏幕物理接在核显上，
// 独显画完每帧都要拷回核显显示；且只要有持续动画独显就永远无法断电休眠，
// 薄本上常驻 77°C。点阵球节流/抽稀之后渲染负载核显随手就能扛，独显得不偿失。
// 'discrete' 留作大屏/高分辨率重负载场景的手动开关。
// 该键在 GPU 进程创建 D3D 设备时读取——这里在启动最早期同步写入，
// 但首次变更仍可能晚于 GPU 进程拉起，此时要到下次启动才真正切换适配器。
function applyGpuPreference() {
  if (process.platform !== 'win32') return
  let pref = 'system'
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(USER_DIR, 'config.json'), 'utf-8'))
    if (['discrete', 'integrated', 'system'].includes(cfg?.gpuPreference)) pref = cfg.gpuPreference
  } catch {}
  const KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences'
  const { execFileSync } = require('child_process')
  try {
    if (pref === 'system') {
      // 交还系统默认。条目本不存在时 reg 会报错——吞掉即可（结果一样）
      try { execFileSync('reg.exe', ['delete', KEY, '/v', process.execPath, '/f'], { stdio: 'ignore', windowsHide: true }) } catch {}
    } else {
      const value = pref === 'integrated' ? 'GpuPreference=1;' : 'GpuPreference=2;'
      execFileSync('reg.exe', ['add', KEY, '/v', process.execPath, '/t', 'REG_SZ', '/d', value, '/f'], { stdio: 'ignore', windowsHide: true })
    }
    console.log(`[main] GPU 偏好已应用: ${pref}`)
  } catch (e) {
    console.warn('[main] 写入 GPU 偏好失败（不影响启动）:', e.message)
  }
}
applyGpuPreference()

let mainWindow = null
let backendPort = 0
let tray = null
let focusBannerWindow = null
let wakeProbeWindow = null
let voiceOrbWindow = null

// 语音唤醒管理器(KWS 跑在独立 utilityProcess,避免与 transformers 的 onnxruntime 冲突)
const wakeWord = require('./wake-word.cjs')

// 后端通过 global.focusBannerBridge 控制横幅窗口
const focusBannerBridge = new EventEmitter()
global.focusBannerBridge = focusBannerBridge
global.bailongmaAppControl = {
  restart() {
    console.log('[main] restart requested')
    app.isQuiting = true
    app.relaunch()
    app.quit()
  },
}

// 终端流桥接：write-file-preview.js / terminal-stream.js 通过它驱动预览窗口的开关。
// 未接独立窗口时，emit 是 no-op（不崩溃，只是不弹窗）；接上 createTerminalStreamWindow 后即生效。
const terminalStreamBridge = new EventEmitter()
global.terminalStreamBridge = terminalStreamBridge

// 窗口布局快照：terminal-stream.js 用它判断终端窗是否还存在（自动关闭逻辑）。
// 返回所有窗口的简要信息；无终端窗时 terminal-stream 内部会按 TTL 自动关闭流。
global.getBailongmaWindowLayoutSnapshot = function () {
  try {
    return {
      windows: BrowserWindow.getAllWindows().map(w => ({
        id: w.id,
        title: w.getTitle(),
        visible: w.isVisible(),
      })),
    }
  } catch {
    return { windows: [] }
  }
}

// ─── 内置 Chrome 浏览器子系统 ───
// MyAI专用 Chrome:独立 profile 的真 Chrome 进程,通过 CDP 让 agent 自动化浏览。
// 不打包 Chromium——优先用系统已装 Chrome(BAILONGMA_BROWSER_PATH 可覆盖),找不到则 browser_* 工具报 CHROME_NOT_INSTALLED。
const bailongmaChrome = createMyAIChromeManager({
  userDataDir: USER_DIR,
  bundledBrowserRoot: bundledBrowserRoot({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    projectRoot: CODE_ROOT,
  }),
})
const embeddedBrowserSession = () => session.fromPartition(BROWSER_EMBED_PARTITION)
const browserDataStore = createBrowserDataStore({
  historyFile: path.join(USER_DIR, 'browser', 'history.json'),
  getSession: embeddedBrowserSession,
})

// 内嵌浏览器预览的安全导航校验:走 src/capabilities/tools/web/url-policy.js 的 URL 白名单
async function assertEmbeddedBrowserNavigationAllowed(url) {
  try {
    const [{ assertWebUrlAllowed }, { config: runtimeConfig }] = await Promise.all([
      import(pathToFileURL(path.join(CODE_ROOT, 'src', 'capabilities', 'tools', 'web', 'url-policy.js')).href),
      import(pathToFileURL(path.join(CODE_ROOT, 'src', 'config.js')).href),
    ])
    return assertWebUrlAllowed(url, {
      allowPrivateNetwork: () => runtimeConfig.security?.browserPrivateNetwork === true,
    })
  } catch {
    return true // url-policy 加载失败时放行(不阻塞浏览,安全降级由 Chrome 自身 profile 隔离保证)
  }
}

const browserEmbedHost = createBrowserEmbedHost({
  WebContentsView, View, BrowserWindow, BaseWindow,
  isAppQuitting: () => app.isQuiting === true,
  onNavigation: entry => browserDataStore.recordVisit(entry),
  assertNavigationAllowed: assertEmbeddedBrowserNavigationAllowed,
  nativeRequestGuard: true,
})

function readDevToolsActivePort() {
  try {
    const [line] = fs.readFileSync(path.join(USER_DIR, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)
    const port = Number(line)
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null
  } catch {
    return null
  }
}

function readLocalJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: pathname, timeout: 2000 }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch (error) { reject(error) }
      })
    })
    request.on('timeout', () => request.destroy(new Error('CDP target lookup timed out')))
    request.on('error', reject)
  })
}

async function resolveBrowserEmbedCdpTarget() {
  const target = browserEmbedHost.getTarget()
  if (!target) return null
  const port = readDevToolsActivePort()
  if (!port) return { ...target, cdpEndpoint: null, targetId: null }
  const cdpEndpoint = `http://127.0.0.1:${port}`
  try {
    const targets = await readLocalJson(port, '/json/list')
    const match = Array.isArray(targets)
      ? targets.find(candidate => {
          if (!candidate?.id) return false
          try { return webContents.fromDevToolsTargetId(candidate.id)?.id === target.webContentsId }
          catch { return false }
        })
      : null
    return { ...target, cdpEndpoint, targetId: match?.id || null }
  } catch (error) {
    console.warn('[browser-embed] unable to resolve CDP target:', error?.message || error)
    return { ...target, cdpEndpoint, targetId: null }
  }
}

// 后端(src/mcp/client-manager.js)通过这个 bridge 获取 CDP endpoint / 管理 browser_* 工具
globalThis.bailongmaChromeBridge = Object.freeze({
  ensureEndpoint: async () => {
    if (!browserEmbedHost.getTarget() && mainWindow && !mainWindow.isDestroyed()) {
      await browserEmbedHost.prime(mainWindow)
    }
    const target = await resolveBrowserEmbedCdpTarget()
    if (!target?.cdpEndpoint || !target?.targetId) {
      throw new Error('MyAI live browser DevTools target is unavailable')
    }
    return target.cdpEndpoint
  },
  getTarget: async () => resolveBrowserEmbedCdpTarget(),
  closePage: () => browserEmbedHost.closePage(),
  clearData: options => browserDataStore.clearData(options),
  getState: () => browserEmbedHost.getTarget(),
})

if (process.platform === 'win32') {
  app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)
}

function sendUpdaterStatus(payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('updater:status', {
    currentVersion: app.getVersion(),
    ...payload,
  })
}

async function bootstrapBackend(port) {
  process.env.BAILONGMA_USER_DIR ||= USER_DIR
  process.env.BAILONGMA_RESOURCES_DIR ||= RESOURCE_ROOT
  process.env.BAILONGMA_PORT = String(port)
  await import(pathToFileURL(BACKEND_ENTRY).href)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

async function findFreePort(preferred = 3721) {
  for (const port of [preferred, 0]) {
    try {
      const actual = await new Promise((resolve, reject) => {
        const server = net.createServer()
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => {
          const address = server.address()
          server.close(() => resolve(address.port))
        })
      })
      return actual
    } catch {}
  }
  throw new Error('Unable to find a free local port')
}

function waitForBackend(port, timeoutMs = 30000) {
  const startedAt = Date.now()
  const url = `http://127.0.0.1:${port}/activation-status`
  let lastProbe = 'no probe completed'

  return new Promise((resolve, reject) => {
    const tick = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Backend startup timed out on port ${port}. Last probe: ${lastProbe}`))
        return
      }

      const req = http.get(url, res => {
        res.resume()
        lastProbe = `HTTP ${res.statusCode || 'unknown'} from ${url}`
        resolve()
      })
      req.on('error', err => {
        lastProbe = err?.message || String(err)
        setTimeout(tick, 300)
      })
      req.setTimeout(1500, () => {
        lastProbe = `timeout waiting for ${url}`
        req.destroy()
        setTimeout(tick, 300)
      })
    }

    tick()
  })
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0b0e',
    title: 'MyAI',
    icon: path.join(RESOURCE_ROOT, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      // 后台不节流：窗口最小化到托盘时，macOS ASR 音频采集/定时器仍需正常工作
      // （默认 backgroundThrottling:true 会把隐藏窗口的 timer 压到 ~1Hz，语音输入会坏）
      backgroundThrottling: false,
      // 允许无用户手势自动播放音频（TTS 语音播报需要）
      autoplayPolicy: 'no-user-gesture-required',
    },
  })

  // 授予麦克风权限（语音输入需要）
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') return callback(true)
    callback(false)
  })
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media') return true
    return false
  })

  // 窗口级快捷键（不用 globalShortcut，避免劫持其他应用的 F11/Ctrl+R 等）
  //   F12      → 切换 DevTools
  //   F11      → 切换全屏
  //   Ctrl+R   → reload（仅 dev）
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools()
      event.preventDefault()
      return
    }
    if (input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen())
      event.preventDefault()
      return
    }
    if (IS_DEV && (input.control || input.meta) && input.key.toLowerCase() === 'r') {
      mainWindow.webContents.reload()
      event.preventDefault()
      return
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  await mainWindow.loadURL(`http://127.0.0.1:${backendPort}/`)
  // 关闭主窗口时最小化到托盘，不退出
  mainWindow.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function setupTray() {
  const iconName = process.platform === 'darwin' ? 'icon.png' : 'icon.ico'
  const iconPath = path.join(RESOURCE_ROOT, 'build', iconName)
  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('MyAI')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主界面',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuiting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

function createFocusBannerWindow({ task = '', current_step = '', tasks = [] } = {}) {
  if (focusBannerWindow && !focusBannerWindow.isDestroyed()) {
    focusBannerWindow.webContents.send('focus-banner:update', { task, current_step, tasks })
    return
  }

  const { width: screenW } = require('electron').screen.getPrimaryDisplay().workAreaSize

  focusBannerWindow = new BrowserWindow({
    width: 280,
    height: 60,
    x: Math.round(screenW / 2 - 140),
    y: 48,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    focusable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'focus-banner-preload.cjs'),
    },
  })

  // 给 banner 窗口的 session 也授权麦克风
  focusBannerWindow.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
    if (permission === 'media') return callback(true)
    callback(false)
  })
  focusBannerWindow.webContents.session.setPermissionCheckHandler((wc, permission) => {
    if (permission === 'media') return true
    return false
  })

  focusBannerWindow.loadFile(path.join(RESOURCE_ROOT, 'focus-banner.html'))

  focusBannerWindow.webContents.once('did-finish-load', () => {
    if (!focusBannerWindow || focusBannerWindow.isDestroyed()) return
    // 先发端口配置，让语音识别结果能发回后端
    focusBannerWindow.webContents.send('focus-banner:config', { port: backendPort })
    focusBannerWindow.webContents.send('focus-banner:update', { task, current_step, tasks })
    autoResizeBannerWindow()
  })

  focusBannerWindow.on('closed', () => {
    focusBannerWindow = null
  })
}

function autoResizeBannerWindow() {
  if (!focusBannerWindow || focusBannerWindow.isDestroyed()) return
  focusBannerWindow.webContents.executeJavaScript(`
    (() => {
      const b = document.getElementById('banner')
      return b ? { w: b.offsetWidth, h: b.offsetHeight } : null
    })()
  `).then(size => {
    if (!size || !focusBannerWindow || focusBannerWindow.isDestroyed()) return
    const padW = 0
    const padH = 0
    focusBannerWindow.setSize(Math.max(160, size.w + padW), Math.max(40, size.h + padH))
  }).catch(() => {})
}

// Focus Banner IPC handlers
ipcMain.on('focus-banner:close', () => {
  if (focusBannerWindow && !focusBannerWindow.isDestroyed()) {
    focusBannerWindow.close()
    focusBannerWindow = null
  }
})

ipcMain.on('focus-banner:set-expanded', (_e, { expanded }) => {
  if (!focusBannerWindow || focusBannerWindow.isDestroyed()) return
  setTimeout(() => autoResizeBannerWindow(), 50)
})

ipcMain.on('focus-banner:request-resize', () => {
  setTimeout(() => autoResizeBannerWindow(), 30)
})

ipcMain.on('focus-banner:toggle-task', (_e, { idx, done }) => {
  // 任务勾选状态更改，横幅已在前端自行更新，无需额外操作
})

// 后端 bridge 事件监听
focusBannerBridge.on('command', ({ action, task, current_step, tasks }) => {
  if (action === 'show' || action === 'update') {
    createFocusBannerWindow({ task, current_step, tasks })
  }
})

focusBannerBridge.on('hide', () => {
  if (focusBannerWindow && !focusBannerWindow.isDestroyed()) {
    focusBannerWindow.close()
    focusBannerWindow = null
  }
})

// ─── 语音唤醒:隐藏的"耳朵"窗口(常开麦采集 16kHz PCM) ───
function createWakeProbeWindow() {
  if (wakeProbeWindow && !wakeProbeWindow.isDestroyed()) return
  wakeProbeWindow = new BrowserWindow({
    width: 220,
    height: 120,
    show: false,           // 始终隐藏:它只是"耳朵"
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'wake-probe-preload.cjs'),
      autoplayPolicy: 'no-user-gesture-required', // 隐藏窗口无用户手势也能启动 AudioContext
      backgroundThrottling: false,                // 后台不降频,保证常开采集不被节流
    },
  })
  wakeProbeWindow.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'media')
  })
  wakeProbeWindow.webContents.session.setPermissionCheckHandler((wc, permission) => permission === 'media')
  wakeProbeWindow.loadFile(path.join(__dirname, 'wake-probe.html'))
  wakeProbeWindow.on('closed', () => { wakeProbeWindow = null })
}

// wake-probe 渲染层采集到 PCM → 转发给 KWS 子进程
ipcMain.on('wake:pcm', (_e, buffer) => {
  if (!buffer) return
  wakeWord.feedPcm(buffer)
})

ipcMain.on('wake:status', (_e, info) => {
  console.log('[wake-probe] 耳朵状态:', info?.status, info?.detail || '')
})

// ─── 语音悬浮球:独立置顶透明窗,命中唤醒词后显示 ───
function createVoiceOrbWindow() {
  if (voiceOrbWindow && !voiceOrbWindow.isDestroyed()) return
  const { screen } = require('electron')
  const { workArea } = screen.getPrimaryDisplay()
  const W = 640, H = 380, topMargin = 8
  voiceOrbWindow = new BrowserWindow({
    width: W, height: H,
    x: workArea.x + Math.round((workArea.width - W) / 2),
    y: workArea.y + topMargin,
    show: false, frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, focusable: false,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false,
      preload: path.join(__dirname, 'voice-orb-preload.cjs'),
      backgroundThrottling: false,
    },
  })
  // 复用 brain-ui 静态路由,voice-orb.html 的 import './voice-core.js' 才能解析
  voiceOrbWindow.loadURL(`http://127.0.0.1:${backendPort}/src/ui/brain-ui/voice-orb.html`)
  voiceOrbWindow.on('closed', () => { voiceOrbWindow = null })
}

function sendToOrb(channel, payload) {
  if (!voiceOrbWindow || voiceOrbWindow.isDestroyed()) return
  voiceOrbWindow.webContents.send(channel, payload)
}

ipcMain.on('wake:orb-enter', () => {
  createVoiceOrbWindow()
  const show = () => {
    if (!voiceOrbWindow || voiceOrbWindow.isDestroyed()) return
    voiceOrbWindow.showInactive()
    sendToOrb('orb:enter')
  }
  if (voiceOrbWindow.webContents.isLoading()) {
    voiceOrbWindow.webContents.once('did-finish-load', show)
  } else {
    show()
  }
})
ipcMain.on('wake:orb-frame', (_e, payload) => { sendToOrb('orb:frame', payload) })
ipcMain.on('wake:orb-text', (_e, payload) => { sendToOrb('orb:text', payload) })
ipcMain.on('wake:orb-exit', () => { sendToOrb('orb:exit') })

function setupAutoUpdater() {
  autoUpdater.autoDownload = false
  // Avoid applying an already downloaded update while Windows is shutting down.
  // The renderer still installs explicitly through updater:quit-and-install.
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    sendUpdaterStatus({ stage: 'checking' })
  })

  autoUpdater.on('update-available', info => {
    console.log('[updater] update available', info?.version)
    sendUpdaterStatus({ stage: 'available', version: info?.version })
  })

  autoUpdater.on('download-progress', progress => {
    sendUpdaterStatus({
      stage: 'downloading',
      percent: Number(progress?.percent || 0),
      transferred: progress?.transferred || 0,
      total: progress?.total || 0,
    })
  })

  autoUpdater.on('update-downloaded', info => {
    console.log('[updater] update downloaded', info?.version)
    sendUpdaterStatus({ stage: 'downloaded', version: info?.version })
  })

  autoUpdater.on('update-not-available', info => {
    sendUpdaterStatus({
      stage: 'up-to-date',
      version: info?.version || app.getVersion(),
    })
  })

  autoUpdater.on('error', err => {
    const message = err?.message || String(err || 'Update failed')
    console.warn('[updater] update failed', message)
    sendUpdaterStatus({ stage: 'error', message })
  })

  if (!IS_DEV) {
    autoUpdater.checkForUpdates().catch(err => {
      // 不要静默吞掉更新检查失败。GitHub 在国内经常超时/不可达，若整段吞掉，
      // 用户会卡在「永远没有更新」且无任何痕迹。这里至少落到日志，便于排查。
      console.warn('[updater] initial check failed', err?.message || err)
    })
  }
}

ipcMain.handle('app:get-version', () => app.getVersion())

ipcMain.handle('updater:check-for-updates', async () => {
  if (IS_DEV) {
    sendUpdaterStatus({ stage: 'dev' })
    return { ok: false, skipped: true, reason: 'dev' }
  }
  try {
    sendUpdaterStatus({ stage: 'checking' })
    const result = await autoUpdater.checkForUpdates()
    return { ok: true, updateInfo: result?.updateInfo || null }
  } catch (error) {
    const message = error?.message || String(error || 'Update check failed')
    sendUpdaterStatus({ stage: 'error', message })
    return { ok: false, message }
  }
})

ipcMain.handle('updater:start-download', async () => {
  try {
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (error) {
    const message = error?.message || String(error || 'Download failed')
    sendUpdaterStatus({ stage: 'error', message })
    return { ok: false, message }
  }
})

ipcMain.handle('updater:quit-and-install', () => {
  autoUpdater.quitAndInstall()
})

// 内嵌浏览器预览卡片:渲染层通过 IPC 控制 WebContentsView 的显隐/URL/尺寸
ipcMain.handle('browser-embed:update', async (_e, payload) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'no main window' }
    await browserEmbedHost.update(mainWindow, payload)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
})

ipcMain.handle('browser-embed:hide', async () => {
  try { await browserEmbedHost.hide(); return { ok: true } }
  catch (err) { return { ok: false, error: err?.message || String(err) } }
})

ipcMain.handle('browser-embed:get-state', async () => {
  try { return { ok: true, state: browserEmbedHost.getTarget() } }
  catch (err) { return { ok: false, error: err?.message || String(err) } }
})

// 退出时清理:销毁所有内嵌浏览器 view + 停止MyAI专用 Chrome 进程
app.on('before-quit', () => {
  app.isQuiting = true
  try { browserEmbedHost.destroyAll() } catch {}
  try { bailongmaChrome.stopOwnedChrome() } catch {}
})

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
})

app.on('window-all-closed', () => {
  // 主窗口关闭后保持后台运行（Focus Banner 等桌面功能继续工作）
  // 只有托盘菜单「退出」才真正退出
})

// macOS：点 Dock 图标时重新显示主窗口（关闭窗口后应用仍在后台运行）
app.on('activate', () => {
  if (process.platform === 'darwin') {
    if (mainWindow) { mainWindow.show(); mainWindow.focus() }
  }
})

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)

  // ── 云端认证检查 ──
  // 启动时先检查本地缓存的 token 是否有效。无效则显示登录页面。
  const CLOUD_AUTH_URL = process.env.CLOUD_AUTH_URL || 'https://zy.tangdou2027.top/admin'
  const TOKEN_FILE = path.join(USER_DIR, '.cloud-auth-token')
  let cloudAuthed = false

  try {
    const cachedToken = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf-8').trim() : null
    if (cachedToken) {
      // 验证 token 有效性
      const resp = await fetch(`${CLOUD_AUTH_URL}/api/me`, {
        headers: { Authorization: `Bearer ${cachedToken}` },
        signal: AbortSignal.timeout(5000),
      }).catch(() => null)
      if (resp && resp.ok) {
        cloudAuthed = true
        console.log('[main] 云端认证通过（token 有效）')
      } else {
        console.log('[main] 云端 token 无效，需要重新登录')
      }
    }
  } catch (err) {
    console.log('[main] 云端认证检查失败（离线模式可能）:', err?.message)
    // 离线时如果有缓存 token，乐观放行
    if (fs.existsSync(TOKEN_FILE)) {
      cloudAuthed = true
      console.log('[main] 离线模式：使用缓存 token 乐观放行')
    }
  }

  // 如果未认证，显示登录窗口
  if (!cloudAuthed) {
    console.log('[main] 显示云端登录页面')
    const loginWin = new BrowserWindow({
      width: 420, height: 580,
      resizable: false, minimizable: false, maximizable: false,
      frame: true, autoHideMenuBar: true,
      title: 'MyAI · 登录',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, 'cloud-login-preload.cjs'),
      },
    })
    loginWin.loadFile(path.join(__dirname, '..', 'cloud-login.html'))

    // 等待登录成功
    await new Promise((resolve) => {
      ipcMain.once('cloud-auth-success', (_e, dataStr) => {
        try {
          const data = JSON.parse(dataStr)
          fs.writeFileSync(TOKEN_FILE, data.token, { mode: 0o600 })
          fs.writeFileSync(path.join(USER_DIR, '.cloud-auth-user'), JSON.stringify(data.user), { mode: 0o600 })
          console.log('[main] 云端登录成功:', data.user?.username)
        } catch (err) {
          console.error('[main] 云端登录数据保存失败:', err)
        }
        loginWin.close()
        resolve()
      })
    })
  }

  try {
    backendPort = await findFreePort(3721)
    await bootstrapBackend(backendPort)
    await waitForBackend(backendPort)
  } catch (err) {
    console.error(`[main] Backend startup failed on port ${backendPort || 'unknown'}`, err?.stack || err?.message || err)
    dialog.showErrorBox('Startup failed', `Unable to start the MyAI backend:\n${err.message}`)
    app.quit()
    return
  }

  await createWindow()
  setupTray()
  setupAutoUpdater()

  // 语音唤醒(KWS):启动独立 utilityProcess 子进程,失败不影响 app 其余功能。
  // 命中"小白龙"→ 通知主窗口渲染层启动唤醒会话(前端 voice-wake.js 负责开麦+监听)。
  try {
    const wakeReady = wakeWord.initWakeWord({ codeRoot: CODE_ROOT, logDir: LOG_DIR })
    if (wakeReady) {
      wakeWord.setOnHit(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('wake:hit')
      })
      createWakeProbeWindow()
      createVoiceOrbWindow() // 预建悬浮球窗(隐藏),首次唤醒即时入场
      console.log('[main] 语音唤醒已启用,隐藏耳朵窗口已开启')
    } else {
      console.warn('[main] 语音唤醒未启用(引擎初始化失败,见 wake-word.log)')
    }
  } catch (err) {
    console.error('[main] 语音唤醒启动异常(忽略):', err?.message || err)
  }
})
