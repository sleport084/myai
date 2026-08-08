import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blm-api-voice-test-'))
process.env.BAILONGMA_USER_DIR = tmp
process.env.BAILONGMA_RESOURCES_DIR = process.cwd()
process.env.BAILONGMA_HOST = '127.0.0.1'

let server
let baseUrl
let closeDBForTest

before(async () => {
  const { startAPI } = await import('../src/api.js')
  ;({ closeDBForTest } = await import('../src/db.js'))
  server = startAPI(0)
  await once(server, 'listening')
  const { port } = server.address()
  baseUrl = `http://127.0.0.1:${port}`
})

after(async () => {
  if (server) await new Promise(r => server.close(r))
  closeDBForTest?.()
  fs.rmSync(tmp, { recursive: true, force: true })
})

// ── GET /settings/voice ──────────────────────────────────────

describe('GET /settings/voice', () => {
  it('returns 200 with ok and voice object', async () => {
    const res = await fetch(`${baseUrl}/settings/voice`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.ok(body.voice)
  })

  it('includes voiceProvider as a string', async () => {
    const body = await (await fetch(`${baseUrl}/settings/voice`)).json()
    assert.equal(typeof body.voice.voiceProvider, 'string')
  })

  it('wraps credentials as { configured: boolean } objects', async () => {
    const body = await (await fetch(`${baseUrl}/settings/voice`)).json()
    const credKeys = [
      'aliyunApiKey', 'tencentSecretId', 'tencentSecretKey', 'tencentAppId',
      'xunfeiAppId', 'xunfeiApiKey', 'xunfeiApiSecret',
      'volcAsrApiKey', 'volcAsrAppKey', 'volcAsrAccessKey', 'volcAsrResourceId',
    ]
    for (const key of credKeys) {
      assert.equal(typeof body.voice[key], 'object', `${key} should be an object`)
      assert.equal(typeof body.voice[key].configured, 'boolean', `${key}.configured should be boolean`)
    }
  })
})

// ── POST /settings/voice ─────────────────────────────────────

describe('POST /settings/voice', () => {
  it('saves voiceProvider and persists across requests', async () => {
    const res = await fetch(`${baseUrl}/settings/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceProvider: 'tencent' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.voice.voiceProvider, 'tencent')

    const getBody = await (await fetch(`${baseUrl}/settings/voice`)).json()
    assert.equal(getBody.voice.voiceProvider, 'tencent')
  })

  it('saves a valid Aliyun key and marks it configured', async () => {
    const res = await fetch(`${baseUrl}/settings/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aliyunApiKey: 'sk-test_1234567890abcdefghij' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.voice.aliyunApiKey.configured, true)
    assert.equal(body.voice.aliyunApiKey.invalidFormat, false)
  })

  it('rejects an invalid Aliyun key format', async () => {
    await fetch(`${baseUrl}/settings/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aliyunApiKey: '' }),
    })
    const res = await fetch(`${baseUrl}/settings/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aliyunApiKey: 'bad-key' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.voice.aliyunApiKey.configured, false)
  })
})

// ── GET /settings/tts ────────────────────────────────────────

describe('GET /settings/tts', () => {
  it('returns 200 with ok, tts, providers, and voices', async () => {
    const res = await fetch(`${baseUrl}/settings/tts`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.ok(body.tts)
    assert.ok(Array.isArray(body.providers))
    assert.ok(body.providers.length > 0)
    assert.ok(typeof body.voices === 'object' && body.voices !== null)
  })

  it('providers have id, label, and streaming fields', async () => {
    const body = await (await fetch(`${baseUrl}/settings/tts`)).json()
    for (const p of body.providers) {
      assert.equal(typeof p.id, 'string')
      assert.equal(typeof p.label, 'string')
      assert.equal(typeof p.streaming, 'boolean')
    }
  })

  it('voices maps each provider id to a non-empty array', async () => {
    const body = await (await fetch(`${baseUrl}/settings/tts`)).json()
    for (const p of body.providers) {
      assert.ok(Array.isArray(body.voices[p.id]), `voices[${p.id}] should be an array`)
      assert.ok(body.voices[p.id].length > 0, `voices[${p.id}] should be non-empty`)
      for (const v of body.voices[p.id]) {
        assert.equal(typeof v.id, 'string')
        assert.equal(typeof v.label, 'string')
      }
    }
  })

  it('tts config has expected shape', async () => {
    const body = await (await fetch(`${baseUrl}/settings/tts`)).json()
    assert.equal(typeof body.tts.ttsProvider, 'string')
    assert.equal(typeof body.tts.ttsVoiceId, 'string')
    assert.equal(typeof body.tts.doubaoKey, 'object')
    assert.equal(typeof body.tts.doubaoKey.configured, 'boolean')
  })
})

// ── POST /settings/tts ───────────────────────────────────────

describe('POST /settings/tts', () => {
  it('saves ttsProvider and ttsVoiceId', async () => {
    const res = await fetch(`${baseUrl}/settings/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttsProvider: 'openai', ttsVoiceId: 'alloy' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.tts.ttsProvider, 'openai')
    assert.equal(body.tts.ttsVoiceId, 'alloy')

    const getBody = await (await fetch(`${baseUrl}/settings/tts`)).json()
    assert.equal(getBody.tts.ttsProvider, 'openai')
    assert.equal(getBody.tts.ttsVoiceId, 'alloy')
  })

  it('saves API keys and marks them configured', async () => {
    const res = await fetch(`${baseUrl}/settings/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openaiTtsKey: 'sk-test-openai-key-1234' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.tts.openaiTtsKey.configured, true)
  })

  it('clears a key when sent empty string', async () => {
    await fetch(`${baseUrl}/settings/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elevenLabsKey: 'sk-some-key' }),
    })
    const res = await fetch(`${baseUrl}/settings/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elevenLabsKey: '' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.tts.elevenLabsKey.configured, false)
  })
})

// ── GET /settings/media ──────────────────────────────────────

describe('GET /settings/media', () => {
  it('returns 200 with ok and media object', async () => {
    const res = await fetch(`${baseUrl}/settings/media`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.ok(body.media)
  })

  it('media config has expected fields', async () => {
    const body = await (await fetch(`${baseUrl}/settings/media`)).json()
    assert.equal(typeof body.media, 'object')
    assert.ok(body.media !== null)
  })
})
