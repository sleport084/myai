import fs from 'fs'
import { paths } from '../paths.js'
import { readExistingStoredConfig, writeStoredConfig } from './shared.js'

const WEB_SEARCH_KEY_MAP = {
  serperKey:  'serper_api_key',
  searxngUrl: 'searxng_url',
  jinaKey:    'jina_api_key',
  braveKey:   'brave_api_key',
  tavilyKey:  'tavily_api_key',
}

function readWebSearchBlock() {
  try {
    const raw = JSON.parse(fs.readFileSync(paths.configFile, 'utf-8'))
    return {
      serperKey:  typeof raw.serper_api_key === 'string' ? raw.serper_api_key : '',
      searxngUrl: typeof raw.searxng_url    === 'string' ? raw.searxng_url    : '',
      jinaKey:    typeof raw.jina_api_key   === 'string' ? raw.jina_api_key   : '',
      braveKey:   typeof raw.brave_api_key  === 'string' ? raw.brave_api_key  : '',
      tavilyKey:  typeof raw.tavily_api_key === 'string' ? raw.tavily_api_key : '',
    }
  } catch {
    return { serperKey: '', searxngUrl: '', jinaKey: '', braveKey: '', tavilyKey: '' }
  }
}

// 前端可见视图：不暴露 key 明文，只暴露 configured 布尔 + searxngUrl（URL 不算敏感）
// configured 同时考虑 env 兜底，避免"env 里有 key 但 UI 标未配置"的误导
// xxxFromEnv 提示来源，让 UI 标注"已配置（环境变量）"，并暗示清空输入框不会真正生效
export function getWebSearchConfig() {
  const stored = readWebSearchBlock()
  const envSerper  = process.env.SERPER_API_KEY || ''
  const envJina    = process.env.JINA_API_KEY   || ''
  const envSearxng = process.env.SEARXNG_URL    || ''
  const envBrave   = process.env.BRAVE_API_KEY  || ''
  const envTavily  = process.env.TAVILY_API_KEY || ''
  return {
    serperConfigured: !!(stored.serperKey  || envSerper),
    jinaConfigured:   !!(stored.jinaKey    || envJina),
    braveConfigured:  !!(stored.braveKey   || envBrave),
    tavilyConfigured: !!(stored.tavilyKey  || envTavily),
    searxngUrl:       stored.searxngUrl,
    effectiveSearxngUrl: stored.searxngUrl || envSearxng,
    serperFromEnv:    !stored.serperKey  && !!envSerper,
    jinaFromEnv:      !stored.jinaKey    && !!envJina,
    braveFromEnv:     !stored.braveKey   && !!envBrave,
    tavilyFromEnv:    !stored.tavilyKey  && !!envTavily,
    searxngFromEnv:   !stored.searxngUrl && !!envSearxng,
  }
}

// Backend-only：读明文 key。供 src/capabilities/executor.js 内部用，不要给前端
export function getWebSearchCredentials() {
  const stored = readWebSearchBlock()
  return {
    serperKey:  stored.serperKey  || process.env.SERPER_API_KEY || '',
    searxngUrl: stored.searxngUrl || process.env.SEARXNG_URL    || '',
    jinaKey:    stored.jinaKey    || process.env.JINA_API_KEY   || '',
    braveKey:   stored.braveKey   || process.env.BRAVE_API_KEY  || '',
    tavilyKey:  stored.tavilyKey  || process.env.TAVILY_API_KEY || '',
  }
}

export function setWebSearchConfig(updates) {
  const existing = readExistingStoredConfig()
  const next = { ...existing }
  for (const [key, val] of Object.entries(updates || {})) {
    const cfgField = WEB_SEARCH_KEY_MAP[key]
    if (!cfgField) continue
    const trimmed = String(val || '').trim()
    if (key === 'searxngUrl' && trimmed && !/^https?:\/\//i.test(trimmed)) {
      throw new Error('searxngUrl must start with http:// or https://')
    }
    if (trimmed) next[cfgField] = trimmed
    else delete next[cfgField]
  }
  writeStoredConfig(next)
}
