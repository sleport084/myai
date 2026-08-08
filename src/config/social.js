import fs from 'fs'
import { paths } from '../paths.js'
import { readExistingStoredConfig, writeStoredConfig, patchConfig } from './shared.js'

const SOCIAL_ENV_KEYS = [
  'DISCORD_BOT_TOKEN',
  'FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_VERIFICATION_TOKEN',
  'WECHAT_OFFICIAL_APP_ID', 'WECHAT_OFFICIAL_APP_SECRET', 'WECHAT_OFFICIAL_TOKEN',
  'WECOM_BOT_KEY', 'WECOM_INCOMING_TOKEN',
]

export function getClawbotCredentials() {
  try {
    const stored = JSON.parse(fs.readFileSync(paths.configFile, 'utf-8'))
    const c = stored?.clawbot
    return (c?.accountId && c?.botToken) ? c : null
  } catch { return null }
}

export function setClawbotCredentials({ accountId, botToken, baseUrl }) {
  patchConfig({ clawbot: { accountId, botToken, baseUrl } })
}

export function clearClawbotCredentials() {
  const { clawbot: _, ...rest } = readExistingStoredConfig()
  writeStoredConfig(rest)
}

export function getSocialConfig() {
  let stored = {}
  try { stored = JSON.parse(fs.readFileSync(paths.configFile, 'utf-8'))?.social || {} } catch {}
  const result = {}
  for (const key of SOCIAL_ENV_KEYS) {
    const val = stored[key] || globalThis.process?.env?.[key] || ''
    result[key] = { configured: !!val }
  }
  return result
}

export function setSocialConfig(updates) {
  const existing = readExistingStoredConfig()
  const current = existing.social || {}
  const next = { ...current }
  for (const [key, val] of Object.entries(updates)) {
    if (!SOCIAL_ENV_KEYS.includes(key)) continue
    const trimmed = String(val || '').trim()
    if (trimmed) {
      next[key] = trimmed
      if (globalThis.process?.env) globalThis.process.env[key] = trimmed
    } else {
      delete next[key]
    }
  }
  writeStoredConfig({ ...existing, social: next })
}
