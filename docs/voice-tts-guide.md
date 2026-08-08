# Voice, TTS & Media Configuration Guide

All settings are stored in `config.json` at the project root (or `userData` directory in packaged Electron).

---

## 1. Voice (ASR) Configuration

ASR config lives under `config.json` -> `voice`.

### Providers

| Provider | Auth Method | Fields |
|----------|------------|--------|
| **Aliyun** | DashScope API Key | `aliyunApiKey` (format `sk-xxxxxxxx`) |
| **Volcengine** | API Key or App+Access pair | `volcAsrApiKey` (simple), or `volcAsrAppKey` + `volcAsrAccessKey` (full) |
| **Tencent** | Cloud SecretId/Key + AppId | `tencentSecretId`, `tencentSecretKey`, `tencentAppId` |
| **Xunfei** | iFlytek triple | `xunfeiAppId`, `xunfeiApiKey`, `xunfeiApiSecret` |

Set `voiceProvider` to one of: `aliyun` (default), `tencent`, `xunfei`, `volcengine`.

### Getting API Keys

- **Aliyun**: [DashScope Console](https://dashscope.console.aliyun.com/) -> API Key Management -> Create API Key
- **Volcengine**: [Volcengine Console](https://console.volcengine.com/speech) -> Create app -> get AppKey/AccessKey, or use a single API Key
- **Tencent**: [CAM Console](https://console.cloud.tencent.com/cam/capi) -> Create SecretId/SecretKey; then [ASR Console](https://console.cloud.tencent.com/asr) -> get AppId
- **Xunfei**: [iFlytek Open Platform](https://console.xfyun.cn/) -> Create app -> get AppID, API Key, API Secret

### Quick Config Example

```json
{
  "voice": {
    "voiceProvider": "aliyun",
    "aliyunApiKey": "sk-xxxxxxxxxxxxxxxx"
  }
}
```

Volcengine (simple auth):
```json
{
  "voice": {
    "voiceProvider": "volcengine",
    "volcAsrApiKey": "your-api-key",
    "volcAsrResourceId": "volc.bigasr.sauc.duration"
  }
}
```

### Local Whisper (No Cloud Key Needed)

The project can run a local Whisper model via `whisper_server.py` or a compiled `.exe`. Set `whisperModel` to a model size (`tiny`, `base`, `small`, `medium`, `large`). No cloud API key is required for this mode.

---

## 2. TTS Configuration

TTS config lives under `config.json` -> `tts`.

### Providers

| Provider | Streaming | Required Fields |
|----------|-----------|-----------------|
| **Doubao** | Yes | `doubaoKey` (UUID format) |
| **MiniMax** | No | `minimaxKey` |
| **OpenAI** | Yes | `openaiTtsKey` |
| **ElevenLabs** | Yes | `elevenLabsKey` |
| **Volcano** | No | `volcanoAppId` + `volcanoToken` |

Set `ttsProvider` to one of: `doubao` (default), `minimax`, `openai`, `elevenlabs`, `volcano`.

### Getting API Keys

- **Doubao**: [Volcengine TTS Console](https://console.volcengine.com/speech) -> Create app -> get API Key (UUID format)
- **MiniMax**: [MiniMax Platform](https://platform.minimaxi.com/) -> API Keys. Also works if you've already set `MINIMAX_API_KEY` env var or the top-level `minimax_api_key` in config.json for LLM use.
- **OpenAI**: [OpenAI Platform](https://platform.openai.com/api-keys) -> Create API Key. Supports custom `openaiTtsBaseURL` for proxies.
- **ElevenLabs**: [ElevenLabs Dashboard](https://elevenlabs.io/) -> Profile -> API Key
- **Volcano**: [Volcengine Console](https://console.volcengine.com/speech) -> Create app -> get AppId and Access Token

### Voice Selection

Set `ttsVoiceId` to pick a voice. Defaults to `zh_female_xiaohe_uranus_bigtts`.

**Doubao voices**: `zh_female_xiaohe_uranus_bigtts`, `zh_female_vv_uranus_bigtts`, `zh_female_shuangkuaisisi_uranus_bigtts`, `zh_female_cancan_uranus_bigtts`, `zh_female_tianmeixiaoyuan_uranus_bigtts`, `zh_male_m191_uranus_bigtts`, `zh_male_taocheng_uranus_bigtts`, `zh_female_kefunvsheng_uranus_bigtts`

**MiniMax voices**: `male-qn-qingse`, `male-qn-jingying`, `male-qn-badao`, `female-shaonv`, `female-yujie`, `female-chengshu`, `presenter_male`, `presenter_female`

**OpenAI voices**: `nova`, `shimmer`, `alloy`, `echo`, `fable`, `onyx`

**ElevenLabs voices**: `pNInz6obpgDQGcFmaJgB` (Adam), `ErXwobaYiN019PkySvjV` (Antoni), `MF3mGyEYCl7XYWbV9V6O` (Elli), `21m00Tcm4TlvDq8ikWAM` (Rachel), `AZnzlk1XvdvUeBnXmlld` (Domi), `TxGEqnHWrfWFTfGW9XjX` (Josh)

**Volcano voices**: `zh_female_qingxin`, `zh_female_tianmei_jingpin`, `zh_female_meiqi`, `zh_male_rap`, `zh_male_qingchengnanzhu`, `BV001_streaming`, `BV002_streaming`

### Doubao Extras

- `doubaoStyle` -- Emotional style description (e.g. "温柔", "兴奋")
- `doubaoSpeechRate` -- Speed: -50 to 100 (0 = normal)
- `doubaoResourceId` -- Auto-resolved (`seed-tts-2.0` for uranus voices, `seed-tts-1.0` for older)
- `doubaoAccessKey` -- Alternative auth via Volcengine Access Key
- `doubaoAppId` -- Optional App ID

### Quick Config Example

```json
{
  "tts": {
    "ttsProvider": "doubao",
    "ttsVoiceId": "zh_female_xiaohe_uranus_bigtts",
    "doubaoKey": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  }
}
```

### Environment Variable Fallbacks

| Env Var | Maps To |
|---------|---------|
| `DOUBAO_TTS_API_KEY` | `doubaoKey` |
| `DOUBAO_TTS_APP_ID` | `doubaoAppId` |
| `DOUBAO_TTS_ACCESS_KEY` | `doubaoAccessKey` |
| `DOUBAO_TTS_RESOURCE_ID` | `doubaoResourceId` |
| `DOUBAO_TTS_STYLE` | `doubaoStyle` |
| `DOUBAO_TTS_SPEECH_RATE` | `doubaoSpeechRate` |
| `MINIMAX_API_KEY` | `minimaxKey` |

---

## 3. Media Configuration

Media config lives under `config.json` -> `media`, except Seedance which uses a separate `seedance.json`.

### Image Generation

Set `mediaImageProvider` to `minimax` (default) or `openai`.

**MiniMax** -- requires `minimaxKey` (shared with TTS/LLM; falls back to `MINIMAX_API_KEY` env var). Model: `image-01`. Daily limit: 50 images.

**OpenAI DALL-E** -- requires `openaiImageKey`. Optional: `openaiImageBaseURL` (defaults to `https://api.openai.com/v1`), `openaiImageModel` (defaults to `dall-e-3`).

```json
{
  "media": {
    "mediaImageProvider": "openai",
    "openaiImageKey": "sk-xxxxxxxxxxxxxxxx",
    "openaiImageModel": "dall-e-3"
  }
}
```

### Music & Lyrics Generation

Only MiniMax is supported. Set `mediaMusicProvider` to `minimax`. Requires `minimaxKey`. Model: `music-2.6`. Daily limit: 100 tracks.

### Video Generation (Seedance)

Seedance config is stored in a separate `seedance.json` file (not in `config.json`). Uses the Volcengine Ark API.

```json
{
  "apiKey": "your-ark-api-key",
  "model": "doubao-seedance-2-0-260128",
  "baseURL": "https://ark.cn-beijing.volces.com/api/v3"
}
```

**Environment variable fallbacks**: `ARK_API_KEY` or `SEEDANCE_API_KEY` -> `apiKey`.

**Quick setup**: Send a message like `火山视频 yourApiKey` or `火山视频 yourApiKey 模型 ep-xxxxx` and the system will auto-configure.

**Capabilities**:
- Modes: text-to-video, image-to-video, first-last-frame
- Ratios: `adaptive`, `16:9`, `9:16`, `4:3`, `3:4`, `1:1`, `21:9`
- Resolutions: `480p`, `720p`, `1080p`
- Duration: 1-15 seconds (default: 5)

### Full config.json Media Section

```json
{
  "media": {
    "mediaImageProvider": "minimax",
    "mediaMusicProvider": "minimax",
    "minimaxKey": "your-minimax-key",
    "openaiImageKey": "",
    "openaiImageBaseURL": "",
    "openaiImageModel": "dall-e-3"
  }
}
```
