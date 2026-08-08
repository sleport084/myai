# step-5a: 暴露 DeepSeek prompt cache 命中字段

改动文件：`src/llm.js`

- 新增局部变量 `cacheHitTokens` / `cacheMissTokens`，从 `chunk.usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 读取（缺失时为 0）。
- `[配额]` log 行追加可选的 `(prompt cache: hit/total = pct%)` 后缀，仅当 hit+miss>0 时输出。
- `recordUsage` 接口未变，返回值未变；非 DeepSeek provider（如 MiniMax）不返回 cache 字段时后缀为空字符串。

改造前：
`[配额] 本轮 tokens: 1234`

改造后（DeepSeek 命中）：
`[配额] 本轮 tokens: 1234 (prompt cache: 900/1100 = 81.8%)`

改造后（非 DeepSeek）：
`[配额] 本轮 tokens: 1234`
