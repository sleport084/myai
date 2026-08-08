# 动态上下文记忆池 · 第 2 步：剔除 = 软隐藏（不硬删除）

## 改了哪些文件

- `src/db.js`：schema 三新列 + `hideMemoryByMemId` 工具函数 + 所有读路径加 `visibility = 1` 过滤
- `src/capabilities/executor.js`：`execMergeMemories` 把 `deleteMemoryByMemId` 换成 `hideMemoryByMemId`，事件载荷新增 `hidden` / `merged_into` 字段（`dropped` 保留为别名向后兼容）
- `src/memory/consolidator.js`：CONSOLIDATOR_PROMPT 把"drops are deleted"改成"drops become hidden (visibility=0)"
- `src/capabilities/schemas.js`：`merge_memories` 工具 description 同样改文案
- `src/memory/embedding-backfill.js`：backfill SELECT 加 `visibility = 1`，不给隐藏行算 embedding
- `src/test-visibility.js`（新增）：最小自检脚本，验证 schema + hide + 读路径过滤 + mem_id 探测不过滤

## Schema 迁移细节

三条 ALTER + 一个索引，都用 try/catch 包，幂等：

```sql
ALTER TABLE memories ADD COLUMN visibility INTEGER NOT NULL DEFAULT 1;
ALTER TABLE memories ADD COLUMN hidden_at TEXT;
ALTER TABLE memories ADD COLUMN merged_into TEXT;
CREATE INDEX IF NOT EXISTS idx_memories_visibility ON memories(visibility);
```

历史行 visibility 取默认值 1，不需要 backfill。**FTS5 索引、triggers、embedding 列完全不动**——
FTS5 仍索引全量内容（含隐藏），所有 search 路径 JOIN memories 时用 `m.visibility = 1` 过滤。
这是最简方案，避免 trigger 复杂度。

## 视野规则总结表

| 路径 | 看见隐藏行？ | 理由 |
|---|---|---|
| `searchMemories`（FTS5 + LIKE fallback） | 否 | 召回主路径，隐藏 = 看不见 |
| `searchMemoriesByKeywords` | 否（继承） | 内部走 searchMemories |
| `searchByEmbedding` | 否 | 向量召回主路径 |
| `getMemoriesByEntity` | 否 | 实体侧召回 |
| `getPersonMemory` | 否 | 根节点查询 |
| `getActiveConstraints` | 否 | 行为约束注入 |
| `getTaskKnowledge` | 否 | 任务知识注入 |
| `getToolMemories` | 否 | 工具知识注入 |
| `getOpinionsByTarget` | 否 | 顺手补，保证"隐藏=看不见"的不变量 |
| `getImpressiveBySource` | 否 | 同上 |
| `getCandidateEntitiesForConsolidation` | 否 | 否则反复挑出已合并实体 |
| `insertMemory` content/url/tool/root 去重 SELECT | 否 | 设计选择：隐藏记忆等于"概念上不存在"，让 LLM 重新插入为新记忆，下一轮 consolidator 自然合并；这是用户在任务里建议的方向 |
| `embedding-backfill` SELECT | 否 | 节省 API 调用 |
| `memoryExistsByMemId` | **是** | identify 用，要避免 UNIQUE 冲突 / 脏写 |
| `getMemoryByMemId` | **是** | merge 工具自己要能拿 drops 的当前状态 |
| `resolveMemId` / `resolveParentRef` | **是** | 父链结构性查找：被隐藏的父节点仍是合法挂载点，不该让结构断裂 |
| `ensureCanonicalIdentityRoot` 内部 upsert | **是** | canonical root upsert by mem_id，同上 |
| `getRecentMemories` / `getMemoriesByTimeRange` | **是**（未改） | 调用面只剩 `test-recognizer.js`；debug/inspection 用，未在任务列表，保留全见 |
| `src/api.js` 的 `/memories` 浏览 / `DELETE /memories/:id` | **是**（未改） | 仪表盘 admin 端点，操作员级显式动作；未在任务范围，保留全见。后续如要也过滤，再加 `?include_hidden=` 之类的查询参数 |

## 用户审查时重点看哪几处

1. **`src/db.js` 行 ~40 后**——三个新 ALTER + 索引；确认 try/catch 风格与上下文一致。
2. **`src/db.js` 行 ~607 起的 `hideMemoryByMemId`** + `VISIBLE_CLAUSE` 常量：核心新增。
3. **`src/capabilities/executor.js` `execMergeMemories`**：行为切换 + emit 事件新增 `hidden` / `merged_into` 字段（保留 `dropped` 为别名，旧 UI 不破）。
4. **`insertMemory` 三处去重 SELECT 都加了 `AND ${VISIBLE_CLAUSE}`**：这是设计判断，与 `memoryExistsByMemId`（不过滤）的对比要看明白——任务里特别要求标注。
5. `src/api.js` 的 admin 端点未改，是有意保留；如果你想全面隔离也很容易补。

## 验证情况

- `node --check` 全部通过：`src/db.js` / `src/capabilities/executor.js` / `src/memory/consolidator.js` / `src/memory/embedding-backfill.js` / `src/capabilities/schemas.js` / `src/test-visibility.js`
- `node src/test-visibility.js` 在本机跑不起来：better-sqlite3 native binding 与系统 Node 22 (NODE_MODULE_VERSION 127 vs 130) ABI 不匹配，与第 1 步同症，按指示**不 rebuild**。脚本逻辑已写好，下次跑 electron build / 或 node 版本对齐时可直接执行。
- 备注：本 worktree 是从 `8356926`（第 1 步合并前）拉的，所以没有第 1 步引入的 `src/test-prompt-split.js`，跳过该回归验证。
