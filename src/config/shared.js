import fs from 'fs'
import { paths } from '../paths.js'

export const DEEPSEEK_PROVIDER = 'deepseek'
export const MINIMAX_PROVIDER = 'minimax'
export const OPENAI_PROVIDER = 'openai'
export const QWEN_PROVIDER = 'qwen'
export const MOONSHOT_PROVIDER = 'moonshot'
export const ZHIPU_PROVIDER = 'zhipu'
export const MIMO_PROVIDER = 'mimo'

// 只负责把 config.json 解析成对象；文件缺失或损坏才返回 null。
// 不在这里判断 LLM 块能否可用——那是加载逻辑的事，避免"一个字段不合法就丢掉整份文件、
// 连带把 voice/tts/security 等兄弟字段一起重置"（升级后最常见的"配置全没了"根因）。
export function readParsedConfig() {
  try {
    if (!fs.existsSync(paths.configFile)) return null
    const parsed = JSON.parse(fs.readFileSync(paths.configFile, 'utf-8'))
    return (parsed && typeof parsed === 'object') ? parsed : null
  } catch {
    return null
  }
}

export function writeStoredConfig(obj) {
  const tmp = paths.configFile + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8')
  fs.renameSync(tmp, paths.configFile)
}

// 读出 config.json 现有内容（失败返回空对象）。
// activate() 等写操作必须基于它合并，否则会抹掉 voice/tts/security 等其它字段。
export function readExistingStoredConfig() {
  try { return JSON.parse(fs.readFileSync(paths.configFile, 'utf-8')) || {} }
  catch { return {} }
}

// 顶级字段的"读-浅合并-写"一把梭。所有 setter 都该走它（或 readExistingStoredConfig），
// 把"写时必合并、绝不全量覆盖"变成不可绕过的约束，杜绝再次出现"改一个字段抹掉其它块"。
// 注意：浅合并无法删除键；需要删字段的 setter 仍自行 readExistingStoredConfig + 解构剔除后 writeStoredConfig。
export function patchConfig(partial) {
  const merged = { ...readExistingStoredConfig(), ...partial }
  writeStoredConfig(merged)
  return merged
}
