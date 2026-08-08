// Embedding module — 向量语义召回的"算 embedding"层。
//
// 设计目标：
//   1. 完全 lazy init：模块加载时不做任何 IO / 网络
//   2. 任何错误（401 / timeout / 网络 / provider 不支持）都吞掉返回 null，
//      让上层的 FTS5 召回继续工作，绝不影响主流程
//   3. 简易 LRU 缓存（Map 删除最旧项）— 不引入新依赖
//   4. 返回 Buffer（包裹 Float32Array 的字节），方便直接写入 SQLite BLOB
//
// 与 chat 的 provider 配置完全独立：embedding 块在 config.json 的 "embedding" 键下，
// 由 src/config.js 的 getEmbeddingConfig/setEmbeddingConfig 管理。

import crypto from 'crypto'
import { getEmbeddingCredentials } from './config.js'

const MAX_CACHE_ENTRIES = 200
const MIN_TEXT_LENGTH = 2

// LRU 缓存：key = sha256(text + '' + model)，value = Buffer
// 用 Map 的插入顺序近似 LRU：每次读到命中就 delete + set，让它移到尾部；
// 写入超限时删 Map.keys().next().value （最旧的 key）
const cache = new Map()

function cacheKey(text, model) {
  return crypto
    .createHash('sha256')
    .update(text + '' + (model || ''))
    .digest('hex')
}

function cacheGet(key) {
  if (!cache.has(key)) return null
  const value = cache.get(key)
  // 重新插入，bump 到尾部
  cache.delete(key)
  cache.set(key, value)
  return value
}

function cacheSet(key, value) {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, value)
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) break
    cache.delete(oldestKey)
  }
}

export function clearEmbeddingCache() {
  cache.clear()
}

// 是否已配置 embedding provider。前端读 config.json 的 embedding 块，
// 这里通过 getEmbeddingCredentials() 间接读后端凭证视图。
// 注意：故意做成同步且尽可能宽松——只看 apiKey + model 是否齐全，
//      具体调用失败让 computeEmbedding 内部处理。
export function isEmbeddingConfigured() {
  try {
    const cred = getEmbeddingCredentials()
    if (!cred || !cred.model) return false
    // local provider 走离线推理，不需要 apiKey
    if (cred.provider === 'local') return true
    return !!cred.apiKey
  } catch {
    return false
  }
}

// 把 Float32Array 转成 Buffer（共享底层 ArrayBuffer，不复制）
function f32ArrayToBuffer(arr) {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
}

// 主接口：算 embedding。
// - text 太短 / 为空 → null
// - 未配置 provider → null
// - 网络 / API 错误 → null（静默）
// - 成功 → Buffer (包裹 Float32Array 的字节，长度 = dim * 4)
export async function computeEmbedding(text, { isQuery = false } = {}) {
  const input = typeof text === 'string' ? text : ''
  if (!input || input.length < MIN_TEXT_LENGTH) return null

  let cred
  try {
    cred = getEmbeddingCredentials()
  } catch {
    return null
  }
  if (!cred || !cred.model) return null
  // local provider 不需要 apiKey（离线推理）；远程 provider 仍需要
  const isLocal = cred.provider === 'local'
  if (!isLocal && !cred.apiKey) return null

  // bge 等非对称模型：query/passage 向量不同（前缀不同），cacheKey 需区分
  const keyExtra = isQuery ? ':q' : ':p'
  const key = cacheKey(input, cred.model + keyExtra)
  const cached = cacheGet(key)
  if (cached) return cached

  let buf = null
  try {
    if (isLocal) {
      // 本地离线推理：transformers.js + onnxruntime-node 跑 ONNX（Xenova/bge-large-zh-v1.5）
      // 首次运行会从 hf-mirror.com 下载 ~330MB 模型到 paths.modelsDir，之后离线命中
      const { computeLocalEmbedding } = await import('./embedding-local.js')
      const vec = await computeLocalEmbedding(input, { isQuery })
      if (!Array.isArray(vec) || vec.length === 0) return null
      const f32 = new Float32Array(vec.length)
      for (let i = 0; i < vec.length; i++) f32[i] = Number(vec[i]) || 0
      buf = f32ArrayToBuffer(f32)
    } else {
      const { default: OpenAI } = await import('openai')
      const client = new OpenAI({
        apiKey: cred.apiKey,
        baseURL: cred.baseURL || undefined,
        timeout: 15000,
      })

      // dimensions 仅 OpenAI text-embedding-3-* 系列支持；
      // 其他 provider 传过去通常被忽略或者直接报错，所以只在 provider === 'openai' 时附带
      const params = { model: cred.model, input }
      if (cred.provider === 'openai' && Number.isFinite(cred.dimensions) && cred.dimensions > 0) {
        params.dimensions = cred.dimensions
      }

      const resp = await client.embeddings.create(params)
      const vec = resp?.data?.[0]?.embedding
      if (!Array.isArray(vec) || vec.length === 0) return null

      const f32 = new Float32Array(vec.length)
      for (let i = 0; i < vec.length; i++) f32[i] = Number(vec[i]) || 0
      buf = f32ArrayToBuffer(f32)
    }
  } catch {
    // 任何错误：401 / 超时 / DNS / 序列化 / provider 不支持 embedding……
    // 一律返回 null，让上层走 FTS5 兜底
    return null
  }

  if (buf) cacheSet(key, buf)
  return buf
}
