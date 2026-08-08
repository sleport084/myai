import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blm-voice-test-'))
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

// ── Voice settings ───────────────────────────────────────────

describe('GET /settings/voice', () => {
  it('returns voice config with provider and configured flags', async () => {
    const res = await fetch(`${baseUrl}/settings/voice`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.ok(body.voice, 'response has voice object')
    assert.equal(typeof body.voice.voiceProvider, 'string')
    // other keys should be { configured: boolean } objects
    assert.equal(typeof body.voice.aliyunApiKey, 'object')
    assert.equal(typeof body.voice.aliyunApiKey.configured, 'boolean')
  })
})

describe('POST /settings/voice', () => {
  it('saves voice provider and persists it', async () => {
    const payload = JSON.stringify({ voiceProvider: 'tencent' })
    const res = await fetch(`${baseUrl}/settings/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.voice.voiceProvider, 'tencent')

    // verify persistence via a fresh GET
    const getRes = await fetch(`${baseUrl}/settings/voice`)
    const getBody = await getRes.json()
    assert.equal(getBody.voice.voiceProvider, 'tencent')
  })

  it('saves a credential and reports it as configured', async () => {
    const payload = JSON.stringify({ aliyunApiKey: 'sk-test_1234567890abcdefghij' })
    const res = await fetch(`${baseUrl}/settings/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.voice.aliyunApiKey.configured, true)
    assert.equal(body.voice.aliyunApiKey.invalidFormat, false)
  })

  it('rejects invalid Aliyun ASR key format', async () => {
    // clear any previously saved key first
    await fetch(`${baseUrl}/settings/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aliyunApiKey: '' }),
    })

    const payload = JSON.stringify({ aliyunApiKey: 'bad-key' })
    const res = await fetch(`${baseUrl}/settings/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    // invalid key should be ignored, not saved
    assert.equal(body.voice.aliyunApiKey.configured, false)
  })
})

// ── TTS settings ─────────────────────────────────────────────

describe('GET /settings/tts', () => {
  it('returns TTS config with providers and voices catalogs', async () => {
    const res = await fetch(`${baseUrl}/settings/tts`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.ok(body.tts, 'response has tts object')
    assert.ok(Array.isArray(body.providers), 'providers is an array')
    assert.ok(body.providers.length > 0, 'providers list is non-empty')
    assert.ok(typeof body.voices === 'object' && body.voices !== null, 'voices is an object')
  })

  it('tts config has expected shape', async () => {
    const res = await fetch(`${baseUrl}/settings/tts`)
    const body = await res.json()
    assert.equal(typeof body.tts.ttsProvider, 'string')
    assert.equal(typeof body.tts.ttsVoiceId, 'string')
    // credential fields are { configured: boolean } objects
    assert.equal(typeof body.tts.doubaoKey, 'object')
    assert.equal(typeof body.tts.doubaoKey.configured, 'boolean')
  })
})

describe('POST /settings/tts', () => {
  it('saves TTS provider and voice id', async () => {
    const payload = JSON.stringify({ ttsProvider: 'openai', ttsVoiceId: 'alloy' })
    const res = await fetch(`${baseUrl}/settings/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.tts.ttsProvider, 'openai')
    assert.equal(body.tts.ttsVoiceId, 'alloy')

    // verify persistence
    const getRes = await fetch(`${baseUrl}/settings/tts`)
    const getBody = await getRes.json()
    assert.equal(getBody.tts.ttsProvider, 'openai')
    assert.equal(getBody.tts.ttsVoiceId, 'alloy')
  })

  it('saves API keys and reports them as configured', async () => {
    const payload = JSON.stringify({ openaiTtsKey: 'sk-test-openai-key-1234' })
    const res = await fetch(`${baseUrl}/settings/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.tts.openaiTtsKey.configured, true)
  })

  it('clears a key when sent empty string', async () => {
    // first set a key
    await fetch(`${baseUrl}/settings/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elevenLabsKey: 'sk-some-key' }),
    })
    // then clear it
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
