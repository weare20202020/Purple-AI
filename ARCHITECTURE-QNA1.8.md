# Purple AI 架构调研回答

---

## Part A — 目标与规模

### A1. 最终目标

```
☑ 多Agent协作
☑ A2A异步编排
☑ 长时间后台运行
☑ Tool-heavy workflow
☑ CLI优先（Windows Terminal），纯终端 UI
```

补充：不是 Claude Code 类开发助手，而是 **agent 间自主协作 + 人类监督** 的群组操作系统雏形。每个 agent 有独立角色（lead / researcher / engineer），通过 `send_message` 工具互相委托任务，结果汇总给用户。

### A2. 规模目标

```
当前：
  agent数量:    3（Alice / Bob / Carol）
  平均并发:     1~2（一个 agent 处理中，另一个等待回复）
  峰值并发:     3（全部 working）

未来目标：
  agent数量:    10~20
  平均并发:     3~5
  峰值并发:     8~10
```

当前每个 agent 一个进程 + 一个 HTTP server（127.0.0.1 不同端口），未来如果到 20+ agent，HTTP 轮询/启动开销需要考虑。

### A3. 运行时要求

```
☑ 必须 24/7 稳定运行（当前目标是，但实际尚未达到）
☑ Windows 优先
☑ Windows Terminal + PowerShell 为主要环境
☐ WSL 偶尔使用
☐ SSH/TMUX 支持不重要
☑ 低延迟交互优先（用户敲完回车希望秒回，agent 间异步等待可放宽）
```

---

## Part B — 当前架构

### B1. 真实调用路径

```
用户输入（键盘）
    ↓
REPL（Ink TUI 或 Classic readline）
    ↓
AgentManager.getActiveRuntime()
    ↓
AgentRuntime.processUserInput(input)
    ↓
AgentRuntime._processUserInput(input)
    ↓
┌─────────────────────────────────────┐
│ REACT LOOP（max 12 steps）           │
│                                     │
│  callLLM() ———→ LLM Provider        │
│      ↓                （OpenAI /    │
│  响应中有 tool_calls？               │   DeepSeek /    │
│      ├─ 无 → 返回用户                │   Anthropic）   │
│      └─ 有 → executeTool / Skill    │
│               ↓                     │
│           tool 结果 → addToHistory   │
│               ↓                     │
│           继续步骤循环                │
└─────────────────────────────────────┘
    ↓
结果返回 UI → stdout 渲染

Agent 间通信路径：
Agent A.executeSkill('send_message', { to: 'B', content: '...' })
    ↓
network.sendMessage(B.port, msg)
    ↓
HTTP POST http://127.0.0.1:<B.port>/receive
    ↓
B.MessageServer.onMessage(msg)
    ↓
B.Inbox.push(msg)
    ↓
B.drainInbox() → B.processIncomingMessage(msg)
    ↓
B 的 REACT LOOP（同用户输入路径）
    ↓
B 产生回复 → networkSend(A.port, reply)
```

### B2. Agent 通信方式

```
agent 之间：
  ☐ EventEmitter
  ☐ async queue
  ☐ message bus
  ☐ direct method call
  ☐ websocket
  ☐ IPC
  ☑ HTTP（localhost, 不同端口）
  ☐ custom transport

具体：每个 agent 启动一个 Express 风格 HTTP server，
listen 在 config/agents.json 中配置的 port。
send_message skill 用 fetch() 发 POST 到目标 port。
```

### B3. A2A 实现方式（伪代码）

```typescript
// skill/send-message.ts
async execute(params, ctx) {
  const target = loadAgents().find(a => a.id === params.to)
  if (!target) return { error: 'unknown agent' }

  // 如果目标没启动，自动启动
  if (!ctx.runtime.manager.getRuntime(target.id)?.running) {
    await ctx.runtime.manager.startAgent(target.id)
  }

  const msg: Message = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    from: ctx.runtime.profile.id,
    to: target.id,
    type: params.type ?? 'task',
    content: params.content,
  }

  const ok = await networkSend(target.port, msg)
  // networkSend = fetch(`http://127.0.0.1:${port}/receive`, { method: 'POST', body: JSON.stringify(msg) })
  if (!ok) throw new Error(`send_message to ${target.id} failed`)

  ctx.runtime.onTaskSent(target.id)  // 加入 workingAgents set
  ctx.runtime.onLog({ type: 'send_delivered', data: { to: target.id, toName: target.name } })
  return { success: true, messageId: msg.id }
}
```

### B4. 消息生命周期

```
Alice.send_message({ to:'Bob', content:'调研 X', type:'task' })
  │
  ├─ Alice 侧：
  │  1. HTTP POST Bob's port → /receive
  │  2. Alice 继续自己的 REACT LOOP（输出回复给用户）
  │  3. Alice.workingAgents.add('B')
  │  4. 用户看到 Alice 的回复 "已派 Bob 调研"
  │
  ├─ Bob 侧：
  │  1. Server 收到 POST → Inbox.push(msg)
  │  2. Inbox.drain() → processIncomingMessage(msg)
  │  3. Bob 的 REACT LOOP
  │  4. 调研完成 → 调用 send_message({ to:'Alice', type:'result' })
  │  5. HTTP POST Alice's port
  │
  ├─ Alice 侧（收到回复）：
  │  1. Server 收到 → Inbox.push
  │  2. processIncomingMessage(reply)
  │  3. workingAgents.delete('B')
  │  4. 处理结果（如果需要）
  │
  └─ UI 侧（agent 有输出时）：
      AgentRuntime.onOutput(text) → Ink setMessages() / Classic console.log
```

---

## Part C — UI / Terminal 实现

### C1. 当前 UI 栈

```
Ink version:     ^7.0.5（Ink + React 19）
React version:   ^19.2.6
ink-text-input:  ^6.0.0
readline:        原生 node:readline（ClassicREPL 回退）
node-pty:        不使用
blessed:         不使用
raw stdout:      Ink 内部使用，ClassicREPL 也使用 process.stdout.write
```

### C2. 当前 render 路径

```
agent 事件触发 UI 刷新：

agent.processUserInput() 完成
    ↓
AgentRuntime.onOutput(text) 回调
    ↓
manager.setOutputCallback → Ink setMessages(prev => [...prev, msg])
    ↓
React 状态变更 → Ink reconciler 调度
    ↓
Ink 内部计算虚拟 DOM diff
    ↓
Ink 写 ANSI 控制码到 process.stdout
    ↓
终端渲染

另一条路径（spinner/timer）：
setInterval(500ms) → setWorkingIds / setSpinnerTick
    ↓
React 状态变更 → 同上 Ink reconciler 路径
```

### C3. 所有触发 UI 刷新的来源

```
1. spinner timer        — 每 500ms setWorkingIds + setSpinnerTick
2. output callback      — agent 产生回复时 setMessages
3. log callback         — send_delivered 事件时 setMessages
4. user input submit    — handleSubmit 后 setMessages + setLoading
5. handleCommand        — /agents, /status, /help 等 push 消息
6. loading state        — submit 时 setLoading(true)，完成后 setLoading(false)

总计：6 个独立触发源，全部直接 setState，无协调
```

### C4. 当前谁会直接碰 stdout？

```
☐ Ink only（Ink 独占 stdout 在 TUI 模式下）
☑ console.log（ClassicREPL 大量使用）
☑ process.stdout.write（ClassicREPL 的 showPrompt）
☑ Ink 内部（render reconciler 写 ANSI 序列）
☑ tool subprocess（run_command tool 的子进程 stdout 不被截获）
☑ debug output（无统一 logger，四处 console.log）

注意：ClassicREPL 中 console.log / process.stdout.write 和 setInterval 的
spinner 输出是同时在线的，没有互斥锁。
```

---

## Part D — 性能 / 事件模型

### D1. 当前事件模型

```
☑ event-driven（setOutputCallback / setLogCallback / onLog）
☑ async/await orchestration（_processUserInput 的 REACT LOOP 是同步 await 链）
☑ polling（每 500ms 轮询 workingAgents）
☐ queue-based（Inbox 是 queue，但 UI 侧没有事件队列）
☐ actor model（每个 agent 有独立状态，但共享同一进程空间）
☑ mixed

总结：核心 agent 逻辑是 async/await + callback，UI 是 React state + timer polling，
两者之间没有统一事件总线。
```

### D2. 事件频率

```
单 agent 正常交互：
  events/sec: ~0.5-2（用户敲回车后等 LLM 返回，期间无事件）

工具密集场景（agent 连续调多个 tool）：
  events/sec: ~3-8（tool_call + tool_result 连续触发 onLog）

A2A 场景（多 agent 同时工作）：
  events/sec: ~5-15（各自 callLLM + tool + 通信）

spinner 固定：每 500ms 1 次（2 events/sec），不受业务影响
```

### D3. 是否有 streaming token UI？

```
LLM token streaming?  No

当前实现：所有 provider 的 generate() 都是 await 完整响应后才返回。
没有逐 token 推到 UI 的能力。如果需要低延迟交互，这是后续改进点。
```

---

## Part E — 问题现场（诊断）

### E1. 复现条件

```
运行多久出现？
  不是时间，而是经过 3~5 轮 agent 对话后出现。

多少 agent 出现？
  3 个全部运行（Alice/Bob/Carol），但实际 1 个在工作时就会出。

什么操作后出现？
  - 用户向 Alice 发消息
  - Alice 调用 send_message 给 Bob
  - Bob 处理并回复
  - Alice 汇总给用户
  大概 3~5 轮这样的 A2A 交互后开始出现滚屏 + 框选失效。

注意：第一次开终端时完全正常，恶化是渐进的。
```

### E2. 症状优先级排序

```
1  自动上滚（滚轮滚下去被强制拉回顶部，最影响使用）
2  框选失效（鼠标无法拖选 CLI 中的文字复制）
3  cursor 漂移（偶尔输入错位）
4  无明显 CPU 升高
5  无明显 UI 卡顿
```

### E3. 平台

```
☑ Windows Terminal
☑ PowerShell 7.x
☐ CMD
☐ WSL
☐ VSCode terminal（未测试）
☐ Linux tty
☐ tmux
```

### E4. 是否只有 Windows 出问题？

```
目前只在 Windows Terminal + PowerShell 上测试过。
无法确认是否 Linux/Mac 也有同样问题。

但根据经验，ANSI 控制码交错导致的 cursor 漂移和滚屏问题，
在 Linux 上也可能复现，只是 Windows Console 对异常 ANSI 序列更敏感。
```

---

## Part F — 代码结构

### F1. 目录结构

```
src/
├── index.ts                 入口（shebang → runCli）
├── types.ts                 核心类型（Message, AgentProfile, LogEntry）
│
├── agent/
│   ├── runtime.ts           Agent 运行时核心（820 行）
│   ├── manager.ts           多 Agent 编排（161 行）
│   ├── profile.ts           Agent 配置工厂
│   ├── spawner.ts           进程 fork
│   └── memory.ts            JSON 持久化
│
├── bin/
│   └── perple.ts            perple 入口（强制 ClassicREPL + verbose）
│
├── cli/
│   └── index.ts             Commander CLI（start/list/help）
│
├── config/
│   └── loader.ts            配置加载（agent list, LLM config, OpenCode 检测）
│
├── llm/
│   ├── types.ts             LLMProvider 接口, ToolCall, ToolDef
│   ├── registry.ts          Provider 注册/查找
│   ├── openai.ts            OpenAI 实现
│   ├── deepseek.ts          DeepSeek 实现
│   ├── anthropic.ts         Anthropic 实现
│   └── zod-to-json.ts       Zod → JSON Schema
│
├── memory/
│   ├── experience.ts        经验卡片（持久化、检索、相关性评分）
│   └── page-index.ts        文件索引（扫描/加载/格式化）
│
├── message/
│   ├── inbox.ts             Inbox（文件持久化队列）
│   └── queue.ts             PriorityQueue（内存优先级队列）
│
├── network/
│   ├── client.ts            sendMessage（HTTP POST）
│   └── server.ts            MessageServer（HTTP listener）
│
├── repl/
│   ├── index.ts             REPL 入口（自动选择 Ink / Classic）
│   └── classic.ts           ClassicREPL（readline + ANSI）
│
├── skill/
│   ├── types.ts             Skill 接口
│   ├── registry.ts          注册/查找
│   └── send-message.ts      send_message 实现
│
├── tools/
│   ├── types.ts             Tool 接口
│   ├── registry.ts          注册/查找
│   ├── read-file.ts         读文件
│   ├── list-dir.ts          列出目录
│   ├── write-file.ts        写文件
│   ├── grep-search.ts       Grep 搜索
│   ├── edit-file.ts         Find/Replace 编辑
│   └── run-command.ts       执行命令
│
└── ui/
    ├── app.tsx              Ink React TUI（387 行）
    └── banner.ts            ASCII art 横幅
```

### F2. 文件职责一句话

| 文件 | 一句话 |
|------|--------|
| `src/ui/app.tsx` | Ink React 组件：消息列表 + 输入框 + 命令补全 + 状态栏 |
| `src/repl/classic.ts` | readline 回退 UI：ANSI 框线消息 + 命令处理 + verbose 日志 |
| `src/repl/index.ts` | 自动选择：TTY → Ink / 否则 → Classic |
| `src/agent/runtime.ts` | 核心 agent 循环：LLM 调用 → tool/skill 执行 → 记忆管理 |
| `src/agent/manager.ts` | 多 agent 生命周期：启动/切换/创建/session 管理 |
| `src/cli/index.ts` | Commander CLI 入口：start/list/help 子命令 |
| `src/network/client.ts` | HTTP POST 发送消息到目标 agent |
| `src/network/server.ts` | HTTP listener 接收 agent 间消息 |
| `src/skill/send-message.ts` | 通过 network client 向另一个 agent 发消息 |
| `src/bin/perple.ts` | 强制 ClassicREPL + verbose 模式的辅助入口 |

### F3. app.tsx render 逻辑 + 典型 agent→UI 更新路径

**app.tsx 核心 render 结构**（JSX 树）：

```tsx
<Box flexDirection="column" height="100%">
  <StartupPanel />                          // 启动横幅 + agent 状态
  <Box flexGrow={1}>                        // 消息列表
    {messages.map(msg => <MsgBox />)}
    {loading && <Text>Thinking...</Text>}
  </Box>
  <Box>                                     // 底部输入区
    <InputBox />                            // ink-text-input
    <SuggestionBox />                       // 命令补全
    <Sep />                                 // 分隔线
    <StatusLine />                          // agent dots + spinner + usage
  </Box>
</Box>
```

**典型 agent→UI 更新路径**（完整链路）：

```
1. 用户在 ClassicREPL 输入 "调研 X"

2. handleUserInput("调研 X")
   → msgBox('User', input) 输出
   → agent.processUserInput("调研 X")

3. AgentRuntime._processUserInput("调研 X")
   → REACT LOOP step 1:
     → callLLM() → LLM 返回 tool_calls: [{ name:'send_message', args:{to:'B',...} }]
     → executeSkill('send_message', args)
       → onLog({ type: 'send_delivered', data: { to: 'B', ... } })
       → onOutput("已派 Bob 调研")

4。 manager.setOutputCallback 触发（classic.ts line 105-107）
   → pushOutput("已派 Bob 调研")
   → console.log(agentLines)  // ANSI 框线输出

5. manager.setLogCallback 触发（classic.ts line 108-113）
   → pushLogMessage("Bob 已确认收到消息")
   → console.log(系统消息)

6. Bob 侧收到消息 → processIncomingMessage
   → REACT LOOP → 调研完成
   → send_message({ to:'A', type:'result' })

7. Alice 收到回复 → processIncomingMessage
   → workingAgents.delete('B')
   → onOutput("Bob 回复：调研结果是...")

8. manager.setOutputCallback 触发
   → pushOutput("Bob 回复：调研结果是...")
   → console.log(agentLines)

9. printStatusLine()  // 每次 pushOutput/pushLogMessage 后都刷新
   → console.log(buildStatusLine())
```

注意步骤 4/5/8/9 全部用 `console.log` 写 stdout，且步骤 9 在步骤 4 和 5 之后各执行一次。

---

## Part G — 决策偏好

### G1. 想要的方案

```
☑ B 中量 — 允许改核心调度，但保持轻量
```

### G2. 允许的变更

```
☑ 新增 store
☑ 新增 scheduler
☑ 引入 event bus / coalescing 机制
☐ 改 Ink usage（不改 Ink 自身，只改使用方式）
☑ 改 REPL 调度逻辑
☐ 替换 UI 框架（保持 Ink）
```

---

## 补充：当前最痛点总结

从代码实际路径看，滚屏/框选失效的根因是：

```
问题 1：多路独立 setState
  - spinner timer（500ms）
  - onOutput callback
  - onLog callback
  - 这三条路径各自 setMessages / setWorkingIds，互不知晓，
    导致 Ink reconciler 可能收到交错的状态更新。

问题 2：stdout 没有单一写者
  - Ink 内部 reconciler 写 stdout
  - ClassicREPL 的 console.log 写 stdout
  - 两者可能同时写，ANSI 序列交错

问题 3：Windows Console Mode 漂移
  - setRawMode(true) 在异常退出后没恢复
  - 没有进程退出钩子保证清理
```

---

---

# Phase 1 最终修正方案（GPT 修正版，经人工审核通过）

## 改动清单（~200 行）

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/ui/store.ts` | 新增 | 单状态源，`get() / update(partial)` |
| `src/ui/scheduler.ts` | 新增 | 10fps 批处理，`enqueue(patch) → setTimeout(commit, 100)` |
| `src/repl/output-gate.ts` | 新增 | Classic stdout 序列化层，单写者 |
| `src/ui/terminal.ts` | 新增 | 终端清理：SIGINT/SIGTERM/exit/uncaughtException 恢复 cursor + raw mode |
| `src/ui/app.tsx` | 改造 | 所有 `setState` 改为 `store.update() → scheduler.enqueue()` |
| `src/repl/classic.ts` | 改造 | `console.log/process.stdout.write` 替换为 `outputGate.write()` |

## 不做的事

- ❌ 不做全局 `console.log` patch
- ❌ OutputGate 不做 dual mode（只服务 Classic）
- ❌ Phase 1 不强行事件驱动 spinner（保留 500ms polling 但加 dirty guard）
- ❌ 不用 `mitt`（用原生 `EventTarget` + 类型包装）
- ❌ 不删 Ink

## 执行顺序

1. `store.ts`
2. `scheduler.ts`
3. `output-gate.ts`
4. `terminal.ts`
5. 改 `app.tsx`
6. 改 `classic.ts`

## 验证标准

- ✅ 运行 6h 自动不上滚、框选正常
- ✅ `Ctrl+C` 后 cursor 恢复、终端状态干净
- ✅ Ink / Classic 模式下 stdout 无交错
- ✅ 模拟 10 agent / 50 events/sec 不出现 UI 漂移

---

*回答生成日期：2026-06-02*
*对应代码版本：purple-ai v0.1.0*
*Phase 1 最终方案确认时间：2026-06-02*
