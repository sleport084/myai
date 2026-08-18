# Build Notes

记录 `electron-builder --win` 打包过程中遇到的问题及解决方案。

---

## 问题一：Array buffer allocation failed

**错误信息**
```
⨯ Array buffer allocation failed
  at readFileHandle (node:internal/fs/promises:542:23)
  at addWinAsarIntegrity (electron-builder/.../electronWin.ts:8:18)
```

**触发条件**  
`dist/` 目录存在旧构建产物时再次运行 `npm run build`。electron-builder 在写入 asar integrity 签名前会将已有的 `app.asar` 整体读入内存，文件体积（含 playwright）超出 Node.js 单次 Buffer 分配上限。

**解决**  
构建前先删除旧产物：
```bash
rm -rf dist
```

---

## 问题二：Go 打包器 OOM（runtime: pageAlloc: out of memory）

**错误信息**
```
fatal error: pageAlloc: out of memory

runtime.(*pageAlloc).grow ...
internal/cpu.doinit() ...
runtime.schedinit() ...
```

**触发条件**  
删除 `dist/` 后重新构建，electron-builder 内部的 Go 二进制（`app-builder`）在初始化阶段就崩溃。项目依赖 `playwright`（含完整浏览器二进制），使打包体积极大，超过 Go 运行时可申请的连续内存。

**解决**  
该 Go 二进制不受 `NODE_OPTIONS` 控制，无法直接调大。实际上根因是 `@electron/rebuild` 阶段已经把系统内存耗尽，见问题三。

---

## 问题三：@electron/rebuild 阶段 Node.js 堆 OOM

**错误信息**
```
FATAL ERROR: Committing semi space failed. Allocation failed - JavaScript heap out of memory
⨯ Rebuilder failed with exit code: 134
```

**触发条件**  
`npm run build` 默认在每次打包前都会执行 `@electron/rebuild`，对所有 native addon 重新编译以匹配 Electron 版本。项目含 `better-sqlite3` 和 `playwright`，依赖链庞大，重编译过程中堆溢出。

**根本原因**  
`postinstall`（`electron-builder install-app-deps`）已经完整做过一次 native 重建，`npm run build` 再做一次是冗余的。

**解决**  

1. 在 `package.json` 的 `build` 字段中禁用自动重建：

```json
"build": {
  "npmRebuild": false,
  ...
}
```

2. 运行构建时增大 Node.js 堆上限：

```bash
NODE_OPTIONS=--max-old-space-size=4096 npm run build
```

> **注意**：`npmRebuild: false` 后，如果更换了 Electron 版本或修改了 native 依赖，需要手动执行一次重建：
> ```bash
> npm run postinstall
> ```

---

## 最终可用的构建流程

```bash
# 1. 安装 / 重建 native 依赖（版本变更后必做，平时可跳过）
npm run postinstall

# 2. 清理旧产物（可选，防止旧 asar 读取 OOM）
rm -rf dist

# 3. 构建
NODE_OPTIONS=--max-old-space-size=4096 npm run build
```

产物路径：`dist/小白龙 Setup <version>.exe`

---

## package.json 关键配置

```json
"build": {
  "npmRebuild": false,
  "asar": true,
  "asarUnpack": [
    "**/node_modules/better-sqlite3/**",
    "**/node_modules/playwright/**",
    "**/node_modules/playwright-core/**"
  ]
}
```

`playwright` 和 `better-sqlite3` 已配置为 `asarUnpack`，它们的文件不会被打进 asar 压缩包，可避免运行时解压开销，同时也降低了 asar 本身的体积压力。

---

## 问题四：双架构打包时原生模块架构混入（Intel Mac 无法加载 better-sqlite3）

**现象**
npm run build:mac（默认 x64 + arm64 依次 rebuild + 打包）产出的 MyAI-0.0.1-mac-x64.dmg 内，
node_modules/better-sqlite3/build/Release/better_sqlite3.node 是 arm64 架构，
且 bin/ 目录缺失 darwin-x64-130 prebuilt。Intel Mac 上运行会 dlopen 失败，数据库功能不可用。

**根本原因**
electron-builder 打包时以 package.json 中 build.mac.target[0].arch 列表为准，
即使 CLI 传了 --x64 / --arm64 也会把列表里的架构全部打包。
构建脚本按 arch 依次 rebuild better-sqlite3 再打包：
- 第一次 rebuild(x64) → 打包 x64+arm64（此时模块正确）
- 第二次 rebuild(arm64) → 再次打包 x64+arm64，覆盖了 x64 DMG，
  而此刻 build/Release 已是 arm64 模块 → x64 包被污染。

**解决**
在 scripts/build-mac.mjs 中增加 withSingleArch(arch, fn)：每次打包前把
package.json 的 build.mac.target[0].arch 临时改为当前单架构，打包后恢复。
确认产出：
- x64 包：better-sqlite3/build/Release/better_sqlite3.node = x86_64
- arm64 包：better-sqlite3/build/Release/better_sqlite3.node = arm64

**验证命令**（挂载 DMG 检查架构）：
hdiutil attach -nobrowse -readonly -mountpoint /tmp/mnt dist/MyAI-0.0.1-mac-x64.dmg
file /tmp/mnt/MyAI.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node
hdiutil detach /tmp/mnt -force -quiet

**注意**
分别打包后 dist/latest-mac.yml 只包含最后一次打包的架构条目，
需手动合并两个架构的 url/sha512/size（sha512 用 shasum -a 512 计算）。
