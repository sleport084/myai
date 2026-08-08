# Step 6b · 专注栈 UI：conclusion 为主，topic 为辅

把 Focus Stack 面板的视觉权重对调：conclusion 升为主标题，topic ngram 降为灰色小字辅助行。

## 改动文件 / 行数

- `src/ui/brain-ui/app.js`
  - `renderFocusFrame`（约 L1191–1229）：主行渲染最新 conclusion；topic 移到 `.focus-frame-sub` 次行；早期 conclusion 用 `.focus-frame-conclusion-earlier` 弱化显示。
  - `flashFocusCompressed`（约 L1250–1265）：动画目标由「最后一条 conclusion」改为「主行 `.focus-frame-main`」。
  - `focus_compressed` 事件处理（约 L1361–1394）：新 conclusion 直接写入主行；若主行已有旧 conclusion 则把旧值降级到早期列表，避免主行覆盖丢失上一条沉淀。
- `src/ui/brain-ui/styles.css`（L297–369 段）
  - 新增 `.focus-frame-main` / `.focus-frame-main-fallback` / `.focus-frame-empty-note` / `.focus-frame-sub` / `.focus-frame-conclusion-earlier`。
  - 保留旧 `.focus-frame-topic` / `.focus-frame-conclusion` 选择器以保兼容。
  - `just-added` 动画扩展到主行。

## 主行 / 次行内容选择策略

| 帧状态                          | 主行                                        | 次行                       |
| ------------------------------- | ------------------------------------------- | -------------------------- |
| 有 conclusion（≥1 条）          | `conclusions[末位]`，栈顶截 120 字，其他 80 | `topic: ngram · ngram · …` |
| 无 conclusion（刚创建未压缩）   | topic ngram + 斜体小字「（暂无沉淀结论）」   | 不显示（避免重复）         |
| 早期 conclusion（>1 条时）      | —                                           | 单独以 `-earlier` 弱化串列于 meta 下方 |

## 视觉权重对比

**前**（topic 主、conclusion 附属）：
```
个脚本 · 看看总 · 脚本                  ← 14px / cool / bold
  ↳ 我确认了桌面路径在 D:\...           ← 11px / dim
```

**后**（conclusion 主、topic 辅）：
```
我确认了桌面路径在 D:\...                ← 14px / cool / bold（栈顶）
topic: 个脚本 · 看看总 · 脚本            ← 10px / dim / mono（次行）
命中 N · 深度 1                          ← 9px / dim
```

非栈顶帧主行降为 12px / ink2、次行同样 10px / dim。栈顶字号、颜色突出度保持不变。

## 验证

```
node --check src/ui/brain-ui/app.js src/ui/brain-ui/app-shell.js  → OK
```

可逆：只前端 3 个函数 + 一段 CSS，无后端、无事件协议改动；后端 `conclusions` 数组结构未触碰。回滚直接 `git checkout` 这两个文件即可。
