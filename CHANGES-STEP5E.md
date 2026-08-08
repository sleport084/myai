# STEP 5E — 专注帧观察面板（前端）

## 改了哪些文件
- `src/ui/brain-ui/app-shell.js` — 在右面板 `panel-l2` 的 `panel-stats` 之后、`update-card` 之前，插入一段 `<section class="focus-block">`（10 行新增）。
- `src/ui/brain-ui/styles.css` — 新增 `.focus-block / .focus-head / .focus-stack / .focus-frame*` 一组样式，含 `focus-conclusion-in` 淡入动画与 `focus-pulse` 高光动画（约 109 行新增）。
- `src/ui/brain-ui/app.js` — 新增 3 个 DOM 引用、`renderFocusStack / flashFocusCompressed / truncateConclusion` 等渲染函数，以及 `handle()` 里 `focus_frame / focus_compressed` 两个 case 分支（约 103 行新增）。
- 后端 `src/**/*.js` 一行未动。

## 面板布局
- 位置：右侧 `panel-l2` 顶部 stat-bar 下方，比"自主行动机制 · Tick"流更醒目。
- 形态：纯文本流，无卡片边框；上下用 `--line` 描一条分隔线对齐 update-card 风格。
- 内容：标题"专注帧"+ 当前栈深；下方按 栈底→栈顶 列出每一帧。
  - 栈顶（`.focus-frame.top`）：topic 用 `--cool` 加大加粗（14px），conclusion 用 `--ink2`（11px，最多 120 字符）。
  - 栈下层：topic 用 `--ink2` 11px，conclusion 用 `--dim` 10px 灰色（最多 60 字符），左侧一条 `--line` 竖线视觉上做"嵌套"。
  - 栈空：显示斜体"无专注"，data-state 切到 empty 时整块降到 55% 不透明度。

## 事件处理
- `focus_frame` → 直接用 payload 里的 `focusStack` 全量重渲染（简单、无状态、容错好）。
- `focus_compressed` → 后端已先发 focus_frame（栈已 pop 完）；为了即时反馈，DOM 里把 `conclusion` 追加到栈顶最后并走 `just-added` 淡入；整个 focus-block 走一次 `focus-pulse` 暖色脉冲。下一次 focus_frame 会覆盖回正确状态。
- 不轮询、不存任何本地状态。

## 可能的视觉调整建议（留给用户反馈）
- 高度上限：当前没设 max-height，理论上 4 帧叠满（MAX_FOCUS_DEPTH=4，每帧最多 5 条 conclusions）会比较高。如果挤掉了下方 tick 流，给 `.focus-stack` 加个 max-height 即可。
- 栈方向：当前栈顶在视觉最下方（贴近 tick 流），跟终端/思考流方向一致；如果用户更习惯"最新在最上"，把 renderFocusStack 里 `list.map` 改成 `list.slice().reverse().map` 一行即可。
- 命中数显示："命中 3"对外行可能不直观，可以换成"专注约 3 轮"或者干脆不显示。
- 不同 theme 下 `--cool` / `--ink2` 颜色已自动跟随，无需额外适配；arctic / sand 浅色主题里栈顶可能略浅，必要时给 `.focus-frame.top .focus-frame-topic` 加 `font-weight: 700`。
