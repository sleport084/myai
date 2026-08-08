# Step 5c — focus_stack 持久化

把 `state.focusStack` 从纯内存数组持久化到 sqlite，重启不丢栈。
对应「动态上下文记忆池」第 5c 步与红线 5.1「连续感不可破」。

## Schema
- 新表 `focus_stack`：`depth INTEGER PRIMARY KEY` + `topic / started_at / started_at_tick / last_seen_tick / hit_count / conclusions / updated_at`。
- 用 `CREATE TABLE IF NOT EXISTS`，老库幂等迁移，不改任何已有表。

## Save 触发时机
- `index.js` 在 `updateFocusFrame` 后，若 `focusResult.event !== 'noop'` 立刻 `saveFocusStack(state.focusStack)`（push/pop/touch/refresh 都覆盖）。
- `focus-compress.js` 新增可选 `saveStack` 回调；conclusion push 进栈顶 `conclusions` 后立即调用——让压缩回填也落库。
- 写入策略：`DELETE FROM focus_stack` + 批量 `INSERT`，包在 better-sqlite3 transaction 里，整栈原子替换；不做 UPDATE 部分行。

## 恢复路径
- `state` 初始化时同步调 `loadFocusStack()` 作为 `focusStack` 初值（better-sqlite3 同步）。
- `main()` 启动横幅后打印 `[focus] 恢复 N 帧专注栈：主线A > 子B > 当下C`，直观验证连续感。
- `loadFocusStack` 任何异常都返回 `[]`，不阻塞主流程。

## 已知 race
- `compressPoppedFrame` 是 fire-and-forget 异步任务；conclusion 回填可能比下一次 `saveFocusStack` 晚到。最坏情况：下一轮主线进来后写库一次（不含 conclusion），压缩完成后回调 `saveStack` 再写一次（含 conclusion）。最终一致，不丢数据。
- 若同一 tick 内多帧并发 pop，多次 `saveStack` 回调串行写库；better-sqlite3 同步 transaction 保证不互相覆盖。

## 测试
- `src/test-focus-persist.js`：临时 db 跑 5 项 round-trip 断言（空栈、单帧、三帧含 conclusions、原子替换、清空），全部通过。
