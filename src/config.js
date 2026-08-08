import fs from 'fs'
import path from 'path'
import { paths } from './paths.js'
import { nowTimestamp } from './time.js'
import {
  DEEPSEEK_PROVIDER,
  MINIMAX_PROVIDER,
  OPENAI_PROVIDER,
  QWEN_PROVIDER,
  MOONSHOT_PROVIDER,
  ZHIPU_PROVIDER,
  MIMO_PROVIDER,
  readParsedConfig,
  writeStoredConfig,
  readExistingStoredConfig,
  patchConfig,
} from './config/shared.js'
import {
  getVoiceConfig,
  setVoiceConfig,
  getMinimaxKey,
  setMinimaxKey,
  getTTSConfig,
  getTTSCredentials,
  setTTSConfig,
} from './config/voice.js'
import {
  getMediaConfig,
  getMediaCredentials,
  setMediaConfig,
  getSeedanceConfig,
  isSeedanceConfigured,
  setSeedanceConfig,
  writeSeedanceFile,
} from './config/media.js'
import {
  getWebSearchConfig,
  getWebSearchCredentials,
  setWebSearchConfig,
} from './config/search.js'
import {
  getClawbotCredentials,
  setClawbotCredentials,
  clearClawbotCredentials,
  getSocialConfig,
  setSocialConfig,
} from './config/social.js'

export {
  DEEPSEEK_PROVIDER,
  MINIMAX_PROVIDER,
  OPENAI_PROVIDER,
  QWEN_PROVIDER,
  MOONSHOT_PROVIDER,
  ZHIPU_PROVIDER,
  MIMO_PROVIDER,
} from './config/shared.js'
export {
  getVoiceConfig,
  setVoiceConfig,
  getMinimaxKey,
  setMinimaxKey,
  getTTSConfig,
  getTTSCredentials,
  setTTSConfig,
} from './config/voice.js'
export {
  getMediaConfig,
  getMediaCredentials,
  setMediaConfig,
  getSeedanceConfig,
  isSeedanceConfigured,
  setSeedanceConfig,
  writeSeedanceFile,
} from './config/media.js'
export {
  getWebSearchConfig,
  getWebSearchCredentials,
  setWebSearchConfig,
} from './config/search.js'
export {
  getClawbotCredentials,
  setClawbotCredentials,
  clearClawbotCredentials,
  getSocialConfig,
  setSocialConfig,
} from './config/social.js'

export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-pro'
export const DEFAULT_MINIMAX_MODEL = 'MiniMax-M2.7'
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'
export const DEFAULT_QWEN_MODEL = 'qwen-turbo'
export const DEFAULT_MOONSHOT_MODEL = 'moonshot-v1-8k'
export const DEFAULT_ZHIPU_MODEL = 'glm-5.1'
export const DEFAULT_MIMO_MODEL = 'MiMo-V2.5-Pro-UltraSpeed'

export const DEEPSEEK_MODELS = [
  {
    id: 'deepseek-v4-flash',
    label: 'deepseek-v4-flash',
    deprecated: false,
  },
  {
    id: 'deepseek-v4-pro',
    label: 'deepseek-v4-pro',
    deprecated: false,
  },
  {
    id: 'deepseek-chat',
    label: 'deepseek-chat (deprecated 2026/07/24)',
    deprecated: true,
  },
  {
    id: 'deepseek-reasoner',
    label: 'deepseek-reasoner (deprecated 2026/07/24)',
    deprecated: true,
  },
]

export const MINIMAX_MODELS = [
  {
    id: 'MiniMax-M2.7',
    label: 'MiniMax-M2.7',
    deprecated: false,
  },
  {
    id: 'MiniMax-M1',
    label: 'MiniMax-M1',
    deprecated: false,
  },
]

export const OPENAI_MODELS = [
  {
    id: 'gpt-4o-mini',
    label: 'gpt-4o-mini',
    deprecated: false,
  },
  {
    id: 'gpt-4o',
    label: 'gpt-4o',
    deprecated: false,
  },
]

export const QWEN_MODELS = [
  {
    id: 'qwen-turbo',
    label: 'qwen-turbo',
    deprecated: false,
  },
  {
    id: 'qwen-plus',
    label: 'qwen-plus',
    deprecated: false,
  },
]

export const MOONSHOT_MODELS = [
  {
    id: 'moonshot-v1-8k',
    label: 'moonshot-v1-8k',
    deprecated: false,
  },
  {
    id: 'moonshot-v1-32k',
    label: 'moonshot-v1-32k',
    deprecated: false,
  },
]

export const ZHIPU_MODELS = [
  {
    id: 'glm-5.1',
    label: 'glm-5.1',
    deprecated: false,
  },
  {
    id: 'glm-5-turbo',
    label: 'glm-5-turbo',
    deprecated: false,
  },
  {
    id: 'glm-5',
    label: 'glm-5',
    deprecated: false,
  },
  {
    id: 'glm-4.7',
    label: 'glm-4.7',
    deprecated: false,
  },
  {
    id: 'glm-4.7-flash',
    label: 'glm-4.7-flash',
    deprecated: false,
  },
  {
    id: 'glm-4.7-flashx',
    label: 'glm-4.7-flashx',
    deprecated: false,
  },
  {
    id: 'glm-4.6',
    label: 'glm-4.6',
    deprecated: false,
  },
  {
    id: 'glm-4.5-air',
    label: 'glm-4.5-air',
    deprecated: false,
  },
  {
    id: 'glm-4.5-airx',
    label: 'glm-4.5-airx',
    deprecated: false,
  },
  {
    id: 'glm-4.5-flash',
    label: 'glm-4.5-flash',
    deprecated: false,
  },
  {
    id: 'glm-5.1-highspeed',
    label: 'glm-5.1-highspeed (limited access)',
    deprecated: false,
  },
  {
    id: 'glm-4-flash-250414',
    label: 'glm-4-flash-250414',
    deprecated: false,
  },
  {
    id: 'glm-4-flashx-250414',
    label: 'glm-4-flashx-250414',
    deprecated: false,
  },
]

export const MIMO_MODELS = [
  {
    id: 'MiMo-V2.5-Pro-UltraSpeed',
    label: 'MiMo-V2.5-Pro-UltraSpeed',
    deprecated: false,
  },
  {
    id: 'mimo-v2.5-pro',
    label: 'MiMo-V2.5-Pro',
    deprecated: false,
  },
  {
    id: 'mimo-v2.5',
    label: 'MiMo-V2.5',
    deprecated: false,
  },
  {
    id: 'mimo-v2-pro',
    label: 'MiMo-V2-Pro',
    deprecated: false,
  },
  {
    id: 'mimo-v2-flash',
    label: 'MiMo-V2-Flash',
    deprecated: false,
  },
]

const PROVIDER_CONFIG = {
  [DEEPSEEK_PROVIDER]: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    envVar: 'DEEPSEEK_API_KEY',
    models: DEEPSEEK_MODELS,
    defaultModel: DEFAULT_DEEPSEEK_MODEL,
  },
  [MINIMAX_PROVIDER]: {
    label: 'MiniMax',
    baseURL: 'https://api.minimax.chat/v1',
    envVar: 'MINIMAX_API_KEY',
    models: MINIMAX_MODELS,
    defaultModel: DEFAULT_MINIMAX_MODEL,
  },
  [OPENAI_PROVIDER]: {
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    envVar: 'OPENAI_API_KEY',
    models: OPENAI_MODELS,
    defaultModel: DEFAULT_OPENAI_MODEL,
  },
  [QWEN_PROVIDER]: {
    label: 'Qwen',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    envVar: 'DASHSCOPE_API_KEY',
    models: QWEN_MODELS,
    defaultModel: DEFAULT_QWEN_MODEL,
  },
  [MOONSHOT_PROVIDER]: {
    label: 'Moonshot',
    baseURL: 'https://api.moonshot.cn/v1',
    envVar: 'MOONSHOT_API_KEY',
    models: MOONSHOT_MODELS,
    defaultModel: DEFAULT_MOONSHOT_MODEL,
  },
  [ZHIPU_PROVIDER]: {
    label: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    envVar: 'ZHIPU_API_KEY',
    models: ZHIPU_MODELS,
    defaultModel: DEFAULT_ZHIPU_MODEL,
  },
  [MIMO_PROVIDER]: {
    label: '小米 MiMo',
    baseURL: 'https://api.xiaomimimo.com/v1',
    envVar: 'MIMO_API_KEY',
    models: MIMO_MODELS,
    defaultModel: DEFAULT_MIMO_MODEL,
  },
}

const AUTO_PROVIDER = 'auto'
const PROBE_TIMEOUT_MS = 12000

function normalizeModel(model, provider = DEEPSEEK_PROVIDER) {
  const pConfig = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG[DEEPSEEK_PROVIDER]
  const value = String(model || '').trim()
  const validIds = new Set(pConfig.models.map(m => m.id))
  if (validIds.has(value)) return value
  return pConfig.defaultModel
}

export function getProviderModelFallbacks(provider, model) {
  const pConfig = PROVIDER_CONFIG[provider]
  if (!pConfig) return String(model || '').trim() ? [String(model).trim()] : []
  const primary = normalizeModel(model, provider)
  if (provider !== MIMO_PROVIDER) return [primary]

  const chain = [primary]
  for (const item of pConfig.models) {
    if (!item?.id || item.deprecated || chain.includes(item.id)) continue
    chain.push(item.id)
  }
  return chain
}

function isThinkingEnabledForModel(model) {
  return normalizeModel(model) !== 'deepseek-chat'
}

function getProvidersForAutoDetect() {
  return Object.entries(PROVIDER_CONFIG)
}

function getProviderErrorMessage(err) {
  const status = err?.status ?? err?.response?.status
  const message = err?.message || String(err)
  return status ? `${status} ${message}` : message
}

function isProviderAuthError(err) {
  const status = err?.status ?? err?.response?.status
  const message = err?.message || String(err)
  return status === 401 || /unauthoriz|invalid.*api.*key|authentication/i.test(message)
}

function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function buildPingParams(provider, model) {
  const pingParams = {
    model,
    messages: [{ role: 'user', content: 'Reply with exactly: hello' }],
    max_tokens: 8,
    temperature: 0,
    stream: false,
  }
  if (provider === DEEPSEEK_PROVIDER) {
    pingParams.reasoning_effort = 'high'
    pingParams.thinking = { type: isThinkingEnabledForModel(model) ? 'enabled' : 'disabled' }
  } else if (provider === ZHIPU_PROVIDER) {
    pingParams.thinking = { type: 'disabled' }
  }
  return pingParams
}

async function probeProvider(OpenAI, provider, apiKey, requestedModel) {
  const pConfig = PROVIDER_CONFIG[provider]
  const models = getProviderModelFallbacks(provider, requestedModel)
  const client = new OpenAI({
    apiKey,
    baseURL: pConfig.baseURL,
    timeout: PROBE_TIMEOUT_MS,
  })
  const errors = []
  for (const model of models) {
    try {
      await withTimeout(
        client.chat.completions.create(buildPingParams(provider, model)),
        PROBE_TIMEOUT_MS,
        provider,
      )
      return { provider, model, pConfig }
    } catch (err) {
      if (isProviderAuthError(err)) throw err
      errors.push(`${model}: ${getProviderErrorMessage(err)}`)
    }
  }
  throw new Error(`${provider} validation failed for models ${models.join(', ')}: ${errors.join(' | ')}`)
}

async function detectProvider(OpenAI, apiKey, requestedModel) {
  const providers = getProvidersForAutoDetect()
  const errors = []

  return await new Promise((resolve, reject) => {
    let pending = providers.length
    for (const [provider] of providers) {
      probeProvider(OpenAI, provider, apiKey, requestedModel)
        .then(resolve)
        .catch((err) => {
          errors.push(`${provider}: ${getProviderErrorMessage(err)}`)
          pending -= 1
          if (pending === 0) {
            reject(new Error(`Could not identify the provider for this API key. Tried: ${providers.map(([name]) => name).join(', ')}. Last errors: ${errors.slice(-3).join(' | ')}`))
          }
        })
    }
  })
}

// 旧版本用过、之后被改名/合并的 provider id → 现行 id。
// 作用：升级后老 config.json 里的旧 provider 名不会再让整份 LLM 配置作废（见下方分块容错加载），
// 而是平滑映射到新名。目前无已知改名，留作扩展点——以后任何 provider 改名都往这里加一行。
const LEGACY_PROVIDER_ALIASES = {
  // 'oldName': MOONSHOT_PROVIDER,
}

function resolveProviderId(provider) {
  const p = String(provider || '').trim()
  if (p === 'custom' || PROVIDER_CONFIG[p]) return p
  return LEGACY_PROVIDER_ALIASES[p] || p
}

function getLlmConfigFile(provider) {
  const p = resolveProviderId(provider)
  if (p !== 'custom' && !PROVIDER_CONFIG[p]) return null
  return path.join(paths.llmConfigDir, `${p}.json`)
}

function readLlmProviderConfig(provider) {
  const file = getLlmConfigFile(provider)
  if (!file) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return (parsed && typeof parsed === 'object') ? parsed : null
  } catch {
    return null
  }
}

function writeLlmProviderConfig(provider, record) {
  const file = getLlmConfigFile(provider)
  if (!file) throw new Error(`Unsupported provider: "${provider}"`)
  const tmp = `${file}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf-8')
  fs.renameSync(tmp, file)
}

function resolveLlmRecord(raw, fallbackProvider) {
  if (!raw || typeof raw !== 'object') return null
  const provider = resolveProviderId(raw.provider || fallbackProvider)
  if (provider === 'custom') {
    if (typeof raw.baseURL !== 'string' || !raw.baseURL) return null
    if (typeof raw.model !== 'string' || !raw.model) return null
    return {
      provider,
      apiKey: typeof raw.apiKey === 'string' && raw.apiKey ? raw.apiKey : 'none',
      model: raw.model,
      baseURL: raw.baseURL,
    }
  }
  if (!PROVIDER_CONFIG[provider]) return null
  if (typeof raw.apiKey !== 'string' || !raw.apiKey) return null
  return { provider, apiKey: raw.apiKey, model: raw.model, baseURL: raw.baseURL }
}


// 判断旧版 config.json 里的 LLM 块能否直接激活（provider/apiKey/custom 三件套齐全）。
// 返回规整后的 { provider, apiKey, model, baseURL }（provider 已过别名映射）；不可用则返回 null。
function resolveLegacyStoredLlm(parsed) {
  if (!parsed || !parsed.provider) return null
  return resolveLlmRecord(parsed, parsed.provider)
}

function resolveStoredLlmForProvider(provider) {
  const p = resolveProviderId(provider)
  return resolveLlmRecord(readLlmProviderConfig(p), p)
}

function resolveStoredLlm(parsed) {
  if (!parsed || !parsed.provider) return null
  const provider = resolveProviderId(parsed.provider)
  return resolveStoredLlmForProvider(provider) || resolveLegacyStoredLlm(parsed)
}


function withoutLegacyLlmFields(obj) {
  const {
    apiKey: _apiKey,
    model: _model,
    baseURL: _baseURL,
    activatedAt: _activatedAt,
    ...rest
  } = obj || {}
  return rest
}

function writeActiveLlmProvider(provider) {
  const base = withoutLegacyLlmFields(readExistingStoredConfig())
  writeStoredConfig({
    ...base,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    provider,
  })
}

function persistLlmProviderConfig(record) {
  const provider = resolveProviderId(record?.provider)
  if (provider === 'custom') {
    writeLlmProviderConfig('custom', {
      provider: 'custom',
      apiKey: String(record.apiKey || '').trim() || 'none',
      model: String(record.model || '').trim(),
      baseURL: String(record.baseURL || '').trim(),
      activatedAt: record.activatedAt || new Date().toISOString(),
    })
    return
  }

  const pConfig = PROVIDER_CONFIG[provider]
  if (!pConfig) throw new Error(`Unsupported provider: "${provider}"`)
  writeLlmProviderConfig(provider, {
    provider,
    apiKey: String(record.apiKey || '').trim(),
    model: normalizeModel(record.model, provider),
    baseURL: undefined,
    activatedAt: record.activatedAt || new Date().toISOString(),
  })
}

function shouldAllowEnvFallback() {
  return !process.versions?.electron
}

function loadFromEnv() {
  const deepseekKey = process.env['DEEPSEEK_API_KEY']
  if (deepseekKey) {
    return {
      provider: DEEPSEEK_PROVIDER,
      apiKey: deepseekKey,
      model: normalizeModel(process.env.DEEPSEEK_MODEL, DEEPSEEK_PROVIDER),
    }
  }
  const minimaxKey = process.env['MINIMAX_API_KEY']
  if (minimaxKey) {
    return {
      provider: MINIMAX_PROVIDER,
      apiKey: minimaxKey,
      model: normalizeModel(process.env.MINIMAX_MODEL, MINIMAX_PROVIDER),
    }
  }
  for (const [provider, pConfig] of Object.entries(PROVIDER_CONFIG)) {
    if (provider === DEEPSEEK_PROVIDER || provider === MINIMAX_PROVIDER) continue
    const key = process.env[pConfig.envVar]
    if (key) {
      return {
        provider,
        apiKey: key,
        model: normalizeModel(process.env[`${pConfig.envVar.replace(/_API_KEY$/, '')}_MODEL`], provider),
      }
    }
  }
  return null
}

function applyConfig(provider, apiKey, model, customBaseURL) {
  if (provider === 'custom') {
    config.provider = 'custom'
    config.model = String(model || '').trim()
    config.apiKey = apiKey || 'none'
    config.baseURL = String(customBaseURL || '').trim()
    config.needsActivation = false
    return
  }
  const pConfig = PROVIDER_CONFIG[provider]
  config.provider = provider
  config.model = normalizeModel(model, provider)
  config.apiKey = apiKey
  config.baseURL = pConfig.baseURL
  config.needsActivation = false
}

// ── config.json schema 版本与迁移 ──
// 仿 db.js 的迁移规范：config.json 带一个 schemaVersion 字段，启动时按版本号顺序跑迁移、
// 跑完写回新版本号。把历史上零散、惰性触发的"一次性迁移"（如 seedance 拆分）收编到这里，
// 让升级路径确定、可测、可追溯，而不是散落在各 getter 里。
// 加新迁移：CONFIG_SCHEMA_VERSION 加 1，并在 CONFIG_MIGRATIONS 里补上对应版本号的函数。
const CONFIG_SCHEMA_VERSION = 2

// 每个迁移把传入的 config 对象升一级，返回新对象。允许带幂等副作用（如写独立文件）。
const CONFIG_MIGRATIONS = {
  // v0 → v1：把旧版塞在 config.json 里的 seedance 块拆到独立的 seedance.json，
  // 并从主配置移除该字段。等价于 migrateLegacySeedance，收编为正式、确定性的启动迁移。
  1(cfg) {
    const legacy = cfg?.seedance
    if (legacy && typeof legacy === 'object' && !fs.existsSync(paths.seedanceConfigFile)) {
      // 失败则抛出 → runConfigMigrations 中止且不写回版本号，下次启动重试（原子语义）。
      // 已存在 seedance.json 时跳过写入即可（幂等），剥离字段照常进行。
      writeSeedanceFile(legacy)
    }
    const { seedance: _drop, ...rest } = cfg
    return rest
  },
  // v1 → v2：LLM 凭据按 provider 拆到 userData/llm/<provider>.json。
  // config.json 只保留当前 provider 指针和 temperature/security/voice 等通用块。
  2(cfg) {
    const legacyLlm = resolveLegacyStoredLlm(cfg)
    if (legacyLlm) {
      const targetFile = getLlmConfigFile(legacyLlm.provider)
      if (targetFile && !fs.existsSync(targetFile)) {
        persistLlmProviderConfig({
          ...legacyLlm,
          activatedAt: cfg.activatedAt,
        })
      }
    }
    return withoutLegacyLlmFields(cfg)
  },
}

// 启动时执行一次。文件缺失/损坏则跳过（无可迁移）；任一迁移抛错则中止且不写回，
// 保留原文件，下次启动重试——宁可不迁，不可写坏。
function runConfigMigrations() {
  const parsed = readParsedConfig()
  if (!parsed) return
  const from = Number.isInteger(parsed.schemaVersion) ? parsed.schemaVersion : 0
  if (from >= CONFIG_SCHEMA_VERSION) return
  let cfg = parsed
  for (let v = from + 1; v <= CONFIG_SCHEMA_VERSION; v++) {
    const fn = CONFIG_MIGRATIONS[v]
    if (!fn) continue
    try { cfg = fn(cfg) || cfg }
    catch (e) { console.warn(`[config] schema 迁移 v${v} 失败，已中止并保留原文件:`, e.message); return }
  }
  cfg.schemaVersion = CONFIG_SCHEMA_VERSION
  try {
    writeStoredConfig(cfg)
    console.log(`[config] config.json schema 已从 v${from} 迁移到 v${CONFIG_SCHEMA_VERSION}`)
  } catch (e) {
    console.warn('[config] 写回迁移后的 config.json 失败:', e.message)
  }
}

export const config = {
  tickInterval: 20 * 60 * 1000,
  provider: null,
  model: null,
  apiKey: null,
  baseURL: null,
  needsActivation: true,
  temperature: 0.5,
  // 思考模式开关：true=向 provider 传 thinking enabled（深度由模型自控），false=thinking disabled。
  // 默认关闭——只有用户在设置里显式开启才思考。这是「用户显式选择」的开关，
  // 不是 runtime 按难度替模型决定开关 reasoning（那条路 index.js 已注释外掉）。
  thinking: false,
  // 上下文窗口：聊天消息条数上限 + 工具调用条数上限（工具上限必须严格小于聊天上限）
  contextWindow: {
    chatMessageLimit: 20,
    toolCallLimit: 5,
  },
  // 心跳（idle heartbeat）配置
  heartbeat: {
    enabled: true,
    defaultIntervalMinutes: 20,
    updatedAt: null,
  },
  security: {
    fileSandbox: true,
    execSandbox: true,
    blockedTools: [],
    updatedAt: null,
  },
}

// 迁移必须在下面读取/加载 config.json 之前跑完，确保后续逻辑看到的是已升级的结构。
runConfigMigrations()

// 加载顺序刻意分块容错：先无条件吃下 temperature / security 等"兄弟字段"，
// 再单独判断 LLM 块能否激活。这样即便 LLM 块因 provider 改名/缺字段而不可用，
// 也不会连带把沙盒开关、温度等其它配置一起重置——升级后最常见的"配置全没了"根因。
const parsedConfig = readParsedConfig()
if (parsedConfig) {
  if (typeof parsedConfig.temperature === 'number' && parsedConfig.temperature >= 0 && parsedConfig.temperature <= 2) {
    config.temperature = parsedConfig.temperature
  }
  // 缺字段（旧版升级 / 未开启过）按默认 false 处理 —— 无需 schema 迁移。
  if (typeof parsedConfig.thinking === 'boolean') {
    config.thinking = parsedConfig.thinking
  }
  if (parsedConfig.security && typeof parsedConfig.security === 'object') {
    const s = parsedConfig.security
    if (typeof s.fileSandbox === 'boolean') config.security.fileSandbox = s.fileSandbox
    if (typeof s.execSandbox === 'boolean') config.security.execSandbox = s.execSandbox
    if (Array.isArray(s.blockedTools)) config.security.blockedTools = s.blockedTools
    if (typeof s.updatedAt === 'string') config.security.updatedAt = s.updatedAt
  }
}

const storedLlm = resolveStoredLlm(parsedConfig)
if (storedLlm) {
  applyConfig(storedLlm.provider, storedLlm.apiKey, storedLlm.model, storedLlm.baseURL)
  if (storedLlm.provider !== 'custom' && storedLlm.model) {
    const normalized = normalizeModel(storedLlm.model, storedLlm.provider)
    if (normalized !== storedLlm.model) {
      console.warn(`[config] 已存模型 "${storedLlm.model}" 不在 ${storedLlm.provider} 当前列表，已回退到默认 "${normalized}"`)
    }
  }
} else if (shouldAllowEnvFallback()) {
  const fromEnv = loadFromEnv()
  if (fromEnv) applyConfig(fromEnv.provider, fromEnv.apiKey, fromEnv.model)
}

// At startup, copy social credentials from the config file into process.env so connectors can read them
;(function loadSocialEnv() {
  try {
    const raw = fs.readFileSync(paths.configFile, 'utf-8')
    const social = JSON.parse(raw)?.social || {}
    for (const [key, val] of Object.entries(social)) {
      if (typeof val === 'string' && val && globalThis.process?.env) {
        globalThis.process.env[key] = val
      }
    }
  } catch {}
})()

export async function prepareActivation({ provider = AUTO_PROVIDER, apiKey, model, baseURL }) {
  const p = String(provider || AUTO_PROVIDER).toLowerCase()

  if (p === 'custom') {
    const normalizedBaseURL = String(baseURL || '').trim()
    if (!normalizedBaseURL) throw new Error('Custom endpoint requires a Base URL')
    const normalizedModel = String(model || '').trim()
    if (!normalizedModel) throw new Error('Custom endpoint requires a model name')
    const normalizedKey = String(apiKey || '').trim() || 'none'

    const { default: OpenAI } = await import('openai')
    const client = new OpenAI({ apiKey: normalizedKey, baseURL: normalizedBaseURL, timeout: PROBE_TIMEOUT_MS })
    try {
      await withTimeout(
        client.chat.completions.create({
          model: normalizedModel,
          messages: [{ role: 'user', content: 'Reply with exactly: hello' }],
          max_tokens: 16,
          temperature: 0,
          stream: false,
        }),
        PROBE_TIMEOUT_MS,
        'custom',
      )
    } catch (err) {
      const message = err?.message || String(err)
      throw new Error(`Custom endpoint connection failed: ${message}`)
    }

    return {
      provider: 'custom',
      apiKey: normalizedKey,
      model: normalizedModel,
      baseURL: normalizedBaseURL,
      models: [{ id: normalizedModel, label: normalizedModel, deprecated: false }],
    }
  }

  const pConfig = PROVIDER_CONFIG[p]
  if (p !== AUTO_PROVIDER && !pConfig) {
    throw new Error(`Unsupported provider: "${p}". Available: ${Object.keys(PROVIDER_CONFIG).join(', ')}`)
  }

  const normalizedKey = String(apiKey || '').trim()
  const normalizedModel = normalizeModel(model, p)
  if (normalizedKey.length < 8) {
    throw new Error(`${p} key is invalid`)
  }

  const { default: OpenAI } = await import('openai')
  if (p === AUTO_PROVIDER) {
    const detected = await detectProvider(OpenAI, normalizedKey, model)
    return {
      provider: detected.provider,
      apiKey: normalizedKey,
      model: detected.model,
      baseURL: undefined,
      models: detected.pConfig.models,
    }
  }

  let detected
  try {
    detected = await probeProvider(OpenAI, p, normalizedKey, normalizedModel)
  } catch (err) {
    const message = err?.message || String(err)
    if (/401|unauthoriz|invalid.*api.*key|authentication/i.test(message)) {
      throw new Error(`${p} key validation failed — please check that the key is correct`)
    }
    throw new Error(`${p} validation failed: ${message}`)
  }

  return {
    provider: p,
    apiKey: normalizedKey,
    model: detected.model,
    baseURL: undefined,
    models: pConfig.models,
  }
}

export function commitPreparedActivation(prepared) {
  const p = String(prepared?.provider || '').toLowerCase()

  if (p === 'custom') {
    const normalizedBaseURL = String(prepared.baseURL || '').trim()
    const normalizedModel = String(prepared.model || '').trim()
    const normalizedKey = String(prepared.apiKey || '').trim() || 'none'
    if (!normalizedBaseURL) throw new Error('Custom endpoint requires a Base URL')
    if (!normalizedModel) throw new Error('Custom endpoint requires a model name')

    applyConfig('custom', normalizedKey, normalizedModel, normalizedBaseURL)
    persistLlmProviderConfig({
      provider: 'custom',
      apiKey: normalizedKey,
      model: normalizedModel,
      baseURL: normalizedBaseURL,
      activatedAt: new Date().toISOString(),
    })
    writeActiveLlmProvider('custom')
    return {
      provider: 'custom',
      model: normalizedModel,
      models: [{ id: normalizedModel, label: normalizedModel, deprecated: false }],
    }
  }

  const pConfig = PROVIDER_CONFIG[p]
  if (!pConfig) {
    throw new Error(`Unsupported provider: "${p}". Available: ${Object.keys(PROVIDER_CONFIG).join(', ')}`)
  }

  const normalizedKey = String(prepared.apiKey || '').trim()
  const normalizedModel = normalizeModel(prepared.model, p)
  if (normalizedKey.length < 8) {
    throw new Error(`${p} key is invalid`)
  }

  applyConfig(p, normalizedKey, normalizedModel)
  persistLlmProviderConfig({
    provider: p,
    apiKey: normalizedKey,
    model: normalizedModel,
    activatedAt: new Date().toISOString(),
  })
  writeActiveLlmProvider(p)

  return {
    provider: p,
    model: normalizedModel,
    models: pConfig.models,
  }
}

export async function activate({ provider = AUTO_PROVIDER, apiKey, model, baseURL }) {
  const prepared = await prepareActivation({ provider, apiKey, model, baseURL })
  return commitPreparedActivation(prepared)
}

export function getActivationStatus() {
  const pConfig = config.provider && config.provider !== 'custom' ? PROVIDER_CONFIG[config.provider] : null
  const customModels = config.model ? [{ id: config.model, label: config.model, deprecated: false }] : DEEPSEEK_MODELS
  return {
    activated: !config.needsActivation,
    provider: config.provider,
    model: config.model,
    baseURL: config.provider === 'custom' ? config.baseURL : undefined,
    models: pConfig ? pConfig.models : customModels,
    defaultModel: pConfig ? pConfig.defaultModel : (config.model || DEFAULT_DEEPSEEK_MODEL),
  }
}

export function getProviderSummaries() {
  const result = Object.fromEntries(Object.entries(PROVIDER_CONFIG).map(([name, pConfig]) => [
    name,
    (() => {
      const stored = resolveStoredLlmForProvider(name)
      return {
      label: pConfig.label || name,
      models: pConfig.models,
      defaultModel: pConfig.defaultModel,
      configured: !!stored,
      apiKey: stored?.apiKey || '',
      model: stored?.model ? normalizeModel(stored.model, name) : pConfig.defaultModel,
    }
    })(),
  ]))
  const custom = resolveStoredLlmForProvider('custom')
  result.custom = {
    label: 'Custom Endpoint',
    models: [],
    defaultModel: '',
    configured: !!custom,
    apiKey: custom?.apiKey || '',
    model: custom?.model || '',
    baseURL: custom?.baseURL || '',
  }
  return result
}

export function deactivate() {
  try {
    if (fs.existsSync(paths.configFile)) fs.unlinkSync(paths.configFile)
  } catch {}
  config.provider = null
  config.model = null
  config.apiKey = null
  config.baseURL = null
  config.needsActivation = true
}

export function switchModel(model) {
  if (!config.apiKey) throw new Error('Not activated — cannot switch model')
  if (config.provider === 'custom') {
    const trimmed = String(model || '').trim()
    if (!trimmed) throw new Error('Model name cannot be empty')
    config.model = trimmed
    persistLlmProviderConfig({
      provider: 'custom',
      apiKey: config.apiKey,
      model: trimmed,
      baseURL: config.baseURL,
      activatedAt: readLlmProviderConfig('custom')?.activatedAt,
    })
    return { provider: 'custom', model: trimmed }
  }
  const normalized = normalizeModel(model, config.provider)
  config.model = normalized
  persistLlmProviderConfig({
    provider: config.provider,
    apiKey: config.apiKey,
    model: normalized,
    activatedAt: readLlmProviderConfig(config.provider)?.activatedAt,
  })
  return { provider: config.provider, model: normalized }
}

export function switchProviderConfig({ provider, model } = {}) {
  const p = resolveProviderId(provider)
  if (p === AUTO_PROVIDER) throw new Error('Auto-detect requires an API key')
  const stored = resolveStoredLlmForProvider(p)
  if (!stored) {
    throw new Error(`No saved ${p} configuration. Enter the API key once to save it.`)
  }

  if (p === 'custom') {
    const nextModel = String(model || stored.model || '').trim()
    if (!nextModel) throw new Error('Model name cannot be empty')
    applyConfig('custom', stored.apiKey || 'none', nextModel, stored.baseURL)
    persistLlmProviderConfig({
      provider: 'custom',
      apiKey: stored.apiKey || 'none',
      model: nextModel,
      baseURL: stored.baseURL,
      activatedAt: readLlmProviderConfig('custom')?.activatedAt,
    })
    writeActiveLlmProvider('custom')
    return {
      provider: 'custom',
      model: nextModel,
      models: [{ id: nextModel, label: nextModel, deprecated: false }],
    }
  }

  const nextModel = normalizeModel(model || stored.model, p)
  applyConfig(p, stored.apiKey, nextModel)
  persistLlmProviderConfig({
    provider: p,
    apiKey: stored.apiKey,
    model: nextModel,
    activatedAt: readLlmProviderConfig(p)?.activatedAt,
  })
  writeActiveLlmProvider(p)
  return {
    provider: p,
    model: nextModel,
    models: PROVIDER_CONFIG[p].models,
  }
}

export async function saveLLMSettings({ provider = AUTO_PROVIDER, apiKey, model, baseURL } = {}) {
  const p = String(provider || AUTO_PROVIDER).toLowerCase()
  const trimmedKey = String(apiKey || '').trim()

  if (p === 'custom') {
    const stored = resolveStoredLlmForProvider('custom')
    const nextKey = trimmedKey || stored?.apiKey || 'none'
    const nextModel = String(model || stored?.model || '').trim()
    const nextBaseURL = String(baseURL || stored?.baseURL || '').trim()
    const prepared = await prepareActivation({
      provider: 'custom',
      apiKey: nextKey,
      model: nextModel,
      baseURL: nextBaseURL,
    })
    return commitPreparedActivation(prepared)
  }

  if (trimmedKey || p === AUTO_PROVIDER) {
    if (!trimmedKey) throw new Error('API key is required to auto-detect a provider')
    const prepared = await prepareActivation({
      provider: p,
      apiKey: trimmedKey,
      model,
    })
    return commitPreparedActivation(prepared)
  }

  return switchProviderConfig({ provider: p, model })
}

export function setTemperature(t) {
  const v = Math.min(2, Math.max(0, Number(t) || 0.5))
  config.temperature = v
  patchConfig({ temperature: v })
  return { temperature: v }
}

export function setThinking(enabled) {
  const v = !!enabled
  config.thinking = v
  patchConfig({ thinking: v })
  return { thinking: v }
}

export function getSecurity() {
  return {
    fileSandbox: config.security.fileSandbox,
    execSandbox: config.security.execSandbox,
    blockedTools: [...config.security.blockedTools],
    updatedAt: config.security.updatedAt || null,
  }
}

export function setSecurity(updates) {
  const before = getSecurity()
  if (typeof updates.fileSandbox === 'boolean') config.security.fileSandbox = updates.fileSandbox
  if (typeof updates.execSandbox === 'boolean') config.security.execSandbox = updates.execSandbox
  if (Array.isArray(updates.blockedTools)) {
    config.security.blockedTools = updates.blockedTools.filter(t => typeof t === 'string')
  }
  const changed = before.fileSandbox !== config.security.fileSandbox
    || before.execSandbox !== config.security.execSandbox
    || JSON.stringify(before.blockedTools) !== JSON.stringify(config.security.blockedTools)
  if (changed) config.security.updatedAt = nowTimestamp()
  patchConfig({ security: { ...config.security } })
  return getSecurity()
}





// ── Embedding config ──────────────────────────────────────────────────────────
// Embedding 与 chat provider 完全独立。DeepSeek/Moonshot 没 embedding API，
// 所以必须分开存。结构：config.json 的 "embedding" 块。
//
// 字段：
//   provider:   'openai' | 'qwen' | 'zhipu' | 'minimax' | 'custom'
//   model:      模型名（参考 EMBEDDING_PROVIDER_PRESETS）
//   apiKey:     凭证（明文存储，与现有 chat apiKey 一样）
//   baseURL:    custom 时必填；其他 provider 留空走预设
//   dimensions: 可选，仅 OpenAI text-embedding-3-* 系列支持显式指定

const EMBEDDING_CONFIG_KEYS = ['provider', 'model', 'apiKey', 'baseURL', 'dimensions']

export const EMBEDDING_PROVIDER_PRESETS = {
  // 本地离线 embedding：transformers.js + onnxruntime-node 跑 Xenova/bge-large-zh-v1.5（1024 维）
  // 首次运行从 hf-mirror.com 下载 ~330MB 模型，之后完全离线。无需 apiKey/baseURL。
  local:   { baseURL: '',                                                   defaultModel: 'Xenova/bge-large-zh-v1.5', defaultDims: 1024 },
  openai:  { baseURL: 'https://api.openai.com/v1',                          defaultModel: 'text-embedding-3-small', defaultDims: 1536 },
  qwen:    { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',  defaultModel: 'text-embedding-v2',      defaultDims: 1536 },
  zhipu:   { baseURL: 'https://open.bigmodel.cn/api/paas/v4',               defaultModel: 'embedding-3',            defaultDims: 2048 },
  minimax: { baseURL: 'https://api.minimax.chat/v1',                        defaultModel: 'embo-01',                defaultDims: 1536 },
  custom:  { baseURL: '',                                                   defaultModel: '',                       defaultDims: 1536 },
}

let _embeddingBlockCache = null
let _embeddingBlockCacheMtime = -1

function readEmbeddingBlock() {
  let mtime = -1
  try {
    mtime = fs.statSync(paths.configFile).mtimeMs
  } catch {
    // config 文件不存在或访问失败：直接返回 {}，不缓存（让下次有机会重试）
    return {}
  }

  if (_embeddingBlockCache !== null && mtime === _embeddingBlockCacheMtime) {
    return _embeddingBlockCache
  }

  let block = {}
  try {
    const raw = JSON.parse(fs.readFileSync(paths.configFile, 'utf-8'))
    if (raw?.embedding && typeof raw.embedding === 'object') {
      block = raw.embedding
    }
  } catch {
    block = {}
  }

  _embeddingBlockCache = block
  _embeddingBlockCacheMtime = mtime
  return block
}

// 前端可见视图：不暴露 apiKey 明文，只暴露 configured 布尔
export function getEmbeddingConfig() {
  const stored = readEmbeddingBlock()
  const provider = typeof stored.provider === 'string' ? stored.provider : ''
  const model    = typeof stored.model === 'string'    ? stored.model    : ''
  const baseURL  = typeof stored.baseURL === 'string'  ? stored.baseURL  : ''
  const dimensions = Number.isFinite(stored.dimensions) ? stored.dimensions : null
  const configured = provider === 'local' ? !!model : !!(stored.apiKey && model)
  return { provider, model, baseURL, dimensions, configured }
}

// Backend-only：读明文 apiKey。供 src/embedding.js 内部用，不要给前端。
export function getEmbeddingCredentials() {
  const stored = readEmbeddingBlock()
  const provider = typeof stored.provider === 'string' ? stored.provider : ''
  let baseURL = typeof stored.baseURL === 'string' && stored.baseURL ? stored.baseURL : ''
  if (!baseURL && provider && EMBEDDING_PROVIDER_PRESETS[provider]) {
    baseURL = EMBEDDING_PROVIDER_PRESETS[provider].baseURL || ''
  }
  return {
    provider,
    model:      typeof stored.model === 'string'  ? stored.model  : '',
    apiKey:     typeof stored.apiKey === 'string' ? stored.apiKey : '',
    baseURL,
    dimensions: Number.isFinite(stored.dimensions) ? stored.dimensions : null,
  }
}

export function setEmbeddingConfig(updates) {
  const existing = readExistingStoredConfig()
  const current = existing.embedding || {}
  const next = { ...current }
  for (const [key, val] of Object.entries(updates || {})) {
    if (!EMBEDDING_CONFIG_KEYS.includes(key)) continue
    if (key === 'dimensions') {
      const n = Number(val)
      if (Number.isFinite(n) && n > 0) next.dimensions = n
      else delete next.dimensions
      continue
    }
    const trimmed = String(val || '').trim()
    if (trimmed) next[key] = trimmed
    else delete next[key]
  }
  writeStoredConfig({ ...existing, embedding: next })
}


export const __internals = {
  DEEPSEEK_MODELS,
  MINIMAX_MODELS,
  OPENAI_MODELS,
  QWEN_MODELS,
  MOONSHOT_MODELS,
  ZHIPU_MODELS,
  MIMO_MODELS,
  getProviderModelFallbacks,
  normalizeModel,
  isThinkingEnabledForModel,
  buildPingParams,
}

// ── 上下文窗口 / 心跳 配置 ──────────────────────────────────────────────
export const CONTEXT_MESSAGE_LIMIT_MIN = 1
export const CONTEXT_MESSAGE_LIMIT_MAX = 40
export const CONTEXT_TOOL_LIMIT_MIN = 0

export function getContextWindowConfig() {
  return {
    chatMessageLimit: config.contextWindow.chatMessageLimit,
    toolCallLimit: config.contextWindow.toolCallLimit,
  }
}

export function setContextWindowConfig(updates = {}) {
  const current = getContextWindowConfig()
  const next = {
    chatMessageLimit: Object.prototype.hasOwnProperty.call(updates, 'chatMessageLimit')
      ? Number(updates.chatMessageLimit) : current.chatMessageLimit,
    toolCallLimit: Object.prototype.hasOwnProperty.call(updates, 'toolCallLimit')
      ? Number(updates.toolCallLimit) : current.toolCallLimit,
  }
  if (!Number.isInteger(next.chatMessageLimit)) throw new Error('聊天消息条数必须是整数')
  if (next.chatMessageLimit < CONTEXT_MESSAGE_LIMIT_MIN || next.chatMessageLimit > CONTEXT_MESSAGE_LIMIT_MAX)
    throw new Error(`聊天消息条数必须在 ${CONTEXT_MESSAGE_LIMIT_MIN} 到 ${CONTEXT_MESSAGE_LIMIT_MAX} 之间`)
  if (!Number.isInteger(next.toolCallLimit)) throw new Error('工具调用条数必须是整数')
  if (next.toolCallLimit < CONTEXT_TOOL_LIMIT_MIN || next.toolCallLimit >= next.chatMessageLimit)
    throw new Error(`工具调用条数必须在 ${CONTEXT_TOOL_LIMIT_MIN} 到 ${next.chatMessageLimit - 1} 之间`)
  config.contextWindow = next
  patchConfig({ contextWindow: { ...next } })
  return getContextWindowConfig()
}

export function getHeartbeatConfig() {
  return {
    enabled: config.heartbeat.enabled !== false,
    defaultIntervalMinutes: config.heartbeat.defaultIntervalMinutes,
    defaultIntervalMs: config.tickInterval,
    updatedAt: config.heartbeat.updatedAt || null,
  }
}

export function setHeartbeatConfig(updates = {}) {
  const before = getHeartbeatConfig()
  const next = {
    enabled: config.heartbeat.enabled,
    defaultIntervalMinutes: config.heartbeat.defaultIntervalMinutes,
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'enabled')) {
    if (typeof updates.enabled !== 'boolean') throw new Error('心跳开关必须是布尔值')
    next.enabled = updates.enabled
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'defaultIntervalMinutes')) {
    const raw = Number(updates.defaultIntervalMinutes)
    if (!Number.isInteger(raw)) throw new Error('默认心跳间隔必须是整数分钟')
    if (raw < 1 || raw > 1440) throw new Error('默认心跳间隔必须在 1 到 1440 分钟之间')
    next.defaultIntervalMinutes = raw
  }
  const changed = before.enabled !== next.enabled || before.defaultIntervalMinutes !== next.defaultIntervalMinutes
  config.heartbeat.enabled = next.enabled
  config.heartbeat.defaultIntervalMinutes = next.defaultIntervalMinutes
  config.tickInterval = next.defaultIntervalMinutes * 60 * 1000
  if (changed) config.heartbeat.updatedAt = nowTimestamp()
  patchConfig({ heartbeat: { ...config.heartbeat } })
  return getHeartbeatConfig()
}
