# Purple AI

> 轻量、CLI 优先、可完全本地运行的多 Agent 协作框架

多个 AI Agent 像**真人团队**一样，通过 HTTP 消息协作。用户通过 CLI REPL 与任意 Agent 对话，Agent 之间通过 `send_message` 技能异步委托任务。

---

## 特性

- **多 Agent 协作** — 每个 Agent 有独立身份、角色、HTTP 端口，对等通信
- **消息驱动** — Agent 间通过 HTTP POST 异步收发消息，Inbox 持久化防丢失
- **多 LLM 后端** — OpenAI / DeepSeek / Anthropic（Claude），原生 function calling
- **持久记忆** — 经验卡片自动生成，关键词检索，跨 session 复用
- **页面索引** — 启动时扫描项目文件，自动注入相关上下文
- **文件编辑工具** — `edit_file` find-replace 带备份和自动回滚
- **短时记忆压缩** — 自动压缩早期对话，节省 token
- **自省（Reflection）** — 每 5 步自我审视，优化决策
- **全终端 CLI** — 零图形依赖，纯终端交互

---

## 快速开始

```bash
# 安装依赖
npm install

# 开发运行
npm run dev

# 编译 + 运行
npm run build
npm start

# 全局命令（需要先 build）
npm link
purple start -a A
```

---

## 配置

编辑 `config/default.json`：

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

Provider 可选：`openai`、`deepseek`、`anthropic`。

Agent 定义在 `config/agents.json`：

```json
[
  { "id": "A", "name": "Alice",  "role": "lead",       "port": 3000, "expertise": ["planning", "coordination"] },
  { "id": "B", "name": "Bob",    "role": "researcher",  "port": 3001, "expertise": ["research", "data-analysis"] },
  { "id": "C", "name": "Carol",  "role": "engineer",   "port": 3002, "expertise": ["coding", "architecture"] }
]
```

API Key 优先级：配置文件 → OpenCode 配置自动检测 → 环境变量。

---

## CLI 命令

| 命令 | 说明 |
|------|------|
| `purple start -a <id>` | 启动并切换到指定 Agent |
| `purple list` | 列出所有 Agent |
| `/talk <id>` | 切换对话目标 |
| `/agents` | 查看所有 Agent 状态 |
| `/start <id>` | 后台启动 Agent |
| `/status` | 当前会话信息 |

---

## 项目结构

```
purple-ai/
├── config/          # Agent 配置 + LLM 配置
├── src/
│   ├── agent/       # AgentRuntime 核心循环 + Manager
│   ├── llm/         # OpenAI / DeepSeek / Anthropic Provider
│   ├── skill/       # Skill 系统（send_message 等）
│   ├── tools/       # 文件编辑、读写、搜索工具
│   ├── memory/      # 经验记忆 + 页面索引
│   ├── message/     # Inbox 消息队列
│   ├── network/     # HTTP 服务端/客户端
│   ├── repl/        # 终端交互
│   └── cli/         # Commander 入口
├── data/            # 运行时数据（gitignored）
└── package.json
```

---

## 技术栈

| 层 | 选型 |
|------|------|
| 语言 | TypeScript (ES2022) |
| CLI | Commander |
| 运行时 | Node.js |
| HTTP | Node.js 原生 `http` |
| 持久化 | JSON 文件 |
| LLM | OpenAI / DeepSeek / Anthropic API |

**无外部依赖**（除 LLM API 调用）：所有核心通信、持久化、工具系统均使用 Node.js 原生 API。

---

## 许可

MIT
