# ADR-0002: Provider Registry Pattern

## Status

Accepted

## Context

The agent needs to support multiple LLM providers, media generation providers, TTS providers, and ASR providers. Each has different APIs, auth schemes, and capabilities.

## Decision

Two separate provider systems exist:

1. **Media providers** (`src/providers/`): A formal `BaseProvider` class with `canDo(capability)`, `call(capability, params)`, `getQuotaStatus()`. Concrete providers (MiniMax, OpenAI Image) extend it. A registry (`src/providers/registry.js`) routes calls by capability or explicit provider name.

2. **Voice providers** (`src/voice/`): No shared base class. Each TTS/ASR provider is an independent function implementing the same contract (`streamTTS` dispatches by provider string; `createCloudASRSession` dispatches by config.provider). The contract is implicit — `{sendAudio, flush, close}` for ASR, `Readable stream` for TTS.

LLM providers use the OpenAI SDK directly (all providers are OpenAI-compatible). Provider quirks (DeepSeek thinking, Zhipu temperature, MiniMax XML tool calls) are handled inline in `src/llm.js`.

## Consequences

- Adding a new media provider requires extending `BaseProvider` and registering it
- Adding a new voice provider requires implementing a standalone function with no interface enforcement
- Adding a new LLM provider may require quirk-handling code in `llm.js`
- Provider selection is inconsistent: media uses config + registry, voice uses config + switch dispatch, LLM uses config + fallback chain
