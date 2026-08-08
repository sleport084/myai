import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getVoiceConfig, getTTSConfig, getMediaConfig, getWebSearchConfig } from '../src/config.js'

describe('getVoiceConfig', () => {
  it('returns an object with voiceProvider and configured fields', () => {
    const result = getVoiceConfig()
    console.log('getVoiceConfig:', JSON.stringify(result, null, 2))
    assert.equal(typeof result, 'object')
    assert.ok(result !== null)
    assert.equal(typeof result.voiceProvider, 'string')
    // All other keys should be { configured: boolean } or { configured, invalidFormat }
    for (const [key, val] of Object.entries(result)) {
      if (key === 'voiceProvider') continue
      assert.equal(typeof val, 'object', `expected object for ${key}`)
      assert.equal(typeof val.configured, 'boolean', `expected configured boolean for ${key}`)
    }
  })
})

describe('getTTSConfig', () => {
  it('returns an object with ttsProvider and configured sub-objects', () => {
    const result = getTTSConfig()
    console.log('getTTSConfig:', JSON.stringify(result, null, 2))
    assert.equal(typeof result, 'object')
    assert.ok(result !== null)
    assert.equal(typeof result.ttsProvider, 'string')
    assert.equal(typeof result.ttsVoiceId, 'string')
    assert.equal(typeof result.doubaoSpeechRate, 'number')
    // Sub-objects that expose { configured: boolean }
    for (const key of ['minimaxKey', 'doubaoKey', 'doubaoAppId', 'doubaoAccessKey', 'openaiTtsKey', 'elevenLabsKey', 'volcanoAppId', 'volcanoToken']) {
      assert.equal(typeof result[key], 'object', `expected object for ${key}`)
      assert.equal(typeof result[key].configured, 'boolean', `expected configured boolean for ${key}`)
    }
  })
})

describe('getMediaConfig', () => {
  it('returns an object with provider fields and configured sub-objects', () => {
    const result = getMediaConfig()
    console.log('getMediaConfig:', JSON.stringify(result, null, 2))
    assert.equal(typeof result, 'object')
    assert.ok(result !== null)
    assert.equal(typeof result.mediaImageProvider, 'string')
    assert.equal(typeof result.mediaMusicProvider, 'string')
    assert.equal(typeof result.openaiImageModel, 'string')
    assert.equal(typeof result.openaiImageBaseURL, 'string')
    assert.equal(typeof result.minimaxKey, 'object')
    assert.equal(typeof result.minimaxKey.configured, 'boolean')
    assert.equal(typeof result.openaiImageKey, 'object')
    assert.equal(typeof result.openaiImageKey.configured, 'boolean')
  })
})

describe('getWebSearchConfig', () => {
  it('returns an object with configured booleans and fromEnv flags', () => {
    const result = getWebSearchConfig()
    console.log('getWebSearchConfig:', JSON.stringify(result, null, 2))
    assert.equal(typeof result, 'object')
    assert.ok(result !== null)
    // configured booleans
    for (const key of ['serperConfigured', 'jinaConfigured', 'braveConfigured', 'tavilyConfigured']) {
      assert.equal(typeof result[key], 'boolean', `expected boolean for ${key}`)
    }
    // fromEnv booleans
    for (const key of ['serperFromEnv', 'jinaFromEnv', 'braveFromEnv', 'tavilyFromEnv', 'searxngFromEnv']) {
      assert.equal(typeof result[key], 'boolean', `expected boolean for ${key}`)
    }
    // searxng url fields
    assert.equal(typeof result.searxngUrl, 'string')
    assert.equal(typeof result.effectiveSearxngUrl, 'string')
  })
})
