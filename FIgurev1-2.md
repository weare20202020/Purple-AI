**✅ Purple AI 项目完整说明文档**  
**版本**：v1.2（2026年6月）  
**状态**：已确认，可直接给本地 Agent 阅读

---

### 1. 项目概述

**项目名称**：Purple AI

**一句话定位**：  
一个**轻量、纯终端 CLI 优先、可完全本地运行**的多 Agent 协作框架，让多个 AI Agent 像**真人团队**一样，通过私聊式消息自然协作。

**目标用户**：和 Hermes 一样，面向**所有人**（开发者、研究者、普通重度 AI 用户），希望易用但又极具可扩展性。

**核心理念**：  
- Agent 之间像真人一样发消息、被唤醒、继续对话。  
- 用户主要和**领头 Agent（A）** 在**同一个 CLI 会话框**聊天。  
- 中间过程安静可控，最终结果自然回到用户对话中。  
- 所有 Agent **完全对等**，拥有独立身份和持久记忆。

---

### 2. 核心需求

#### Agent 特性
- 每个 Agent 都是**独立对等个体**，拥有自己的 Profile（身份、专长、长期记忆、技能）。
- 支持**动态角色与权限**（可随时换组长、换团队，只需改配置）。
- 持久记忆 + 经验积累（会越用越聪明）。

#### 协作模式（最核心）
- **纯消息驱动**：任意 Agent 发消息 → 接收方自然唤醒处理 → 回复。
- **异步工作流**：A 给 B 发任务后本轮结束搁置；B 完成后再发消息唤醒 A，A 在**同一个 CLI 会话框**继续上下文、总结并回复用户。
- **消息来源必须区分**：Agent 要清楚消息来自 User 还是其他 Agent。
- **可选共享 MD 文档**：用于团队记录结果、节约 token。

#### CLI 体验要求
- **纯终端 CLI**（参考 OpenCode / Harness 风格，先不做 GUI）。
- **同一 Session 连续性**：必须在用户当前对话框中被唤醒继续。
- **用户优先**：用户输入最高优先级，A2A 消息排队等待。
- **按需启动**：Agent 未运行时可自动启动并加载历史 session。

---

### 3. 关键实现机制（已确认方案）

| 问题 | 解决方案 |
|------|----------|
| A 发消息后怎么等 B？ | A 调用 `send_message` 后正常结束本轮（不阻塞），可继续处理其他事或等待用户。 |
| B 完成如何唤醒 A？ | B 通过 **HTTP POST** 发送 JSON 消息到 A 的 `/receive` 接口。A 的运行循环检测到消息后**注入**为 Human Message，resume 当前 session 继续思考。 |
| 多个 Agent 同时回复 A？ | 使用 **Inbox + Priority Queue**，短时间内多条消息可**合并**处理，生成统一总结后再输出。 |
| Agent 进程挂掉消息丢失？ | 每个 Agent 有**持久化 Inbox**（本地 JSON 文件），消息先落地保存，重启后自动处理未读消息。 |
| A 正在和用户聊天时 B 的消息来了？ | **Output Lock + Priority Queue**：A2A 消息进入队列，用户输入可打断；正在输出时显示“正在处理团队事务，请稍等…”。 |
| 消息路由方式 | **推荐轻量混合**：每个 Agent 暴露本地 HTTP `/receive`（去中心），可选加一个极轻量中央 Hub（负责路由、监控、持久化）。 |
| 上下文共享 | **按需共享**：消息携带 `context_summary` + 共享 MD 文档 + 可选轻量共享 Vector Memory（不做完全共享，避免 token 爆炸）。 |

---

### 4. 技术选型（已确认）

- **主要语言**：**TypeScript**（推荐，用于异步逻辑、CLI、Skill 开发）。
- **核心高性能部分**：允许少量 **Rust**（可选，通过 Tauri 或直接 FFI）。
- **少量 Python**：允许用于特定 Skill 或工具调用（生态成熟）。
- **打包目标**：Windows 原生风格单个可执行文件（.exe），便于普通用户使用。
- **CLI 框架**：推荐 `commander.js` + `ink`（React-like CLI）或类似成熟方案。
- **HTTP**：轻量 HTTP Server（Node.js 或 Rust Axum）。
- **持久化**：本地 JSON 文件 + 可选轻量 SQLite / Vector DB。
- **LLM 调用**：支持多种后端（OpenAI、Claude、本地模型等）。

**短期目标**：先做出**纯终端 CLI Demo**（类似 Hermes / OpenCode 的使用体验）。

---

### 5. 消息格式（标准）

```json
{
  "id": "msg_xxx",
  "timestamp": "2026-06-01T...",
  "from": "B" | "USER",
  "to": "A",
  "type": "task" | "result" | "question" | "summary",
  "content": "详细内容...",
  "context_summary": "可选的关键上下文...",
  "task_id": "task_001",
  "reply_to": "msg_yyy"
}
```

---

### 6. 项目优势与差异化

- 比 Helio.im：完全本地、无需注册、私密、可深度定制、同一 CLI 会话自然唤醒。
- 比 Ruflo / Swarm 类：更对等、更自然、私聊式，而非单纯 orchestration。
- 比 Hermes 原生：更好的原生多 Agent 异步协作和 session 连续性。

---

### 7. 下一步开发建议（MVP）

1. 搭建基础 CLI + Agent Runtime（TypeScript）。
2. 实现 HTTP `/receive` + Message Injector。
3. 开发 `send_message` Skill + Output Manager。
4. 实现 Inbox 持久化 + 自动启动。
5. 验证完整闭环（A → B → A 同一框继续）。
6. 添加权限系统和共享 MD 支持。

---

**文档结束**

这个文档已经包含了我们目前所有讨论的核心内容、需求、实现机制和技术选型。你可以直接复制给你的本地 Agent 使用。

如果你需要增加「详细项目结构」、「MVP 任务清单」、「代码规范」或其他章节，随时告诉我，我立刻补充完善。