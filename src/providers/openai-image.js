import { BaseProvider } from './base.js'
import { recordDailyUsage } from '../quota.js'

/**
 * OpenAI Image Provider (DALL-E 3 / DALL-E 2 / gpt-image-1)
 * 只支持图片生成能力，不替代 MiniMax 的音乐/歌词/TTS
 */
export class OpenAIImageProvider extends BaseProvider {
  constructor({ name = 'openai-image', apiKey, baseURL = 'https://api.openai.com/v1', model = 'dall-e-3' }) {
    super({
      name,
      apiKey,
      baseURL,
    })
    this.model = model
  }

  canDo(capability) {
    return capability === 'image'
  }

  async call(capability, params) {
    if (capability === 'image') return this.#image(params)
    throw new Error(`OpenAIImageProvider: 不支持的能力 "${capability}"`)
  }

  getQuotaStatus() {
    return {
      image: { used: 0, limit: 'unlimited', ratio: 'N/A' },
    }
  }

  // ── Image Generation (DALL-E) ──
  async #image({ prompt, aspect_ratio = '1:1', n = 1 }) {
    if (!prompt) throw new Error('image: 缺少 prompt 参数')

    // DALL-E 的 size 映射
    const sizeMap = {
      '1:1': '1024x1024',
      '16:9': '1792x1024',
      '4:3': '1024x1024',  // DALL-E 不直接支持 4:3，用 1:1 代替
      '3:4': '1024x1792',
      '9:16': '1024x1792',
    }
    const size = sizeMap[aspect_ratio] || '1024x1024'

    const resp = await fetch(`${this.baseURL}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        n: Math.min(Math.max(n || 1, 1), 4),
        size,
        response_format: 'url',
      }),
    })

    if (!resp.ok) {
      const err = await resp.text()
      throw new Error(`OpenAI DALL-E 图片生成失败 (${resp.status}): ${err.slice(0, 300)}`)
    }

    const data = await resp.json()
    if (!data?.data?.length) throw new Error('OpenAI DALL-E: 响应中无图片数据')

    recordDailyUsage('image', n)
    return { urls: data.data.map(d => d.url).filter(Boolean) }
  }
}
