// 共享 Chromium 单例：避免每次 browser_read 冷启动（耗时 3~5 秒）
import { throwIfAborted } from '../../abort-utils.js'
import fs from 'fs'
import os from 'os'
import path from 'path'

let _sharedBrowser = null
let _sharedBrowserLastUsed = 0
let _playwrightChromium = null
const BROWSER_IDLE_TIMEOUT_MS = 10 * 60 * 1000  // 闲置 10 分钟后关掉

export const BROWSER_VIEWPORT = { width: 1365, height: 900 }

export async function getSharedBrowser() {
  const now = Date.now()
  if (_sharedBrowser && now - _sharedBrowserLastUsed > BROWSER_IDLE_TIMEOUT_MS) {
    try { await _sharedBrowser.close() } catch {}
    _sharedBrowser = null
  }
  if (!_sharedBrowser) {
    _sharedBrowser = await launchReadableBrowser()
  }
  _sharedBrowserLastUsed = Date.now()
  return _sharedBrowser
}

export function invalidateSharedBrowser() {
  _sharedBrowser = null
}

// 版本漂移自愈: Playwright 要求的浏览器 build 号与缓存里已装的不一致时
// (如项目升版本后需要 1217,缓存里只有 1228),扫缓存找任何可用的 chromium
// 可执行文件,直接用 executablePath 指过去,免去重新下载。
function findAnyChromiumExecutable() {
  const roots = [
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),       // macOS
    process.env.PLAYWRIGHT_BROWSERS_PATH || '',                          // 自定义
    path.join(os.homedir(), '.cache', 'ms-playwright'),                  // Linux
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : '', // Win
  ].filter(Boolean)
  for (const root of roots) {
    let entries
    try { entries = fs.readdirSync(root) } catch { continue }
    // 优先 headless shell(轻),再完整 chromium;build 号倒序(新优先)
    const dirs = entries.filter(e => /^(chromium_headless_shell|chromium|chromium-tip-of-tree)-\d+$/.test(e))
      .sort((a, b) => parseInt(b.split('-').pop()) - parseInt(a.split('-').pop()))
    for (const d of dirs) {
      const base = path.join(root, d)
      // 平台子目录名不定(mac-x64/mac-arm64/linux64/win64x),递归找可执行文件
      const candidates = [
        'chrome-headless-shell-mac-x64/chrome-headless-shell',
        'chrome-headless-shell-mac-arm64/chrome-headless-shell',
        'chrome-headless-shell-linux64/chrome-headless-shell',
        'chrome-headless-shell-win64x/chrome-headless-shell.exe',
        'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-linux64/chrome',
        'chrome-linux/chrome',
        'chrome-win64x/chrome.exe',
        'chrome-win/chrome.exe',
      ]
      for (const c of candidates) {
        const full = path.join(base, c)
        try { if (fs.existsSync(full) && fs.statSync(full).isFile()) return full } catch {}
      }
    }
  }
  return null
}

async function launchReadableBrowser() {
  const chromium = await getPlaywrightChromium()
  const launchOptions = { headless: true }
  try {
    return await chromium.launch(launchOptions)
  } catch (firstError) {
    // 兜底1: 缓存里任何版本的 chromium 可执行文件(版本漂移自愈)
    const fallbackExe = findAnyChromiumExecutable()
    if (fallbackExe) {
      try {
        console.log(`[browser] 版本漂移兜底: 使用 ${path.basename(fallbackExe)} (${fallbackExe.split('ms-playwright')[1]?.slice(1, 40)}…)`)
        return await chromium.launch({ ...launchOptions, executablePath: fallbackExe })
      } catch {}
    }
    // 兜底2: 系统 Edge/Chrome
    for (const channel of ['msedge', 'chrome']) {
      try {
        return await chromium.launch({ ...launchOptions, channel })
      } catch {}
    }
    throw firstError
  }
}

async function getPlaywrightChromium() {
  if (_playwrightChromium) return _playwrightChromium
  // 解析链(打包后顶层 playwright 是 devDependency 不进 asar,
  // 但 @playwright/mcp 生产依赖内嵌了一份 playwright,直接按文件 URL 导入)
  const candidates = [
    () => import('playwright'),                                                    // 开发模式
    () => import(new URL('../../../../node_modules/@playwright/mcp/node_modules/playwright/index.mjs', import.meta.url).href),  // 打包模式(asar 内嵌)
    () => import('playwright-core'),                                               // 兜底
    () => import(new URL('../../../../node_modules/@playwright/mcp/node_modules/playwright-core/index.mjs', import.meta.url).href),
  ]
  let lastErr = null
  for (const load of candidates) {
    try {
      const mod = await load()
      const ch = mod.chromium || mod.default?.chromium
      if (ch) { _playwrightChromium = ch; return _playwrightChromium }
    } catch (e) { lastErr = e }
  }
  throw new Error(`Playwright is not bundled in this build: ${lastErr?.message || 'no import path resolved'}`)
}

export async function autoScrollPage(page, signal) {
  for (let i = 0; i < 4; i++) {
    throwIfAborted(signal)
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight, 800)))
    await page.waitForTimeout(450)
  }
  await page.evaluate(() => window.scrollTo(0, 0))
}
