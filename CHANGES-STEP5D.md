# Step 5d — 主线深化时剔除残留噪声（DynamicMemoryPool 3.5）

## Schema 改动（src/db.js）
- conversations 新增 `focus_absorbed INTEGER NOT NULL DEFAULT 0`（idempotent ALTER + try/catch）。
- 新增 `CREATE INDEX IF NOT EXISTS idx_conv_focus_absorbed`。
- absorbed != deleted：对话物理仍在表里，跟 memories.visibility 是平行的「软隐藏」概念。

## 标记触发时机（src/memory/focus-compress.js）
- 在 `compressPoppedFrame` 里、`insertMemory(focus_conclusion)` 之后、`emitEvent` 之前调用 `markConversationsAbsorbed(poppedFrame.startedAt, now)`。
- 关键先后：只有 conclusion 非空（cleanConclusion 后）且压缩流程没崩到这里，才会标记。否则对话会被错误永久隐藏。
- 同时把 focus-compress 自身读取压缩素材的 `getRecentConversationTimeline` 调用改为 `includeAbsorbed: true`，避免 overlapping frame 已经吸收掉的对话让本帧压缩器丢上下文。

## 注入过滤逻辑（src/db.js）
- `getRecentConversation(entityId, limit, maxHours, { includeAbsorbed = false })`：默认 `WHERE focus_absorbed = 0`。
- `getRecentConversationTimeline(limit, maxHours, { includeAbsorbed = false })`：默认 `WHERE focus_absorbed = 0`。
- injector.js / index.js 现有调用都不带第 4 参数，自动走默认过滤——主线注入只看到主线轨迹，子帧轨迹的总结通过 `<focus-history>` 的 conclusion 走另一条通道。

## admin 端点策略（src/api.js）
- `GET /conversations`（admin/debug）用裸 SQL，返回全量含 absorbed 行（多加了 `focus_absorbed` 字段到 SELECT 列）。operator 调试需要全貌。
- `POST /admin/reset-memories` 整表 DELETE，跟标记字段无关。

## 测试（src/test-noise-eviction.js）
- 隔离临时 USER_DIR，跑了 schema 列存在、索引存在、mark 前后行数、idempotent 重复 mark、includeAbsorbed=true 拿全量、timeline 同样行为、null startedAt 防御共 12 个断言。本地实测全 PASS。

## 已知 case
- **Race（v0 接受）**：compressPoppedFrame 是 fire-and-forget。用户在 frame pop 后毫秒级立刻发新消息时，compress 还没跑完 → 子帧对话还没标 absorbed → 新一轮 injector 把它们一起拉进去。v0 不承诺「绝对不出现噪声」，只承诺「绝大多数情况不出现」。代码注释已标。
- 多个 overlapping frame 同时跑压缩：focus-compress 自己读源时已经 includeAbsorbed=true，互不踩。但两个 frame 在同一时间区间各自压一次会产生两条 focus_conclusion 长期记忆（insertMemory 去重靠 content 哈希）。
