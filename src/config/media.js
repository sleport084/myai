import fs from 'fs'
import { paths } from '../paths.js'
import { readExistingStoredConfig, writeStoredConfig } from './shared.js'
import { getMinimaxKey } from './voice.js'

// ── Media config（媒体生成：图片/音乐/歌词）────────────────────────────────
// 支持多个 provider 的 API Key 独立配置
const MEDIA_CONFIG_KEYS = [
  'mediaImageProvider', // 图片生成 provider: minimax | openai
  'mediaMusicProvider', // 音乐生成 provider: minimax（目前只有 MiniMax）
  'openaiImageKey',     // OpenAI DALL-E API Key
  'openaiImageBaseURL', // OpenAI DALL-E Base URL（选填）
  'openaiImageModel',   // OpenAI 图片模型名（选填，默认 dall-e-3）
  'customImageUrl',     // 自定义图片生成 Base URL
  'customImageKey',     // 自定义图片生成 API Key
  'customImageModel',   // 自定义图片生成模型名
]

export function getMediaConfig() {
  let stored = {}
  try { stored = JSON.parse(fs.readFileSync(paths.configFile, 'utf-8'))?.media || {} } catch {}
  return {
    mediaImageProvider: stored.mediaImageProvider || 'minimax',
    mediaMusicProvider: stored.mediaMusicProvider || 'minimax',
    minimaxKey: { configured: !!(stored.minimaxKey || process.env.MINIMAX_API_KEY || getMinimaxKey()) },
    openaiImageKey: { configured: !!(stored.openaiImageKey) },
    openaiImageBaseURL: stored.openaiImageBaseURL || '',
    openaiImageModel: stored.openaiImageModel || 'dall-e-3',
    customImageUrl: stored.customImageUrl || '',
    customImageKey: { configured: !!(stored.customImageKey) },
    customImageModel: stored.customImageModel || '',
  }
}

export function getMediaCredentials() {
  let stored = {}
  try { stored = JSON.parse(fs.readFileSync(paths.configFile, 'utf-8'))?.media || {} } catch {}
  return {
    imageProvider: stored.mediaImageProvider || 'minimax',
    musicProvider: stored.mediaMusicProvider || 'minimax',
    minimaxKey: stored.minimaxKey || process.env.MINIMAX_API_KEY || getMinimaxKey() || '',
    openaiImageKey: stored.openaiImageKey || '',
    openaiImageBaseURL: stored.openaiImageBaseURL || '',
    openaiImageModel: stored.openaiImageModel || 'dall-e-3',
    customImageUrl: stored.customImageUrl || '',
    customImageKey: stored.customImageKey || '',
    customImageModel: stored.customImageModel || '',
  }
}

export function setMediaConfig(updates) {
  const existing = readExistingStoredConfig()
  const current = existing.media || {}
  const next = { ...current }
  for (const [key, val] of Object.entries(updates)) {
    if (!MEDIA_CONFIG_KEYS.includes(key) && key !== 'minimaxKey') continue
    const trimmed = String(val || '').trim()
    if (trimmed) next[key] = trimmed
    else delete next[key]
  }
  writeStoredConfig({ ...existing, media: next })
}

// ── Seedance AI 视频生成（火山方舟 Ark）配置 ──
// 存于独立文件 seedance.json：{ apiKey, model, baseURL }
const SEEDANCE_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const SEEDANCE_DEFAULT_MODEL = 'doubao-seedance-2-0-260128'

function readSeedanceFile() {
  try { return JSON.parse(fs.readFileSync(paths.seedanceConfigFile, 'utf-8')) || {} }
  catch { return {} }
}
export function writeSeedanceFile(obj) {
  const tmp = paths.seedanceConfigFile + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8')
  fs.renameSync(tmp, paths.seedanceConfigFile)
}

// 一次性迁移：旧版把 seedance 存在 config.json 里。若独立文件尚无、而 config.json 里还有，
// 就搬过去并从 config.json 删除该字段，之后只认独立文件。
function migrateLegacySeedance() {
  if (fs.existsSync(paths.seedanceConfigFile)) return
  let mainCfg
  try { mainCfg = JSON.parse(fs.readFileSync(paths.configFile, 'utf-8')) } catch { return }
  const legacy = mainCfg?.seedance
  if (!legacy || typeof legacy !== 'object') return
  try {
    writeSeedanceFile(legacy)
    const { seedance: _removed, ...rest } = mainCfg
    writeStoredConfig(rest)
    console.log('[config] 已把旧的 seedance 配置从 config.json 迁移到 seedance.json')
  } catch (e) {
    console.warn('[config] seedance 迁移失败:', e.message)
  }
}

export function getSeedanceConfig() {
  const envKey = String(process.env.ARK_API_KEY || process.env.SEEDANCE_API_KEY || '').trim()
  migrateLegacySeedance()
  const stored = readSeedanceFile()
  const apiKey = envKey || String(stored.apiKey || '').trim()
  return {
    apiKey,
    model: String(stored.model || '').trim() || SEEDANCE_DEFAULT_MODEL,
    baseURL: String(stored.baseURL || '').trim() || SEEDANCE_DEFAULT_BASE_URL,
    configured: Boolean(apiKey),
  }
}

export function isSeedanceConfigured() {
  return getSeedanceConfig().configured
}

export function setSeedanceConfig({ apiKey, model, baseURL } = {}) {
  migrateLegacySeedance()
  const next = { ...readSeedanceFile() }
  if (apiKey !== undefined) next.apiKey = String(apiKey || '').trim()
  if (model !== undefined) next.model = String(model || '').trim()
  if (baseURL !== undefined) next.baseURL = String(baseURL || '').trim()
  if (!next.apiKey) {
    try { fs.rmSync(paths.seedanceConfigFile, { force: true }) } catch {}
    return getSeedanceConfig()
  }
  writeSeedanceFile(next)
  return getSeedanceConfig()
}
