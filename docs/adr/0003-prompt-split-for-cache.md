# ADR-0003: Prompt Split for Cache Optimization

## Status

Accepted

## Context

LLM API calls are the primary cost driver. Many providers (OpenAI, DeepSeek, etc.) support prompt caching — if the system prompt prefix is identical across calls, it is served from cache at reduced cost.

## Decision

The prompt is split into two parts:

1. **System prompt** (`buildSystemPrompt()`) — stable across rounds. Contains agent identity, behavior rules, relationship posture, language rules. Conditionally appended scene-rule gates (music, video, weather, etc.) based on keyword matching.

2. **Context block** (`buildContextBlock()`) — per-round dynamic. Contains current time, memories, user profile, task state, runtime context, thread state, self-perception. Injected into the **user message** as a `<context>` XML block, not into the system message.

This ensures the system prompt prefix remains identical across consecutive turns for cache hit optimization.

## Consequences

- Cache-friendly: the system prompt changes only when scene-rule gates activate/deactivate
- The context block is technically part of the user message, which may confuse some LLM providers
- The split is maintained manually in `src/prompt.js` — easy to accidentally move dynamic content into the system prompt
- Scene-rule gates use regex keyword matching, which can produce false positives
