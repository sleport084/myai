# 🐉 小白龙 (MyAI Assistant)

**桌面 AI Agent — 你的个人数字助手**

小白龙是一个持续运行的桌面AI助手，基于 Electron + Vue3 构建，集成了大语言模型、语音交互、热点追踪、图片生成等能力，让你拥有一个真正的「贾维斯」式个人助手。

> 📌 **基于开源项目 [BaiLongma (白龙马)](https://github.com/xiaoyuanda666-ship-it/BaiLongma) v2.1.179 魔改**
> - 原项目：BaiLongma v2.1.179
> - 魔改后：MyAI Assistant v1.0.0
>
> 🙏 **特别感谢**：本项目基于 [BaiLongma](https://github.com/xiaoyuanda666-ship-it/BaiLongma) 开发，感谢原作者 [@xiaoyuanda666-ship-it](https://github.com/xiaoyuanda666-ship-it) 的无私开源贡献。白龙马是一个非常优秀的桌面AI Agent框架，提供了完整的LLM对话、记忆系统、语音交互、工具调用等核心能力。没有这个项目，就没有小白龙的诞生。开源精神万岁！🫡

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Mac-lightgrey)
![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ 核心能力

### 🧠 AI 对话
- 接入多种大语言模型（OpenAI兼容格式）
- 默认配置小米 MiMo v2.5 Pro
- 支持自定义 API 接入任意模型

### 🎤 语音交互
- **语音识别 (ASR)**：MiniMax / FunASR / 自定义 Whisper 兼容
- **语音合成 (TTS)**：MiniMax / Edge / 讯飞 / 自定义 OpenAI 兼容
- 支持连续语音对话模式

### 🖼️ 媒体生成
- **图片生成**：MiniMax / OpenAI DALL-E / 自定义兼容接口
- **音乐生成**：MiniMax
- 支持任意 `/v1/images/generations` 兼容服务

### 🌐 热点追踪
- 实时聚合多平台热点数据
- 支持：抖音、微博、小红书、微信
- 免费数据源，无需额外 API Key

### 🤖 Agent 能力
- 文件读写与管理
- 网页搜索与内容抓取
- 命令行执行
- 桌面快捷方式扫描
- 地理位置与天气信息
- 记忆系统（长期记忆 + 线程追踪）

---

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────┐
│                  Electron 桌面应用                 │
├─────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ 前端 UI   │  │ 语音模块  │  │  托盘/快捷键  │  │
│  │ (Vue 3)  │  │ ASR/TTS  │  │  系统集成     │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       │              │               │          │
│  ─────┴──────────────┴───────────────┴────────  │
│                    IPC Bridge                    │
├─────────────────────────────────────────────────┤
│                   后端服务层                      │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌─────────┐  │
│  │ LLM    │ │ Memory │ │ Tools  │ │ Social  │  │
│  │ 调用   │ │ 记忆   │ │ 工具   │ │ 社交    │  │
│  └────────┘ └────────┘ └────────┘ └─────────┘  │
├─────────────────────────────────────────────────┤
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌─────────┐  │
│  │ 热点   │ │ 天气   │ │ 媒体   │ │ Agent   │  │
│  │ 追踪   │ │ 地理   │ │ 生成   │ │ 扫描    │  │
│  └────────┘ └────────┘ └────────┘ └─────────┘  │
├─────────────────────────────────────────────────┤
│               SQLite 本地数据库                   │
│            (记忆 / 配置 / 线程 / 审计)            │
└─────────────────────────────────────────────────┘
```

### 技术栈
| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + Vite + CSS |
| 桌面 | Electron 33 |
| 后端 | Node.js (ESM) |
| 数据库 | better-sqlite3 |
| 语音 | Whisper / MiniMax / Edge TTS |
| 更新 | electron-updater (GitHub Releases) |

---

## 🚀 快速开始

### 下载安装
前往 [Releases](https://github.com/lushui1/xiaobailong/releases) 下载最新版本：
- **Windows**：`小白龙-Setup-x.x.x.exe`
- **Mac**：`小白龙-x.x.x.dmg`

### 首次启动
1. 安装并启动小白龙
2. 在设置中配置 AI 模型的 API Key
3. 开始对话！

### 从源码运行
```bash
git clone https://github.com/lushui1/xiaobailong.git
cd xiaobailong
npm install
npm start
```

---

## ⚙️ 配置说明

### AI 模型
在设置面板中配置：
- **Base URL**：API 地址（如 `https://api.openai.com/v1`）
- **API Key**：你的密钥
- **模型名**：如 `gpt-4o`、`mimo-v2.5-pro`

### 语音设置
- ASR 和 TTS 均支持自定义 OpenAI 兼容接口
- 自定义 ASR 走 `/v1/audio/transcriptions`
- 自定义 TTS 走 `/v1/audio/speech`

### 图片生成
- 支持自定义 OpenAI 兼容接口
- 走 `/v1/images/generations`

---

## 📦 项目结构

```
xiaobailong/
├── electron/          # Electron 主进程
│   ├── main.cjs       # 应用入口
│   └── preload.cjs    # 预加载脚本
├── src/
│   ├── index.js       # 后端入口
│   ├── llm.js         # LLM 调用
│   ├── voice/         # 语音模块
│   ├── memory/        # 记忆系统
│   ├── capabilities/  # 工具能力
│   ├── providers/     # 媒体提供商
│   ├── config/        # 配置模块
│   └── ui/            # 前端界面
├── skills/            # Agent 技能
├── build/             # 构建资源
└── scripts/           # 构建脚本
```

---

## 🛠️ 开发

```bash
# 开发模式（热重载）
npm run dev

# 构建 Windows 安装包
npm run build:win

# 构建 Mac 安装包
npm run build:mac
```

---

## 📄 License

MIT © D.KING

---

> 🐉 小白龙 — 让每个人都有自己的 AI 助手
