# Step 3b + 3c：专注帧从单帧升级到栈 + 压缩回填

## 改/新增文件

- `src/memory/focus.js`（**重写**）— 单帧 → 栈（数组形式），新增 `pushed` / `returned` 事件，stale 清理也走 poppedFrames。
- `src/memory/focus-compress.js`（**新增**）— fire-and-forget 压缩回填模块，含纯数据准备函数 `buildCompressionInput`。
- `src/prompt.js`（buildContextBlock）— 新增 `focusStack` 参数与 `<focus-history>` 段；保留 `focusFrame` 向后兼容（包成单元素栈）。
- `src/index.js` — `state.focusStack: []` 取代 `state.focusFrame`；process() 里更新事件 payload + 触发压缩回填（IIFE 双层 catch）。
- `src/test-focus-frame.js`（**重写**）— 适配栈模型，新增 returned / pushed / overflow / stale-with-pop / compress 准备函数等测试。

## 栈逻辑决策表

| 输入情况 | 事件 | 栈变化 | poppedFrames |
|---|---|---|---|
| TICK / 空消息 / kws<3 / 栈顶 idle 未超 | `noop` | 不动 | `[]` |
| 栈顶 idle > FOCUS_FRAME_STALE_TICKS | `cleared` | pop 栈顶 | `[oldTop]` |
| 栈空 + 有关键词 | `created` | push 第一帧 | `[]` |
| 栈顶 topic 与新 kws 有交集 | `kept` | 更新栈顶 lastSeen/hitCount | `[]` |
| 栈中**非栈顶**某帧与新 kws 有交集 | `returned` | pop 到那一帧 | 截掉的帧（栈底→栈顶序） |
| 栈中所有帧都无交集 | `pushed` | push 新帧 | 若超 MAX_FOCUS_DEPTH=4 则 shift 栈底 |

回归优先于深化：先从栈顶向下扫每一帧找交集，找到就 pop 回去；都没有才 push 新帧。这样用户回到旧主题不会被误判成"新子主题"。

## 压缩回填（focus-compress.js）

**触发时机**：`updateFocusFrame` 返回非空 `poppedFrames` 时，index.js 在 process() 里对每个被 pop 的帧启动一个 IIFE async 任务（双层 catch），主流程立刻往下走。

**数据流**：
1. `getRecentConversationTimeline(40, hoursSince)` + `getRecentActionLogs(50)`，按 `frame.startedAt` 过滤。
2. 全空 → 直接 return，不调 LLM。
3. `buildCompressionInput(poppedFrame, { conversations, actionLogs })` 拼成 ≤5000 字符的纯文本。
4. `callLLM({ systemPrompt: 压缩器 prompt, message, temperature: 0.2, thinking: false, tools: [], maxTokens: 150, mustReply: false })`
5. `cleanConclusion`：去 `<think>` 块、trim、剥包裹引号。
6. 非空结论 → push 进 `currentTopFrame.conclusions`（cap 5，滚动丢最旧）+ `insertMemory({ event_type:'focus_conclusion', salience:3, ... })`，timestamp 用帧的 `startedAt`。
7. `emitEvent('focus_compressed', { poppedTopic, conclusion, sessionRef })`。

所有错误吞掉，绝不冒泡到主对话。

## `<focus-history>` 示例

```xml
<focus topic="design, code" age="3 rounds since first seen, last seen this round">
You are currently focused on this topic. Stay aligned with it unless the user clearly pivots — in which case let it go without making a fuss.

Recent sub-focus conclusions (already absorbed, do not re-derive):
- 我查了 prefix cache 的命中条件，是 token-for-token 匹配，已经记下来了。
</focus>

<focus-history>
You also have unfinished background focuses you walked away from:
- "weather, guangzhou" — Last conclusion: 我查了广州今天的天气，告诉用户是晴 28°C。
- "side, idea" — (no conclusion yet)
</focus-history>
```

栈顶的 conclusions 是从子主题压缩回填来的，挂在 `<focus>` 段末尾（"主线"和"子主题沉淀"在同一段，让 LLM 看清当下专注是有积累的）。

## 已知局限

- 压缩回填用 `frame.startedAt` 直接过滤 conversations / action_logs；如果系统时钟漂移或帧创建时间与事件时间不在同一时区基准，可能漏拉。当前 `nowTimestamp()` 与 `new Date().toISOString()` 在主进程下一致，问题不大。
- 同一帧多次被 pop 触发的压缩调用不会去重（理论上不会发生，但 IIFE 是并发的）。
- `focus_conclusion` 长期记忆没有 `mem_id`，依赖 db 旧逻辑的去重；批量压缩可能产生近似条目，等待后续 consolidator 合并。
- `<focus-history>` 没有 idle 老化展示，所有非栈顶帧都会列出（cap=MAX_FOCUS_DEPTH-1=3）。
- 栈非持久化：进程重启后清零（与设计文档 3.1 一致）。
