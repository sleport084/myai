# Step 5b — Focus classifier v0 → v1 LLM 升级

## 策略表

| v0 启发式判定 | 调用 LLM？ | 最终行为 |
|---|---|---|
| created (栈空) | 否 | 直接采用 v0，topic=ngram |
| kept (栈顶字面交集) | 否 | 直接采用 v0 |
| cleared / noop (TICK/短消息) | 否 | 直接采用 v0 |
| **pushed** (栈中无交集) | **是** | LLM 仲裁：同意→用 topic_refined / 改 returned / 改 kept / 改 leaf / 超时→v0 |
| **returned** (栈中旧帧交集) | **是** | LLM 仲裁：同意→按 returnsToDepth pop / 改 pushed / 改 kept / 改 leaf / 超时→v0 |

`classifierEnabled:false`（fastUserPath）下完全走 v0，零网络延迟。

## LLM prompt 概要

System：「对话焦点分类器」，输出 JSON `{action, topic_refined, returns_to_depth}`，action 取 `kept|pushed|returned|leaf`。
User：v0 判定 + 候选 topic + 当前栈快照（`[栈底"a,b" → 栈顶"c,d"]`）+ 新消息（截断 400 字）。
参数：`temperature=0.2, thinking=false, tools=[], maxTokens=120, mustReply=false`。

## 失败降级路径

`Promise.race` 800ms 硬超时（参考 injector.js embedding 兜底）→ LLM 抛错 / abort / 配额限流 / 解析失败 / 非法 action / 越界 returns_to_depth → 一律返回 null → 上层用 v0 结果。所有异常被 try/catch 吞掉，栈状态永不损坏。

## 已知局限

- v0 判 kept 的情况不走 LLM 校验 —— 字面交集强信号留给启发式，避免每条消息都调 LLM。代价：v0 误判 kept（关键词巧合）暂时无法被 LLM 救回。
- LLM 改判 returned 时只更新栈顶 hitCount/lastSeenTick，不改写旧帧 topic（保留语义身份）。
- 仲裁是同步等待的 800ms 串联在主链路里 —— fastUserPath 关掉避免实时延迟税；后台/任务路径接受这个成本换准确性。
- 配额限流时 callLLM 返回字面 fallback content，parseClassifierJson 解析为 null → 自动退回 v0，不会污染栈。
