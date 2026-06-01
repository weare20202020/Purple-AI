# Purple AI — 项目文档 V1.5

> **版本**：V1.5（2026-06-01）  
> **状态**：MVP 已完成，TypeScript 编译零错误，可运行  
> **定位**：轻量、纯终端 CLI 优先、可完全本地运行的多 Agent 协作框架

---

## 1. 项目概述

多个 AI Agent 像**真人团队**一样，通过 HTTP 消息协作。用户通过 CLI REPL 与当前活跃 Agent 对话，Agent 之间通过 `send_message` 技能异步委托任务。

- Agent 之间是对等的，每个有独立的身份、角色、端口
- 消息驱动：接收方自然唤醒 → 处理 → 回复
- 异步工作流：委托方不阻塞，接收方完成后通过 HTTP POST 回传结果
- 所有通信通过 Inbox 持久化（JSON 文件），崩溃后恢复

---

## 2. 技术栈

| 层 | 选型 |
|------|------|
| 语言 | TypeScript (ES2022 + ESNext modules) |
| CLI | `commander` (13.x) |
| 运行时 | Node.js (通过 `tsx` 开发 / 编译为 `dist/` 部署) |
| HTTP | Node.js `http.createServer` (无第三方依赖) |
| 消息持久化 | 本地 JSON 文件 (`data/<agentId>/inbox.json`) |
| LLM 接入 | Provider 接口 + Registry 模式 |

**不使用**：Ink / React（UI 层仅在终端 REPL，无图形 TUI）。

---

## 3. 项目结构

```
purple-ai/
├── package.json          # bin: purple, scripts: dev/build/start/lint
├── tsconfig.json
├── config/
│   ├── default.json      # LLM 配置 + defaultAgent
│   └── agents.json       # Agent 电话本 (A, B, C)
├── data/                 # 运行时数据 (gitignored)
└── src/
    ├── index.ts          # 入口: runCli()
    ├── types.ts          # Message, AgentProfile
    ├── cli/
    │   └── index.ts      # Commander CLI: start / list
    ├── repl/
    │   ├── index.ts      # REPL facade (自动选择渲染模式)
    │   └── classic.ts    # ClassicREPL: 纯终端 readline 交互
    ├── agent/
    │   ├── manager.ts    # AgentManager: 管理所有运行时实例
    │   ├── runtime.ts    # AgentRuntime: 核心循环 + LLM 调用 + Skill 执行
    │   ├── profile.ts    # Agent 配置辅助
    │   ├── memory.ts     # AgentMemory: 持久化经验记忆
    │   └── spawner.ts    # 子进程启动 / 停止
    ├── config/
    │   └── loader.ts     # loadGlobalConfig(), loadAgents(), findAgent()
    ├── llm/
    │   ├── types.ts      # LLMProvider 接口, LLMMessage
    │   ├── registry.ts   # Provider 注册中心
    │   ├── openai.ts     # OpenAI Provider
    │   └── deepseek.ts   # DeepSeek Provider (OpenAI 兼容 API)
    ├── message/
    │   ├── inbox.ts      # Inbox: 优先级队列 + JSON 持久化
    │   └── priority.ts   # PriorityQueue
    ├── network/
    │   └── server.ts     # HTTP Server (/receive) + HTTP 客户端
    ├── skill/
    │   ├── types.ts      # Skill 接口, SkillContext
    │   ├── registry.ts   # Skill 注册中心
    │   └── send-message.ts  # send_message 技能
    └── ui/
        └── app.tsx       # Ink TUI 应用 (暂时不使用)
```

---

## 4. Agent 系统

### 4.1 预定义 Agent（`config/agents.json`）

| ID | 名称 | 角色 | 端口 | 专长 |
|----|------|------|------|------|
| A | Alice | lead | 3000 | planning, coordination |
| B | Bob | researcher | 3001 | research, data-analysis |
| C | Carol | engineer | 3002 | coding, architecture |

### 4.2 AgentRuntime (`src/agent/runtime.ts`)

每个 Agent 运行时包含：

- **Inbox**：消息队列 + 持久化 JSON 文件
- **HTTP Server**：监听 `/receive` 端口，接收 A2A 消息
- **LLM 客户端**：通过 Provider 调用大模型
- **对话历史**：最近 100 条消息上下文
- **技能系统**：注册的 Skill 可通过 `[[skill_name params]]` 语法调用
- **后台轮询**：每 300ms 检查 Inbox 是否有新消息

核心方法：
- `processUserInput(input)` — 处理用户输入 → LLM 生成回复 → 执行 Skill
- `processIncomingMessage(msg)` — 处理 A2A 消息 → 注入聊天历史 → LLM → 执行 Skill
- `manager` 引用由 `AgentManager` 设置，用于跨 Agent 操作

### 4.3 AgentManager (`src/agent/manager.ts`)

- 管理所有 `AgentRuntime` 实例（`Map<string, AgentRuntime>`）
- 维护当前活跃 Agent ID
- 延迟启动：`startAgent()` 首次调用时创建 Runtime
- `switchAgent(id)` — 切换对话焦点，目标未运行则自动启动
- `getAllStatus()` — 返回所有 Agent 状态（运行/停止、是否活跃）
- 在模块级注册 OpenAI + DeepSeek Provider

### 4.4 启动流程

```
purple start -a A
  │
  ├─ Commander 解析参数
  ├─ saveDefaultAgent() 写入 config/default.json
  ├─ new AgentManager('A')
  ├─ manager.startAgent('A')
  │     ├─ findAgent('A') → 读取 agents.json
  │     ├─ new AgentRuntime(profile, dataDir)
  │     ├─ loadGlobalConfig() → 自动检测 LLM 配置
  │     ├─ runtime.setLLM(provider, apiKey, model)
  │     ├─ runtime.manager = this
  │     ├─ runtime.start() → inbox.load() + server.listen() + bgLoop
  │     └─ registerSkill(sendMessageSkill)
  └─ new REPL(manager).run()
```

---

## 5. LLM 集成

### 5.1 Provider 接口 (`src/llm/types.ts`)

```typescript
interface LLMProvider {
  name: string
  generate(messages: LLMMessage[], apiKey: string, model: string): Promise<string>
}
```

### 5.2 已注册 Provider

| Provider | 文件名 | 后端 API |
|----------|--------|----------|
| `openai` | `openai.ts` | OpenAI Chat Completions |
| `deepseek` | `deepseek.ts` | DeepSeek Chat Completions (OpenAI 兼容格式) |

### 5.3 配置自动检测 (`src/config/loader.ts`)

优先级链：

1. `config/default.json` — 项目自有配置文件
2. OpenCode 配置 — 自动检测 `~/.config/opencode/opencode.json`
   - 当 `default.json` 中 `apiKey` 为空时触发
   - 读取 `provider.DeepSeek.options.apiKey`、`baseURL`
   - 自动切换 `provider → deepseek`，`model → deepseek-chat`
3. 环境变量 — `OPENAI_API_KEY` / `DEEPSEEK_API_KEY`

**当前生效配置**（自动检测自 OpenCode）：
```
provider: deepseek
apiKey:   sk-6482280d89b54ddca7928e16272d054b
baseURL:  https://api.deepseek.com
model:    gpt-4o (保持 default.json 中的设置)
```

---

## 6. 消息系统

### 6.1 消息格式 (`src/types.ts`)

```typescript
interface Message {
  id: string
  timestamp: string
  from: string       // Agent ID
  to: string
  type: 'task' | 'result' | 'question' | 'summary'
  content: string
  context_summary?: string
  task_id?: string
  reply_to?: string
}
```

### 6.2 Inbox (`src/message/inbox.ts`)

- 基于 `PriorityQueue` 实现
- 消息持久化到 JSON 文件（`data/<agentId>/inbox.json`）
- `push(msg)` — 写入内存 + 同步到磁盘
- `pull()` — 返回最高优先级消息
- 支持优先级排序

### 6.3 A2A 通信

- **传输**：HTTP POST 到目标 Agent 的 `/receive` 端口
- **服务端**：`MessageServer` (Node.js `http.createServer`)
- **客户端**：`fetch()` POST 到 `http://localhost:<port>/receive`
- **接收处理**：
  1. HTTP handler 将消息写入目标 Inbox
  2. 目标 Agent 的后台轮询（300ms 间隔）拉取消息
  3. 消息注入为 `[From Name (id) via team message]` 格式的对话历史
  4. Agent LLM 生成回复，执行 Skill

---

## 7. Skill 系统

### 7.1 接口 (`src/skill/types.ts`)

```typescript
interface Skill {
  name: string
  description: string
  execute(params: Record<string, unknown>, ctx: SkillContext): Promise<void>
}

interface SkillContext {
  runtime: AgentRuntime  // 可访问 manager、profile 等
}
```

### 7.2 已注册 Skill

| Skill | 文件 | 功能 |
|-------|------|------|
| `send_message` | `send-message.ts` | 向同事发送消息 |

**`send_message` 工作流**：
1. LLM 回复中输出 `[[send_message {"to":"B","content":"...","type":"task"}]]`
2. `parseResponse()` 解析 Skill 调用
3. `executeSkill()` 执行：
   - 通过 HTTP POST 发送消息到目标 Agent
   - 调用 `manager.switchAgent()` 确保目标运行时可用
   - 调用 `runtime.onTaskSent(targetId)` 标记目标为 working

### 7.3 LLM System Prompt

Agent 的 system prompt 包含：
- 自身角色和专长描述
- 团队成员列表
- 协作规则（使用 `[[send_message ...]]` 语法委托任务）
- 异步工作流说明（不需要同步等待）

---

## 8. CLI 命令

### 8.1 全局命令

| 命令 | 说明 |
|------|------|
| `purple` / `purple start` | 启动 Purple AI（默认子命令） |
| `purple start -a <id>` | 以指定 Agent 身份启动 |
| `purple list` | 列出所有可用 Agent |
| `purple help` | 显示帮助 |

### 8.2 REPL 命令（运行时交互）

| 命令 | 说明 |
|------|------|
| `/talk <id>` | 切换到另一个 Agent |
| `/agents` | 列出所有 Agent 状态 |
| `/default <id>` | 设置默认启动 Agent |
| `/start <id>` | 在后台启动一个 Agent |
| `/status` | 当前会话信息 |
| `/help` | 显示帮助 |
| `/quit` / `/exit` | 退出 |

---

## 9. 关键设计决策

### 9.1 架构级决策

1. **AgentManager 为中心**：所有 AgentRuntime 由 Manager 统一管理，`switchAgent` / `startAgent` 通
    过 Manager 操作，避免每个 Runtime 维护全局状态。
2. **延迟启动**：Agent 仅在首次需要时（被 switch 或被 send_message 调用）才创建 Runtime，减少启动开销。
3. **`runtime.manager` 反向引用**：由 AgentManager 在 `startAgent()` 中设置，使 Skill 和 Runtime 能
    够跨 Agent 操作（如 `send_message` 需要调用 `manager.switchAgent`）。
4. **消息异步持久化**：所有 A2A 消息先写入 Inbox JSON 文件再处理，确保崩溃恢复。
5. **不阻塞委托**：Agent 发送 `send_message` 后本轮正常结束，等待目标完成后通过 HTTP 回传。

### 9.2 LLM 相关决策

1. **OpenAI 兼容 API**：DeepSeek 使用 OpenAI 兼容格式，减少重复代码
2. **OpenCode 配置自动检测**：发现用户已配置 OpenCode 且包含 DeepSeek key 时自动采用
3. **优先项目配置**：`config/default.json` 优先级高于环境变量
4. **`gpt-4o` 作为默认 model**：即便使用 DeepSeek provider，model 字段保留为用户可选

### 9.3 API 密钥

```
DeepSeek API Key: sk-6482280d89b54ddca7928e16272d054b
Base URL:         https://api.deepseek.com
来源:             C:\Users\weare20202020\.config\opencode\opencode.json
                 (provider → DeepSeek → options → apiKey)
```

---

## 10. 已实现功能清单（MVP）

- [x] TypeScript 项目骨架 + 零错误编译
- [x] Commander CLI：`start` / `list` 命令
- [x] 全局 `purple` 命令（`npm link`）
- [x] AgentManager：多 Agent 生命周期管理
- [x] AgentRuntime：LLM 对话 + Skill 执行 + Inbox 后台轮询
- [x] DeepSeek / OpenAI 双 Provider
- [x] OpenCode 配置自动检测
- [x] A2A HTTP 通信（`/receive` 端口）
- [x] Inbox 持久化（JSON 文件）
- [x] PriorityQueue 消息优先级
- [x] `send_message` Skill
- [x] ClassicREPL：终端交互（紫色主题、命令处理、输入分隔线）
- [x] Agent 状态管理（运行/停止、活跃切换）
- [x] 启动画面（PURPLE 字符画 + Agent 列表 + 配置摘要）
- [x] Startup/REPL 命令集：`/talk`, `/agents`, `/default`, `/start`, `/status`, `/help`, `/quit`

---

## 11. 约束与注意事项

1. **AI 助手不写 UI 代码** — UI 相关问题直接提问用户，不在本项目文件中加入 UI 设计
2. **Windows 路径** — OpenCode 配置文件在 `C:\Users\weare20202020\.config\opencode\opencode.json`
3. **ANSI 颜色** — 使用 `\x1b[35m`（紫色）和 `\x1b[95m`（亮紫），不引入 chalk 等第三方库
4. **优先自建核心** — 尽量使用 Node.js 原生 API（http、fs），减少外部依赖
5. **不引入 SVG/React** — TUI 和 CLI 保持纯终端输出，不需要前后端分离
6. **API key 不暴露** — 不在代码中硬编码，通过配置文件和环境变量注入
7. **`config/default.json` 不包含真实 API key** — 真实 key 通过 OpenCode 配置自动检测或环境变量获取
8. **持久化使用 JSON** — 保持简单，不用 SQLite 或 Vector DB
9. **所有通信本地 HTTP** — Agent 间通过 `localhost:<port>` 通信，无外部网络依赖（除 LLM API
    调用）

---

## 12. 构建与运行

```bash
# 安装依赖
npm install

# 开发运行（tsx hot-reload）
npm run dev

# 编译
npm run build

# 直接运行
npm start

# 全局 purple 命令（需要先 build）
npm link
purple start -a A

# 类型检查（等同 lint）
npm run lint
```
