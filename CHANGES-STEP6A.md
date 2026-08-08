# Step 6a — LLM 焦点分类器生产路径修复

## 诊断结论

**真根因 = 排查清单的「最可能原因 1」**：`isFastUserMessage(msg)` 对所有 `priority >= PRIORITY.user`
的消息返回 true，而 `src/queue.js: resolvePriority()` 把 brain-ui / TUI / WeChat 等所有非 SYSTEM/REMINDER
的真实用户消息都标成 `PRIORITY.user=100`。所以生产环境每一条真实用户消息都进 fastUserPath，
`classifierEnabled: !fastUserPath = false`，LLM 仲裁**从未被调用过**。db 里 4 帧 topic 全是 v0 ngram
就是这么来的。原因 2/3/4（超时/解析失败/空 refine）也都是潜在风险，但都被原因 1 屏蔽到根本走不到。

## 修复方向：混合 A + B（推荐方向 B 作为主路径）

- **始终启用** LLM 仲裁（去掉 `!fastUserPath` 这个误关）。新增软开关 `state.focusClassifierDisabled`。
- 引入 `classifierMode`：
  - **`async`（fastUserPath 用）**：v0 同步建帧零延迟主对话，LLM fire-and-forget 在后台跑，
    返回后 patch 栈里那帧的 `topic` 字段，并通过 `onClassifierRefined` 回调触发
    `saveFocusStack`。帧若已出栈则丢弃 refine（参考 frameRef indexOf 判定）。
  - **`sync`（TICK/background 用）**：保留原本阻塞等 800ms 的语义，让主上下文构建前就拿到 refined topic。
- async 模式只回填 topic，不事后改栈结构（LLM 改判 kept/leaf/不同 action 时打日志但不动栈）——
  保证 v0 永远是稳定兜底，栈结构不会被 race 搞坏。
- `focus-classifier.js` 全链路加 console.log，覆盖：import 失败 / 抛错 / 超时 / aborted /
  JSON 解析失败 / normalize 拒掉 / 成功。

## 日志格式示例

成功：`[focus-classifier] v0=pushed topic=[广州今天,州今天天,今天天气] → llm=pushed (412ms) refined=[天气,广州,预报] ok`
超时：`[focus-classifier] v0=pushed topic=[...] → LLM 超时 (800ms 硬超时, 实际 803ms) → 回退 v0`
解析失败：`[focus-classifier] v0=pushed topic=[...] → LLM 返回 (520ms) 但 JSON 解析失败 raw="..." → 回退 v0`
async patch：`[focus-classifier] async patch frame.topic: [广州今天,州今天天] → [天气,广州,预报]`
async 帧已出栈：`[focus-classifier] async LLM 返回但帧已出栈 → 丢弃 refined topic`

## Build 2.1.149 后 dev console 预期

每条真实用户聊天消息进来后，应能看到至少一行 `[focus-classifier]` 日志：
要么 `→ llm=... ok` + `async patch frame.topic` 两行（LLM 正常工作），要么明确说明回退原因的一行。
连续聊几轮后 db 里 focus_stack 的 topic 字段应出现"桌面路径迁移"、"agent 命名"这类语义关键词，
而不再是纯 ngram。如果聊一轮日志里**完全没有 `[focus-classifier]` 行**，说明 v0 全部判 kept 或栈空 created，
LLM 本就不该被叫起来——这跟 db 里 ngram topic 不同的现象就能区分开了。

## 测试

`src/test-focus-classifier.js` 新增 3 个 async 场景：成功 patch / null 不 patch / 帧已出栈丢弃；
+ 原有 14 个 sync 场景全部保留。`src/test-focus-frame.js` 不变（一直跑 `classifierEnabled:false`）。
两个测试套件全部通过（56 + 80 assertions）。
