import fs from 'fs'
import { paths } from '../paths.js'
import { readExistingStoredConfig, writeStoredConfig, patchConfig, DEEPSEEK_PROVIDER, MINIMAX_PROVIDER, OPENAI_PROVIDER, MOONSHOT_PROVIDER, ZHIPU_PROVIDER, MIMO_PROVIDER } from './shared.js'

const VOICE_CONFIG_KEYS = [
  'voiceProvider',
  'aliyunApiKey',
  'tencentSecretId', 'tencentSecretKey', 'tencentAppId',
  'xunfeiAppId', 'xunfeiApiKey', 'xunfeiApiSecret',
  'volcAsrApiKey', 'volcAsrAppKey', 'volcAsrAccessKey', 'volcAsrResourceId',
  'customAsrUrl', 'customAsrKey', 'customAsrModel',
]

function isValidAliyunAsrKey(value) {
  return /^sk-[A-Za-z0-9_\-.]{20,}$/.test(String(value || '').trim())
}

const CHAT_PROVIDERS_WITH_AMBIGUOUS_SK_KEYS = new Set([
  DEEPSEEK_PROVIDER,
  MINIMAX_PROVIDER,
  OPENAI_PROVIDER,
  MOONSHOT_PROVIDER,
  ZHIPU_PROVIDER,
  MIMO_PROVIDER,
])

export function getVoiceConfig() {
  let stored = {}
  try { stored = JSON.parse(fs.readFileSync(paths.configFile, 'utf-8'))?.voice || {} } catch {}
  const result = { voiceProvider: stored.voiceProvider || 'aliyun' }
  for (const key of VOICE_CONFIG_KEYS) {
    if (key === 'voiceProvider') continue
    result[key] = { configured: !!(stored[key]) }
    if (key === 'aliyunApiKey' && stored[key]) {
      result[key] = {
        configured: isValidAliyunAsrKey(stored[key]),
        invalidFormat: !isValidAliyunAsrKey(stored[key]),
      }
    }
  }
  return result
}

export function setVoiceConfig(updates) {
  const existing = readExistingStoredConfig()
  const current = existing.voice || {}
  const next = { ...current }
  for (const [key, val] of Object.entries(updates)) {
    if (!VOICE_CONFIG_KEYS.includes(key)) continue
    const trimmed = String(val || '').trim()
    if (key === 'aliyunApiKey' && trimmed && !isValidAliyunAsrKey(trimmed)) {
      console.warn('[voice-config] Ignoring invalid Aliyun ASR key format; expected DashScope sk-* API key')
      continue
    }
    if (
      key === 'aliyunApiKey' &&
      trimmed &&
      existing.apiKey &&
      trimmed === existing.apiKey &&
      CHAT_PROVIDERS_WITH_AMBIGUOUS_SK_KEYS.has(existing.provider)
    ) {
      console.warn('[voice-config] Ignoring Aliyun ASR key because it matches the active chat provider API key')
      continue
    }
    if (trimmed) next[key] = trimmed
    else delete next[key]
  }
  writeStoredConfig({ ...existing, voice: next })
}

// TTS config
const TTS_CONFIG_KEYS = [
  'ttsProvider', 'ttsVoiceId',
  'minimaxKey',
  'doubaoKey', 'doubaoAppId', 'doubaoAccessKey', 'doubaoResourceId', 'doubaoStyle', 'doubaoSpeechRate',
  'openaiTtsKey', 'openaiTtsBaseURL',
  'elevenLabsKey',
  'volcanoAppId', 'volcanoToken',
  'customTtsUrl', 'customTtsKey', 'customTtsModel',
]

export function getMinimaxKey() {
  try {
    const raw = fs.readFileSync(paths.configFile, 'utf-8')
    const parsed = JSON.parse(raw)
    return typeof parsed?.minimax_api_key === 'string' ? parsed.minimax_api_key : null
  } catch { return null }
}

export function setMinimaxKey(key) {
  const trimmed = String(key || '').trim()
  if (trimmed) {
    patchConfig({ minimax_api_key: trimmed })
  } else {
    const { minimax_api_key: _removed, ...rest } = readExistingStoredConfig()
    writeStoredConfig(rest)
  }
}

export function getTTSConfig() {
  let stored = {}
  try { stored = JSON.parse(fs.readFileSync(paths.configFile, 'utf-8'))?.tts || {} } catch {}
  return {
    ttsProvider:     stored.ttsProvider  || 'doubao',
    ttsVoiceId:      stored.ttsVoiceId   || 'zh_female_xiaohe_uranus_bigtts',
    minimaxKey:      { configured: !!(stored.minimaxKey || process.env.MINIMAX_API_KEY || getMinimaxKey()) },
    doubaoKey:       { configured: !!(stored.doubaoKey) },
    doubaoAppId:     { configured: !!(stored.doubaoAppId), value: stored.doubaoAppId || '' },
    doubaoAccessKey: { configured: !!(stored.doubaoAccessKey) },
    doubaoResourceId: stored.doubaoResourceId || '',
    doubaoStyle:     stored.doubaoStyle || '',
    doubaoSpeechRate: Number(stored.doubaoSpeechRate || 0) || 0,
    openaiTtsBaseURL: stored.openaiTtsBaseURL || '',
    openaiTtsKey:    { configured: !!(stored.openaiTtsKey) },
    elevenLabsKey:   { configured: !!(stored.elevenLabsKey) },
    volcanoAppId:    { configured: !!(stored.volcanoAppId), value: stored.volcanoAppId || '' },
    volcanoToken:    { configured: !!(stored.volcanoToken) },
    customTtsUrl:    stored.customTtsUrl || '',
    customTtsKey:    { configured: !!(stored.customTtsKey) },
    customTtsModel:  stored.customTtsModel || '',
  }
}

// Read plaintext TTS credentials (backend use only — not exposed to frontend)
export function getTTSCredentials() {
  let stored = {}
  try { stored = JSON.parse(fs.readFileSync(paths.configFile, 'utf-8'))?.tts || {} } catch {}
  return {
    provider:       stored.ttsProvider  || 'doubao',
    voiceId:        stored.ttsVoiceId   || 'zh_female_xiaohe_uranus_bigtts',
    doubaoKey:      stored.doubaoKey    || process.env.DOUBAO_TTS_API_KEY || '',
    doubaoAppId:    stored.doubaoAppId  || process.env.DOUBAO_TTS_APP_ID || '',
    doubaoAccessKey: stored.doubaoAccessKey || process.env.DOUBAO_TTS_ACCESS_KEY || '',
    doubaoResourceId: stored.doubaoResourceId || process.env.DOUBAO_TTS_RESOURCE_ID || '',
    doubaoStyle:    stored.doubaoStyle || process.env.DOUBAO_TTS_STYLE || '',
    doubaoSpeechRate: Number(stored.doubaoSpeechRate ?? process.env.DOUBAO_TTS_SPEECH_RATE ?? 0) || 0,
    minimaxKey:     process.env.MINIMAX_API_KEY || stored.minimaxKey || getMinimaxKey() || '',
    openaiKey:      stored.openaiTtsKey  || '',
    openaiBaseURL:  stored.openaiTtsBaseURL || '',
    elevenLabsKey:  stored.elevenLabsKey || '',
    volcanoAppId:   stored.volcanoAppId  || '',
    volcanoToken:   stored.volcanoToken  || '',
    customTtsUrl:   stored.customTtsUrl  || '',
    customTtsKey:   stored.customTtsKey  || '',
    customTtsModel: stored.customTtsModel || '',
  }
}

export function setTTSConfig(updates) {
  const existing = readExistingStoredConfig()
  const current = existing.tts || {}
  const next = { ...current }
  for (const [key, val] of Object.entries(updates)) {
    if (!TTS_CONFIG_KEYS.includes(key)) continue
    const trimmed = String(val || '').trim()
    if (trimmed) next[key] = trimmed
    else delete next[key]
  }
  writeStoredConfig({ ...existing, tts: next })
}
