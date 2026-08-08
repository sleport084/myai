import { getVoiceConfig, getTTSConfig } from '../src/config.js'

console.log('=== getVoiceConfig() ===')
const voice = getVoiceConfig()
console.log(JSON.stringify(voice, null, 2))

console.log('\n=== getTTSConfig() ===')
const tts = getTTSConfig()
console.log(JSON.stringify(tts, null, 2))
