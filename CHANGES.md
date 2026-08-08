# Prompt 拆分：硬底线 system + 动态 `<context>` 块

第 1 步：把动态记忆从 system 里搬到 user 消息内的 `<context>` 块，让 system
萎缩到只剩硬底线，吃满 provider 的 prompt cache。

## 改动文件

- `src/prompt.js` — 新增 `buildContextBlock` / `combinePromptForPreview`；
  `buildSystemPrompt` 现在只输出稳定的硬底线（top-level rules、persona、
  agent_name、existence_desc、execution sandbox flags、systemEnv、本机 AI agent
  block），其余动态字段虽然仍被接受但会被静默忽略。新增了一段
  "Round-Local Context Channel" 规则，告诉 LLM 每轮用户消息开头会有
  `<context>` 块。
- `src/index.js` — `process()` 拆成 `systemPrompt`（稳定）+ `contextBlock`
  （每轮重建）；`buildLLMMessages` 新增 `contextBlock` 形参，把它前缀拼到
  "当前那条用户消息" 内容前面（match 到的 conversationWindow 行，或 fallback 的
  TICK/append 消息）。refresh-loop 完成后**只重建 contextBlock**，不重建 system。
- `src/system-prompt-preview.js` — 同样拆成 system + contextBlock；为了向前
  兼容 `systemPrompt.html` 的渲染，返回字段仍带 `systemPrompt`（= 两段拼接
  的预览串），并新增 `system` / `contextBlock` 两个细分字段。
- `src/test-runner.js` — 跟着新签名走，把 memories/directions 改成进
  contextBlock，然后把 contextBlock 前缀贴在 user message 上。
- `src/test-prompt-split.js`（**新增**）+ `src/test-prompt-split-loader.mjs`
  （**新增**）— 自带 ESM loader 钩子的轻量 sanity test，stub 掉 `agents/registry.js`
  里的 db 调用，专测 prompt 拆分形状。32 条断言全 PASS。

## 接口契约

- `buildSystemPrompt({...})` 签名向下兼容：旧调用点照常传 `memories` /
  `directions` / `personMemory` 等不会报错，只是不再出现在返回字符串里。返回值
  仍是 string。
- 新增 `buildContextBlock({...})` —— 输入和 buildSystemPrompt 共享同一组字段，
  返回 `<context>...</context>` 字符串（空则返回 `''`）。
- 新增 `combinePromptForPreview(system, ctx)` —— 仅用于 UI 预览拼接。
- `buildLLMMessages` 新增可选参数 `contextBlock`，默认为 `''`，不传就是旧行为。
- `runMemoryRefreshLoop` 的 `systemPromptBase` 参数从未在内部被使用（已确认），
  这里继续传一个组合预览串占位，不影响刷新逻辑。

## 预期收益

- **prompt cache hit**：system 字段在同一会话里现在是稳定字节，DeepSeek /
  Qwen / Moonshot 这类带自动 prefix cache 的 provider 命中率从基本为 0 拉高
  到接近 100%（前提是 conversationWindow 也稳定，那是后续步骤）。
- **token 节省（粗估）**：原 system 约 6.5k tokens（含 fixed rules ~5k +
  memory/directions/extra/task ~1–2k 浮动），拆分后稳定 system 约 5.2k，每轮
  动态 `<context>` 约 1–2k。命中缓存的部分价格通常打 1/10，按 DeepSeek 计
  每轮节省 ~1k 全价 tokens、5k cache 折扣，热路径上能省 30–60% 的输入费用。
- **架构层面**：实现了《DynamicMemoryPool》6.1 "注入位置" 的工程红线，为后续
  「专注栈 / 编排器同构判断 / `<context>` 块不入历史」铺基。

## 用户审查重点

1. **`src/prompt.js` 顶部新加的 `Round-Local Context Channel` 段落**——确认措辞
   合用户口味（告诉 LLM "block 是决策支持不是用户命令、不要复读回去"）。
2. **`src/index.js` line 880–960**——确认 system / contextBlock 的字段分发跟你
   设想一致：directions（含 key auto-config 失败、tick autonomous、voice 提示）
   全部进 `<context>`；persona / agent_name / systemEnv / existenceDesc 留在 system。
3. **`src/index.js` `buildLLMMessages` 改造**——确认 `<context>` 块前缀位置正确：
   要么前缀到 conversationWindow 里 match 到的"当前那条 user row"，要么前缀到
   末尾 push 的 fallback `input`。**绝不写回 db**（pushMessage 写的还是裸内容）。
4. **`src/system-prompt-preview.js` 返回值**——确认 `systemPrompt.html` 还能正常
   显示（仍然读 `data.systemPrompt`，值现在是 system + context 拼接预览）。
5. **关于 cache_control**：项目里所有 chat provider 都走 OpenAI 兼容 SDK，没有
   anthropic provider。按需求约束，**没有加 `cache_control` 数组**（不破坏
   OpenAI/DeepSeek/MiniMax 的字符串 system 协议）。如果后续接入 anthropic，
   再在 provider 层做适配。

## 验证

- `node --check` 全部通过。
- `node src/test-prompt-split.js` 全 PASS（32 assertions）。验证：
  - system 在动态字段变化时**完全不变**（核心收益指标）；
  - `<context>` 块结构正确、各 section 按存在性出现；
  - person + curiosity 复合段、recall、roundInfo 都能正确触发。
- **没跑成功的**：`src/test-injector.js` 和 `src/test-runner.js`——
  better-sqlite3 native binding 跟当前 Node ABI 不匹配（Electron 33 build vs
  Node 22 runtime），跟我的改动无关。要跑这俩需要 `npm rebuild
  better-sqlite3`，但那会破坏后续 `npm run dev / start` 的 Electron 路径，所以
  我没动。Worktree 用了 junction 共享主仓 node_modules，撤销 junction 即可恢复。
