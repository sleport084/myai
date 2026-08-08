# Windows 构建指南

本指南说明如何在 **Windows 机器** 上构建 MyAI 的 Windows 安装包（NSIS `.exe`）。

> ⚠️ Windows 包**必须在 Windows 上构建**。macOS 上无法交叉编译，因为 `better-sqlite3` 是 C++ 原生模块，需要 Windows 的 MSVC 编译器。

## 前置要求

| 要求 | 版本 | 说明 |
|------|------|------|
| **Windows 10/11** | x64 | 64 位系统 |
| **Node.js** | v20.15+ | 下载 https://nodejs.org/（选 LTS） |
| **Git** | 任意 | 下载 https://git-scm.com/ |
| **Visual Studio Build Tools** | 2022 | 安装时勾选「使用 C++ 的桌面开发」（编译 better-sqlite3 用） |
| **Python** | 3.9+ | 编译原生模块用（node-gyp 依赖） |

### Visual Studio Build Tools 安装要点

1. 下载 [vs_BuildTools.exe](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
2. 安装时在「工作负载」里勾选 **「使用 C++ 的桌面开发」**
3. 确保包含 **MSVC v143 - VS 2022 C++ x64/x86 生成工具** 和 **Windows 11 SDK**

## 构建步骤

```powershell
# 1. 克隆代码（或在 Windows 机器上获取项目源码）
git clone <仓库地址> myai-windows
cd myai-windows

# 2. 安装依赖（会自动安装 Windows 平台的原生模块）
npm install

# 3. 构建 Windows NSIS 安装包
npm run build:win
```

构建成功后，产物在 `dist/` 目录：

```
dist/
├── MyAI-Setup-0.0.1.exe          ← NSIS 安装包（给用户安装）
├── MyAI-Setup-0.0.1.exe.blockmap  ← 增量更新用
└── latest.yml                     ← electron-updater 自动更新元数据
```

## 常见问题

### Q: `npm install` 报 better-sqlite3 编译错误？

**A:** 确认 Visual Studio Build Tools 已装且勾选了 C++ 工作负载。运行 `npm config set msvs_version 2022` 指定版本。Python 路径也要对：`npm config set python "C:\Python39\python.exe"`。

### Q: 构建出的包首次打开被 SmartScreen 拦截？

**A:** 正常现象——安装包未代码签名。点击「更多信息」→「仍要运行」即可。长期解决方案是购买 Windows 代码签名证书并在 package.json 的 build.win 里配置 signing。

### Q: KWS 唤醒词（"小白龙"）在 Windows 上能用吗？

**A:** 能。`sherpa-onnx-win-x64` 平台包会在 `npm install` 时自动安装（已在 optionalDependencies 声明）。sherpa 的 Windows 原生库不涉及 macOS 的 DYLD 签名问题。

### Q: macOS 原生 ASR 在 Windows 上能用吗？

**A:** 不能——`native-speech-recognizer` 依赖 macOS 的 Speech.framework。Windows 上请使用云端 ASR（阿里云/腾讯云/讯飞），或等待未来基于 Whisper 的本地 ASR。

### Q: 内置 Chrome 浏览器在 Windows 上怎么工作？

**A:** 与 macOS 相同——优先用系统已装的 Google Chrome（`C:\Program Files\Google\Chrome\Application\chrome.exe`）。没装 Chrome 则 `browser_*` 工具报 `CHROME_NOT_INSTALLED`。

### Q: install_software 工具在 Windows 上的特殊行为？

**A:** `install_software` 是 **Windows 专属功能**，通过 `winget`（Windows 包管理器）安装软件。Windows 10 1809+ 自带 winget。这是 fork 相比 macOS 版多出的独有能力。

## 平台差异一览

| 功能 | macOS | Windows |
|------|-------|---------|
| 本地 ASR | ✅ macOS Speech.framework（离线） | ❌ 用云端 ASR |
| KWS 唤醒词 | ✅ sherpa-onnx | ✅ sherpa-onnx |
| 本地 embedding | ✅ transformers.js | ✅ transformers.js |
| install_software | ❌ 返回拒绝 | ✅ winget 安装 |
| 内置 Chrome | ✅ 系统 Chrome | ✅ 系统 Chrome |
| MCP 客户端 | ✅ | ✅ |
| 台风/飞书/scene UI | ✅ | ✅ |

## 如果需要代码签名

1. 购买 Windows 代码签名证书（EV 或 OV）
2. 在环境变量配置证书：
   ```powershell
   $env:CSC_LINK = "证书文件路径.pfx"
   $env:CSC_KEY_PASSWORD = "证书密码"
   ```
3. 运行 `npm run build:win`，electron-builder 会自动签名
