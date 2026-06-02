<p align="center">
  <img src="https://img.shields.io/badge/version-1.8-8b5cf6?style=for-the-badge" alt="version">
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178c6?style=for-the-badge&logo=typescript" alt="typescript">
  <img src="https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge" alt="license">
  <img src="https://img.shields.io/badge/Node.js-22+-339933?style=for-the-badge&logo=node.js" alt="node">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-实验性-f59e0b?style=flat-square" alt="status">
  <img src="https://img.shields.io/badge/依赖-零图形-f97316?style=flat-square" alt="deps">
  <img src="https://img.shields.io/badge/PR-欢迎-3b82f6?style=flat-square" alt="prs">
</p>

<pre align="center">
██████╗  ██╗   ██╗ ██████╗  ██████╗  ██║      ███████╗
██╔══██╗ ██║   ██║ ██╔══██╗ ██╔══██╗ ██║      ██╔════╝
██████╔╝ ██║   ██║ ██████╔╝ ██████╔╝ ██║      ███████╗
██╔═══╝  ██║   ██║ ██╔══██╗ ██╔═══╝  ██║      ██║     
██║      ╚██████╔╝ ██║  ██║ ██║      ███████╗ ███████║
╚═╝       ╚═════╝  ╚═╝  ╚═╝ ╚═╝      ╚══════╝ ╚══════╝
</pre>

<p align="center">
  <strong>轻量 · CLI 优先 · 可完全本地运行的多 Agent 协作框架</strong>
</p>

<p align="center">
  多个 AI Agent 像<strong>真人团队</strong>一样协作 ——<br/>
  通过 HTTP 消息异步委托任务，你通过终端与任意 Agent 对话、指挥、监控。
</p>

<br/>

---

## 💜 为什么用 Purple AI？

大多数 AI 工具是一个助手 + 单轮对话。Purple AI 则是一个 **Agent 团队的操作系统原型**：

| 场景 | 怎么做 |
|---|---|
| 一个需求涉及编码、调研、架构设计 | 同时派给 Alice（架构）、Bob（调研）、Carol（编码） |
| 调研结果出来后需要调整方案 | Bob 的结果发给 Alice，Alice 调整方案后发给 Carol |
| 你在旁边看着，随时介入 | `/talk B` 切换到 Bob，`/talk C` 切换到 Carol |

**你不是用户，你是主管。**

---

## ✨ 特性

<div align="center">

| | |
|---|---|
| 🧠 **多 Agent 协作** | 每个 Agent 有独立身份、角色、HTTP 端口，对等通信 |
| 📨 **A2A 消息驱动** | Agent 间通过 HTTP POST 异步收发，Inbox 持久化防丢失 |
| 🔌 **多 LLM 后端** | OpenAI / DeepSeek / Anthropic（Claude），原生 function calling |
| 🧩 **工具系统** | 文件读写、编辑、搜索、命令行执行 —— 内置 6 个工具 |
| 🧬 **技能系统** | `send_message` 等技能让 Agent 间互派任务 |
| 📝 **持久记忆** | 经验卡片自动生成，关键词检索，跨 session 复用 |
| 📂 **页面索引** | 启动时扫描项目文件，自动注入相关上下文 |
| 💾 **短时记忆压缩** | 自动压缩早期对话，节省 token |
| 🔍 **自省（Reflection）** | 每 5 步自我审视，优化决策 |
| 🖥️ **全终端 CLI** | React Ink TUI + Classic REPL 双模式，零图形依赖 |

</div>

---

## 🚀 快速开始

```bash
git clone https://github.com/weare20202020/Purple-AI.git
cd Purple-AI/app

# 安装依赖（自动编译 TypeScript）
npm install

# 🎬 开发模式运行（tsx watch + 热重载）
npm run dev

# 或编译后运行
npm run build && npm start
```

> 💡 确保已配置 LLM API Key（见下方配置）。

---

## 📋 CLI 命令

| 命令 | 说明 |
|---|---|
| `purple start` | 启动默认 Agent 并进入交互模式 |
| `purple start -a <id>` | 启动指定 Agent |
| `purple list` | 列出所有 Agent |
| `/talk <id>` | 切换对话目标 |
| `/agents` | 查看所有 Agent 状态 |
| `/new` | 开启新对话 session |
| `/new agent <name> <role> [expertise]` | 创建并启动新 Agent |
| `/session [id]` | 查看或切换 session |
| `/default <id>` | 设置默认启动 Agent |
| `/start <id>` | 后台启动 Agent |
| `/status` | 当前会话信息（Agent / 模型 / 上下文用量） |
| `/index` | 重建文件索引 |
| `/help` | 显示所有命令 |
| `/quit` | 退出 |
| `/exit` | 退出（同 `/quit`）|

---

## ⚙️ 配置

### LLM 配置 (`config/default.json`)

```json
{
  "llm": {
    "provider": "openai",
    "apiKey": "sk-...",
    "model": "gpt-4o"
  },
  "defaultAgent": "A"
}
```

Provider 可选：`openai` · `deepseek` · `anthropic`

### Agent 定义 (`config/agents.json`)

```json
[
  { "id": "A", "name": "Alice",  "role": "lead",       "port": 3000, "expertise": ["planning", "coordination"] },
  { "id": "B", "name": "Bob",    "role": "researcher",  "port": 3001, "expertise": ["research", "data-analysis"] },
  { "id": "C", "name": "Carol",  "role": "engineer",   "port": 3002, "expertise": ["coding", "architecture"] }
]
```

> API Key 优先级：配置文件 → OpenCode 配置自动检测 → 环境变量

---

## 🏗️ 架构

```
User Input
    ↓
┌─ REPL ──────────────────┐
│  Ink TUI ← TTY ? → Classic │
└──────┬──────────────────┘
       ↓
┌─ AgentManager ──────────┐
│  会话管理 / Agent 生命周期   │
└──────┬──────────────────┘
       ↓
┌─ AgentRuntime (REACT Loop, max 12 steps) ───────┐
│  callLLM() → parse tool_calls → execute → loop   │
│         ↕                                        │
│  ┌─ LLM Provider ─┐  ┌─ Tool System ──────────┐  │
│  │ OpenAI          │  │ read-file / write-file  │  │
│  │ DeepSeek        │  │ edit-file / list-dir   │  │
│  │ Anthropic       │  │ grep-search / run-cmd   │  │
│  └────────────────┘  └────────────────────────┘  │
│         ↕                                        │
│  ┌─ Skill System ───┐  ┌─ Memory ─────────────┐  │
│  │ send_message      │  │ 经验卡片 / 页面索引    │  │
│  └──────────────────┘  └──────────────────────┘  │
└──────────────────────────────────────────────────┘
         ↕
┌─ Agent A (port 3000) ←→ Agent B (port 3001) ──┐
│         HTTP POST /receive                       │
└─────────────────────────────────────────────────┘
```

Agent 间通过 **HTTP + localhost** 通信，每个 Agent 独立端口、独立消息队列（Inbox），异步处理任务。

---

## 📦 项目结构

```
Purple-AI/
├── 📋 *.md              # 文档（根层）
└── 📁 app/
    ├── src/
    │   ├── index.ts      # 入口
    │   ├── types.ts      # 核心类型
    │   ├── agent/        # AgentRuntime + Manager + Spawner
    │   ├── cli/          # Commander CLI 入口
    │   ├── config/       # 配置加载
    │   ├── llm/          # OpenAI / DeepSeek / Anthropic Provider
    │   ├── skill/        # Skill 系统（send_message 等）
    │   ├── tools/        # 文件工具（read/write/edit/grep/list/run）
    │   ├── memory/       # 经验记忆 + 页面索引
    │   ├── message/      # Inbox 消息队列
    │   ├── network/      # HTTP 服务端/客户端
    │   ├── repl/         # 终端交互（Ink TUI + Classic REPL）
    │   └── ui/           # React Ink UI 组件 + Store + Scheduler
    ├── config/           # Agent 定义 & LLM 配置
    ├── data/             # 运行时数据（自动生成，gitignored）
    ├── dist/             # 编译产物
    ├── package.json
    └── tsconfig.json
```

---

## 🧰 技术栈

| 层 | 选型 |
|---|---|
| **语言** | TypeScript 5.8 (ES2022) |
| **终端 UI** | React 19 + Ink 7（TUI 模式）|
| **传统 REPL** | Node.js readline（回退模式）|
| **CLI 框架** | Commander |
| **HTTP** | Node.js 原生 `http` |
| **持久化** | JSON 文件 |
| **LLM** | OpenAI / DeepSeek / Anthropic API |
| **零外部依赖** ♻️ | 所有核心通信、持久化、工具系统均使用 Node.js 原生 API |

---

## 📸 界面预览

> *（截图待补 —— Ink TUI 紫色主题 + Agent 状态栏 + 消息气泡）*

---

## 🤝 参与贡献

欢迎提交 Issue 和 PR！项目处于早期实验阶段，方向包括：

- 支持更多 Agent（目标 10~20+）
- Agent 动态创建（`create_agent` 工具 + 审批流程）
- 纯进程内通信（去掉 HTTP，支持任意多开）
- Agent 专用工具库市场

---

## 📄 许可

[MIT](LICENSE) © 2025 Purple AI
