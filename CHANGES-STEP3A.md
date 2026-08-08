# 第 3a 步：专注帧（Focus Frame）MVP

动态上下文记忆池架构第 3a 步——单帧 + 启发式分类 + 注入感知信号。**不做**栈、压缩回填、剔除残留噪声，也不持久化、不引入新 LLM 调用。

## 改动文件

- `src/memory/keywords.js` —— **新增**，从 `injector.js` 抽出 `extractKeywords`（纯函数，零外部依赖），让 focus 模块可以在不拉起 SQLite 原生绑定的情况下被单元测试。
- `src/memory/injector.js` —— `STOP_WORDS`/`STOP_CHARS`/`extractKeywords` 迁移到 `keywords.js`，本文件改为重新 `export { extractKeywords } from './keywords.js'`，对外 API 兼容。
- `src/memory/focus.js` —— **新增**，导出 `updateFocusFrame(state, message, { isTick, tickCounter })` 与 `FOCUS_FRAME_STALE_TICKS` 常量、`describeFocusFrameAge` 辅助函数。
- `src/prompt.js` —— `buildContextBlock` 新增 `focusFrame` / `focusTickCounter` 参数，在 `<task>` 之后、`<task-knowledge>` 之前输出 `<focus>` 段。
- `src/index.js` —— `state.focusFrame = null` 字段；`process()` 在 `runInjector` 之后调用 `updateFocusFrame`，并 `emitEvent('focus_frame', ...)`；`baseContextArgs` 透传 `focusFrame` 与 `focusTickCounter`。
- `src/test-focus-frame.js` —— **新增**，纯算法 sanity test。

## focusFrame 数据结构

```js
state.focusFrame = null   // 无专注
// 或：
state.focusFrame = {
  topic: ['prompt', 'cache', 'prefix'], // 当前帧的主题关键词（最多 3 个）
  startedAtTick: 12,                    // 第一次形成的 tickCounter
  lastSeenTick: 15,                     // 最近一次被命中保持的 tickCounter
  hitCount: 4,                          // 累计被命中的次数
}
```

**仅内存维护，不持久化。** 重启即丢，第 3c 步再处理持久化。

## 启发式规则（v0）

- **TICK 心跳不影响焦点**（叶子心跳不参与焦点判断），但 TICK 会触发 stale 清理检查。
- **消息长度 < 4 字符 / 关键词 < 3 个**：太空泛，不动。
- **无当前帧 + 关键词 ≥ 3**：创建新帧，`topic` 取 K 前 3 个，`hitCount=1`。
- **当前帧存在 + K ∩ topic 非空**：保持当前帧，`lastSeenTick = tickCounter`，`hitCount++`。
- **当前帧存在 + K ∩ topic = ∅**：直接切到新帧，覆盖 `topic`，`hitCount=1`。
- **stale 清理**：`tickCounter - lastSeenTick > FOCUS_FRAME_STALE_TICKS(=20)` 时 `state.focusFrame = null`。

## `<focus>` 段示例

```xml
<focus topic="prompt, cache, prefix" age="3 rounds since first seen, last seen this round">
You have been focused on this topic across recent turns. Stay aligned with it unless the user clearly pivots — in which case let it go without making a fuss.
</focus>
```

`age` 描述按 `hitCount` 与 `tickCounter - lastSeenTick` 计算；`hitCount == 1` 时为 `just started focusing on this`。措辞**故意写成感知信号、不是命令**——文档强调焦点漂移时要能自然退出。

## 已知局限

- **启发式 vs LLM 分类**：当前用 ngram + 停用词的纯算法切词，topic 取的常常是高频中文 ngram 而非语义核心词（例如 `'caching'` 进 topic 但 `'cache'` 没进，导致下一轮自然切换）。**这是预期内的**——任务说「v0 启发式判错预期内，反正用户一旦换话题下一轮立刻切」。
- **何时升级**：当 v0 误切率高到让 LLM 感受到「专注感不连贯」时，再引入一次轻量 LLM 调用做主题归类（v1）。
- **单帧 + 无栈**：所有焦点都互相覆盖，不能并行追多个话题。第 3b 步再做栈与压缩回填。
- **不剔除残留噪声**：虽然文档 3.5 说「主线深化时剔除」，但 MVP 故意不动，避免误剔除可见记忆。
- **UI 看不见**：后端已 `emitEvent('focus_frame', ...)`，但前端展示（focus banner 等）留给后面接。
