# CONTEXT.md - 小白龙 (XiaoBaiLong)

## Project Overview

小白龙 is an Electron desktop AI agent that runs continuously as a persistent personal digital companion. It maintains long-term memory, interacts via voice/chat, connects to social platforms (WeChat, Discord), and executes tools in a sandboxed environment. It has a "consciousness loop" — a self-rescheduling setTimeout chain that keeps it alive and responsive. It is NOT a simple chatbot; it's a household member with identity, self-perception, and autonomous behavior.

## Tech Stack

- **Desktop**: Electron 33 (main/preload in `electron/`)
- **Frontend**: Vanilla JS + HTML (no framework), SSE/WebSocket for real-time updates
- **Backend**: Node.js ESM, HTTP server in `src/index.js` + `src/api.js`
- **Database**: SQLite via `better-sqlite3` (FTS5 full-text search + vector embeddings)
- **LLM**: OpenAI-compatible SDK — DeepSeek, MiniMax, Qwen, Moonshot, Zhipu, Mimo (auto-fallback chains)
- **Voice**: Cloud ASR (Aliyun, Tencent, Xunfei, Volcengine) + local Whisper; 5 TTS backends
- **Media**: MiniMax (image/music/lyrics), OpenAI DALL-E, Volcengine Seedance (video)
- **Social**: WeChat (clawbot bridge), Discord, Feishu/WeCom (webhooks)
- **Build**: electron-builder (Win NSIS + Mac DMG)

## Key Directories

```
electron/              Electron shell — main.cjs, preload.cjs
src/
  index.js             Orchestrator — consciousness loop, runTurn, state management
  api.js               HTTP server — endpoints, settings, TTS streaming, webhooks
  llm.js               LLM streaming, tool-call loop, retry/fallback, provider quirks
  prompt.js            System prompt assembly, context block, scene-rule gates
  db.js                Schema, CRUD, FTS5, embeddings — all persistence
  config.js            Config getters/setters with JSON schema migration
  config/              Sub-config modules (voice.js, media.js, search.js, social.js)
  memory/              Recognition, injection, consolidation, focus, threads (24 files)
  capabilities/        Tool system — factory, executor (53KB), sandbox, policies, schemas/
  context/             Rule engine, runtime injection, section gating, keyword context
  providers/           LLM/media provider abstraction — base, registry, minimax, openai-image
  voice/               Voice input — cloud ASR, Whisper, TTS providers, manager
  social/              Platform integrations — WeChat, Discord, dispatch, webhooks
  runtime/             Message handling, tool protocol, turn tracing, verbatim mode
  agents/              Agent detection and registry
  ui/brain-ui/         Brain UI — chat, voice panels, TTS pipeline, ACUI cards, hotspots
skills/                Agent skill definitions (markdown, invocable via slash commands)
scripts/               Build, dev, and maintenance scripts
docs/                  Documentation, ADRs
```

## Main Modules

### Consciousness Loop & Turn Lifecycle (`src/index.js`)
Self-rescheduling setTimeout with priority scheduling: user messages (0ms) > background (0ms) > rate-limited (quota interval) > active task (30s) > idle (tickInterval). Each tick runs `runTurn()`: memory injection → thread attribution → context assembly → LLM call → tool execution loop → post-turn state updates.

### Memory System (`src/memory/`)
Long-term memory in SQLite with FS5 + vector embeddings. Key processes:
- **Recognition** — extracts memories from conversation turns
- **Consolidation** — merges/deduplicates memories
- **Injection** — selects and formats memories into prompt context each turn
- **Focus** — attention stack with foreground pointer, drives recall and thread selection
- **Threads** — conversation threading with temperature decay and commitments

### LLM & Providers (`src/llm.js`, `src/providers/`)
Streaming LLM calls with inline tool-call loops (up to `maxRounds`). Provider registry supports automatic model fallback chains. Prompt cache optimization via system/context split.

### Tool System (`src/capabilities/`)
Tools defined as OpenAI function-calling schemas in `schemas/`. Executed by `executor.js` in a sandboxed environment. Covers: filesystem, shell, web search, media generation, memory CRUD, reminders, UI control, social messaging.

### Voice (`src/voice/`)
Voice input via cloud ASR or local Whisper (`whisper_server.py`). `manager.js` orchestrates recording/recognition. `tts-providers.js` handles TTS with 5 backends. Barge-in detection (user speaking during TTS playback).

### Config (`src/config.js` + `src/config/`)
Two storage layers: JSON file (provider keys, credentials) + SQLite `config` table (runtime settings). Sections: LLM, voice, TTS, media, social, webSearch, embedding, security.

### Social Channels (`src/social/`)
Multi-platform messaging: WeChat (clawbot), Discord, Feishu/WeCom. Dispatch layer routes messages. Local channel gets plain text; social channels get `send_message` tool calls.

### Frontend (`src/ui/brain-ui/`)
Vanilla JS renderer with SSE/WebSocket. Components: chat, voice visualization, thought stream, person cards, TTS pipeline, ACUI (Active Card UI) for weather/self-check/image/video/security, hotspot panel, World Cup module.

## Recent Changes

- **Prompt split** — System prompt split into stable `system` + dynamic `<context>` block for prompt cache hit optimization (~30-60% input cost savings). See `CHANGES.md`.
- **Voice/TTS settings reorganization** — Voice config consolidated into `src/config/voice.js` with provider abstraction in `src/voice/tts-providers.js`.
- **Media provider support** — Image generation via `providers/openai-image.js`, config in `src/config/media.js`. MiniMax and Volcengine Seedance for video.
- **Agent skills system** — Skill definitions in `skills/`, selected per-turn by context relevance, managed by `src/agents/`.
- **Tool protocol and factory** — Structured tool system with schemas, sandboxed execution, policy enforcement in `src/capabilities/`.

## Glossary

| Term | Meaning |
|------|---------|
| Tick | One consciousness loop iteration |
| Turn | One LLM reasoning cycle (prompt → response → tools → post-turn) |
| Thread | Conversation thread with temperature, commitments, foreground pointer |
| Focus | Agent's current attention topic; drives recall and thread selection |
| Salience | Numeric score on memories for relevance ranking |
| ACUI | Active Card UI — interactive cards for tool results |
| Barge-in | User speaking during TTS; detected via amplitude threshold |
| Sandbox | Isolated directory for tool-generated files |
| Scene-rule gate | Conditional prompt block activated by keyword matching |
