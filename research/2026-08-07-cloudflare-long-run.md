# Cloudflare 长期任务环境调研（Long-running Agent）

> 2026-08-07 · 状态：调研记录 · 对应 `research/2026-08-07-长期任务设计-维护员与挑战跑道.md` 第四节
> 用户问题：Cloudflare 的基础设施（github.com/cloudflare/computer 或 blog）能不能做「长时间记忆 + 长期任务」挑战的环境。

---

## 一、结论（先给答案）

**能，而且 Cloudflare 已经为「长期 Agent」建好了整套基础设施**——但它的形态是
「持续存在、间歇运行」的 actor 模型，不是「一台一直跑着的虚拟机」。这对长期记忆 +
长期任务挑战**契合度很高**，但对「连续跑几小时重型任务」不合适。

| 问题 | 答案 |
|---|---|
| 能不能跑「活一年的 agent」？ | 能。Durable Objects 让 agent 持续存在，闲置休眠零成本 |
| 状态能跨天/跨月活吗？ | 能。`this.state` + SQLite 每次 setState 落盘，重启/崩溃都存活 |
| 长任务中途被杀会丢吗？ | 不丢。Fibers 中途 checkpoint，恢复时 `onFiberRecovered` |
| 成本怎么样？ | 闲置零成本。10,000 个 agent 各活跃 1% 只需 ~100 实例 |
| 是生产可用吗？ | **否**。cloudflare/computer 是 PREVIEW，API 不稳定、设计会变 |

## 二、调研对象一：github.com/cloudflare/computer

**是什么**：一个跑在 Durable Object 里的虚拟文件系统，权威状态存在 SQLite。
统一执行面 `workspace.runtime.exec(source, { backend })`，三个可插拔 backend：

| Backend | 干什么 | 适合 |
|---|---|---|
| **Container** | 通过 computerd daemon 把 SQLite 状态投影成 FUSE 挂载的真实沙箱容器 | 完整 Linux userland、真二进制、真网络 |
| **Isolate shell** | just-bash 跑在 Dynamic Worker，通过 RPC 访问 Workspace | 轻量 shell 活 |
| **Isolate JavaScript** | 动态 Worker 里执行 ES module，结构化 I/O、durable 相对导入、node:fs | 模块求值 |

**生态**：monorepo，含 `@cloudflare/dofs`（DO 文件系统）、`@cloudflare/computer-rpc`、
`@cloudflare/computerd`（FUSE daemon）、`@cloudflare/computer`（顶层包）。有 runnable examples：
一个 `think` 聊天 agent 用 workspace 当工作目录、一个教程（agent 写 markdown 配方、在容器里跑 pandoc 出 PDF）、artifact 发布与图片生成示例。

**Status**：PREVIEW ONLY，~4.6k stars，MIT。docs/ 是前瞻性的（「读它看意图，不是看现状」）。
接受 bug report / design proposal，**不接受未经请求的 PR**。

**对本象协议的启示**：**`think` agent 示例（用 workspace 当工作目录）恰好是「持久对象层 + agent」
的 Cloudflare 版实现**——它保存的是文件系统+SQLite 状态，本象协议保存的是对象+关系+状态+证据链。
两者的关系是「执行环境 vs 表示层」，不冲突，可结合。

## 三、调研对象二：Cloudflare Agents SDK + Durable Objects

2026 年 Cloudflare 已把 **Agents SDK** 建在 Durable Objects 上：
`DurableObject → Server → Agent`。这是对「长期 agent」最完整的官方表达。

### 3.1 核心模型：actor 模型

**长期 agent 不是一个持续运行的进程，而是一个持续存在的实体、间歇运行的实体。**
生命周期：Wake → `onStart()` → 处理事件 → 闲置（~2 分钟）→ 休眠 → 闹钟/请求唤醒。

### 3.2 什么状态能活下来

| 状态 | 存活机制 |
|---|---|
| `this.state` | 每次 `setState()` 落盘到 SQLite（cf_agents_state 表） |
| `this.sql` 数据 | 所有 SQLite 表都持久 |
| 定时任务 | 存 SQLite，闹钟触发唤醒 |
| 连接状态 | WebSocket `connection.setState()` |
| **Fiber checkpoints** | `runFiber()`/`stash()` 同步 checkpoint 中间状态 |
| **会话历史 + 上下文记忆** | Session API：树状消息历史 + 持久 context blocks（只读 scratchpad、可搜索、可加载的 skills），SQLite 支撑 |

**不活下来的**：内存变量（没走 setState）、运行中的定时器、打开的 fetch、局部闭包。

### 3.3 让长任务扛得住 eviction

DO 会被三种情况驱逐：闲置超时（~70-140 秒无流量）、代码更新/运行时重启（每天 1-2 次）、
alarm handler 超时（15 分钟）。应对原语：

- `keepAlive()` / `keepAliveWhile()` —— 30 秒 alarm 心跳防闲置驱逐
- `runFiber()` / `stash()` —— 任务注册进 SQLite，checkpoint 中间状态，被杀后 `onFiberRecovered()`
- `startFiber()` —— durable 接受后台任务，idempotency key 去重，可查状态可取消
- `chatRecovery` —— 每个 LLM turn 自动包一层 fiber，恢复中断的 LLM 流

### 3.4 子代理

父代理协调多个**完全隔离 SQLite** 的子代理（chat/文档/会话/项目各自的上下文）。
可嵌套、可调度回调、可跑 fiber、知道自己的 parent。`abortSubAgent()` 停子代理（存储保留）、
`deleteSubAgent()` 清存储。

### 3.5 2026 关键更新

- **Outbound connections keep DOs alive（2026-06-19）**：有活跃出站连接（如流式 LLM 响应）期间不再被驱逐。
- **Project Think（preview）**：开源加到 Agents SDK，让 AI agent 像网站一样部署到云——
  持久执行（fibers）、子代理、沙箱代码执行（五层执行模型：从轻量虚拟文件系统到完整沙箱）、
  持久会话、自写扩展。一条 `npx wrangler deploy` 部署到全球网络。
  成本模型从「按实例付费」变成「按实际使用付费」。

## 四、对本象协议挑战的适配分析

| 本象协议挑战的需求 | Cloudflare 能否满足 | 匹配度 |
|---|---|---|
| 长期存活（跨天/跨月/跨年） | ✅ DO actor 模型 | ★★★★★ |
| 持久状态（世界状态不丢） | ✅ SQLite + setState | ★★★★★（本象包本就是状态） |
| 长任务可恢复（不被杀就前功尽弃） | ✅ Fibers checkpoint | ★★★★★（对应本象事务语义） |
| 多任务并行（多连载/多项目） | ✅ 子代理 + 隔离存储 | ★★★★ |
| 成本（长期跑不破产） | ✅ 闲置零成本 | ★★★★★ |
| 沙箱执行（agent 真能动手） | ✅ Project Think 五层 | ★★★ |
| 重型连续计算（几小时推理） | ❌ 单次工作窗口有上限 | ★★ |
| 出站网络自由（调任意 API） | ⚠️ 受限制，需配 key | ★★ |
| 生产稳定性 | ❌ PREVIEW，设计会变 | ★★ |

## 五、结论与建议

**Cloudflare 适合做「对外挑战赛的公开跑道」**——所有人都能在同一套平台上跑长期 agent，
天然可复现、可比较，这正是「Long-running Agent Challenge」最需要的：
评测框架是开放的，运行环境由参赛者自选，Cloudflare 是其中最「零运维」的一个选项。

**Mac Mini 适合做「私有的长期维护员」**——有完整 shell、能跑重活、直接操作本地仓库和
本地模型通道（hermes）。两者不冲突，用户已决定两个都要。

**但要等到 Cloudflare 非 PREVIEW 再押注生产**：当前阶段用它的正确方式是
「设计+原型验证」，不是「把维护员跑在上面」。

---

> Sources:
> - [Long-running agents · Cloudflare Agents docs](https://developers.cloudflare.com/agents/concepts/agentic-patterns/long-running-agents/)
> - [Conversation state and memory · Cloudflare Agents docs](https://developers.cloudflare.com/agents/concepts/conversation-state-and-memory/)
> - [Outbound connections keep Durable Objects alive](https://developers.cloudflare.com/changelog/post/2026-06-19-outbound-connections-keep-dos-alive/)
> - [github.com/cloudflare/computer](https://github.com/cloudflare/computer)
> - [Project Think / Agents SDK](https://github.com/cloudflare/agents)
