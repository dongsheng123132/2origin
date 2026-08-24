# 核心 Skill 清单（agentteams-bridge/0.1）

> 赛题对 Skill 的核验点是：**输入输出、调用条件、依赖工具、失败处理、验证方式、复用价值、版本演进、开源分发**。
> 本清单不按「我们集成了多少工具」排列，按**一个 Agent 要动世界或要判断世界时，必须经过哪几个咽喉**排列。
>
> 设计约定见 `ai-cli-design`：每个 Skill 都是一个本地 CLI，
> **stdout 只输出机器可解析的 JSON，stderr 给人看，判断走退出码**。
> 这条约定不是风格——它是 Skill 能被另一个 Agent 编程调用的前提。

---

## 分类总览

| 类 | Skill | 咽喉是什么 |
|---|---|---|
| 写世界 | `southbridge.write` / `southbridge.verify` | 一切落盘的唯一通道 |
| 写学历 | `xueji.append` / `xueji.set` / `xueji.put` | 一切状态变更的唯一通道 |
| 读世界 | `quxiang.observe` / `quxiang.reobserve` | 唯一的观察者 |
| 装上下文 | `northbridge.boot` / `northbridge.request` | 唯一的上下文投影器 |
| 发证 | `certify.stamp` / `certify.observe` / `certify.certify` / `certify.whoami` | 唯一的升降级通道 |
| 运行 | `runtime.start` / `runtime.health` / `runtime.stop` | WSL、Docker、容器、HTTP 的四层生命周期 |
| 复核 | `fact.recheck` / `xuetang.exam` | 事实与经验的生命周期 |
| 判据 | 15 个 `verify-*.mjs` 套件 | 所有主张的可证伪面 |
| 对账 | `oob.crosscheck` | 声称 ↔ 审计 ↔ 磁盘实数 |
| 锚定 | `governance.anchor` | 唯一不由我们自己签发的时间 |

---

## 1. `southbridge.write` — 受审计的落盘

```bash
node southbridge/southbridge-cli.mjs write --relpath demo/x.md --content-file - < body.md
```

- **用途**：Worker 唯一被允许的写文件方式。运行时自带的写文件工具一律不用。
- **输入**：`--relpath`（须以 `demo/` 开头）、`--content-file <路径|->`、`--mode write|append`、
  `--idempotency-key`、`--expect-sha256`
- **输出**：一行 `action.result` JSON。`status` 由**写后回头观察**决定，不由 `writeFileSync` 没抛错决定
- **调用条件**：任何要改变 `demo/` 下内容的动作
- **依赖工具**：Node ≥ 18；影核审计日志可写（不可写则 fail-closed，世界不动）
- **失败处理**：退出码 `0`=done/replayed · `2`=需批准 · `3`=拒绝（越界）· `4`=失败/diverged · `1`=用法错。
  `2` → 回 Matrix 房间请人；`4` → 重新读盘再来，**不得硬写**
- **安全边界**：白名单只有 `demo/`；受保护路径（`*.mjs`、`task.origin.json`、`schemas/`、`.claude/`）
  覆盖判 high risk，须出示 `expect_sha256`；覆盖前自动备份；批准凭据绑定到具体 effect hash
- **验证方式**：`node southbridge/verify-southbridge.mjs`（双驱动 parity + 差分幂等 + 批准出处）
- **复用价值**：任何「AI 要改生产文件」的场景都是这个形状——审批、幂等、可回滚、可定责
- **版本演进**：shadowcore/0.2。`0.1 → 0.2` 的动因是实测 MCP 通道被 harness 审批闸门整体堵死，
  才抽出「一核多影」；抽象的理由是实测，不是对称美

## 2. `southbridge.verify` — 给已完成的动作翻案

```bash
node southbridge/southbridge-cli.mjs verify --relpath demo/x.md [--expect-sha256 <h>]
```

- **用途**：独立再观察，让下游或另一个 Agent 有能力推翻「我做完了」
- **输出**：`verdict ∈ exists | missing | match | mismatch`
- **复用价值**：这是「结果验证」在多 Agent 里的最小单元——Manager 不必相信 Worker 的自报

## 3. `xueji.append` / `xueji.set` — 并发安全的状态写入

```bash
node southbridge/benjing-put.mjs <state> --append facts --value '{"claim":"…","verified":true,"source":"…"}'
node southbridge/benjing-put.mjs <state> --set current_state --value '新状态'
```

- **用途**：多个 Worker 并发改同一份状态而不互相吃掉
- **核心区分**：**追加可交换 → CAS 重试收敛；赋值不可交换 → 单次 CAS，分歧交给人。**
  给 `set` 加自动重试等于静默盖掉别人刚写的值
- **失败处理**：`0`=写入/无变化 · `3`=diverged（去合并，别硬写）· `4`=denied
- **安全边界**：`putState` 是所有写入路径的唯一咽喉，在那里执行五道闸门：
  乐观锁 → 必填字段 → 缩水检查 → schema 校验 → 事实/经验生命周期。
  **闸门会替调用方改东西（自封 verified 压回 candidate），并且必须出声**——
  正文进 stderr，清单进返回值的 `manifest`，两者同源
- **验证方式**：`node southbridge/verify-benjing.mjs`
- **复用价值**：任何「多个 AI 会话共享一份状态文件」的系统都会踩这个坑，本机实测被吃掉过学历

## 4. `quxiang.observe` — 唯一的观察者

```bash
node benxiang/observe.mjs <path>
node benxiang/reobserve.mjs
```

- **用途**：回答「盘上现在是什么样」
- **调用条件**：任何需要事实的地方。**别在部件里各写各的 `sha256`/`existsSync`**——
  那是「自证」在本仓库复发五次的结构性原因
- **安全边界**：**`observe()` 永不接收「你觉得应该是什么」，传第三个参数直接抛错。**
  比对必须是拿到观察之后的第二步（`compare(观察结果, 声明)`）
- **失败处理**：对象不存在如实报 `exists:false`，不抛错——很多事实描述的恰恰是「文件被删了」
- **验证方式**：`node benxiang/verify-benxiang.mjs`
- **复用价值**：这是所有「AI 自我报告不可信」问题的通用解法——把观察从执行里拆出来，
  并且禁止观察器知道期望值

## 5. `northbridge.boot` / `northbridge.request` — 上下文投影

```bash
node .claude/hooks/load-state.mjs
echo '{"prompt":"目标","session_id":"x"}' | node .claude/hooks/context-request.mjs
```

- **用途**：把学历投影成 Agent 能读的上下文
- **两个时刻**：`boot` 没有 goal，因此**不做任何相关性猜测**（确定性：同样磁盘状态跑两次逐字节相同）；
  `request` 有了 goal 才按相关性检索。**在 SessionStart 做筛选是猜不是筛**
- **安全边界**：**投影必须披露自己丢了什么。** `compileRequest` 返回 `manifest`：
  落选分六种，只有 `budget`/`max` 算遗漏（它们落选的原因是容量不是相关性），
  披露里必须带「未装载中最高分 vs 已装载中最低分」；`scope` 只出计数不出路径——列名字本身就是泄露
- **验证方式**：`node northbridge/verify-northbridge.mjs`
- **复用价值**：RAG / 上下文工程的通用病是「投影悄悄丢东西，读的人以为看到了全部」

## 6. `certify.stamp` / `certify.observe` / `certify.certify` — 发证分离（本桥新增）

```bash
node agentteams/certify.mjs whoami
node agentteams/certify.mjs stamp   --state <s> --lesson "…" --recheck "node …"
node agentteams/certify.mjs observe --state <s> --learning <id>
node agentteams/certify.mjs certify --state <s> --learning <id>
```

- **用途**：把「作者不能给自己发证」从单进程搬到多 Agent
- **输入**：学历路径 + 经验 id；身份**不从参数取**，由 `observeIdentity()` 观察
- **输出**：`certify.result` JSON；学历里 `exam.examiner` / `exam.separation_strength`；发证台账
- **调用条件**：`stamp` 由执行 Agent 调，`observe` 由取象 Agent 调，`certify` 由判据 Agent 调。**三个子命令而不是一个开关**
- **依赖工具**：Matrix homeserver（AgentTeams 自带 Tuwunel）、南桥（台账）、学籍（写回）、学堂（recheck 白名单）
- **失败处理**：`0`=通过 · `2`=闸门拒绝发证 · `3`=考试挂了（降级）· `4`=跑不起来/写失败 · `1`=用法错。
  **闸门拒绝时学历一个字节不改**，且拒绝本身也进台账
- **安全边界**：四道闸全部在**跑考试之前**（否则自证者虽拿不到证书仍能刷考试次数，判据 `C12`）；
  身份只有 `attested` 才准发证，`declared` 不算；作者是 `declared` 时不拦但必须落
  `separation_strength: examiner_only`——**不披露就是谎报证明强度**
- **验证方式**：`node agentteams/verify-agentteams.mjs`（33 条，29 条反向用例）；
  `node demo/agentteams-bridge/e2e-real-attestation.mjs`（真实 Tuwunel 三身份 12/12）
- **⚠ 已知强度上限**：单元判据里的 homeserver 是自带 stub，只证明**闸门逻辑**；
  实机链使用 AgentTeams 自带 Tuwunel，证明进程隔离与用户名空间隔离，不等于第三方运营的身份锚
- **复用价值**：任何多 Agent 系统都要回答「Worker 说完成了，凭什么信」。
  本模块不依赖 AgentTeams 的任何私有 API，只依赖一个 Matrix whoami 调用
  （`identity.mjs` 的探针 1）。
- **⚠ 关于「可替换成 OIDC / SPIFFE / K8s SA」**：结构上只需换掉那一个探针，
  但**这条尚未实测，因此现在不预先抽象成插件接口**。理由是本仓库自己的规矩——
  RFC-0004 §5 曾以「只有 1 个 driver 时属过早抽象」拒绝过「一核多影」，
  直到实测出第二条通道被堵死才动手；**抽象的理由是实测，不是对称美**。
  在出现第二个真实签发者之前，写「支持多种身份源」就是一句没有判据的话。
- **实弹**：`node demo/agentteams-bridge/probe-multiagent-selfcert.mjs`
  （复现旧路径下 Worker 自考自判 → 落盘 verified → 北桥注入的完整链路，退出码 1 = 洞仍在）

## 7. `runtime.start` / `runtime.health` / `runtime.stop` — 一键生命周期

```bash
node agentteams/runtime.mjs start --dry-run
node agentteams/runtime.mjs start
node agentteams/runtime.mjs health
node agentteams/runtime.mjs stop
```

- **用途**：固化 Windows + WSL2 上的常驻启动，不再依赖手工开的终端保活
- **输入输出**：环境变量配置见 `runtime.env.example`；stdout 一行 `runtime.result` JSON
- **成功判据**：专用 WSL pin、Docker daemon、三个容器、三个 HTTP 入口四层同时健康
- **失败处理**：`health` 不健康退出 3；动作失败退出 4，并给出失败 stage；URL 诊断会脱敏
- **幂等与回滚**：重复 start 不重复启动；stop 先停容器再停专用 pin，不误杀别的 WSL 会话
- **验证方式**：`node agentteams/verify-runtime.mjs`（8 条，含 Docker 不可达、HTTP 假活、停止顺序与无副作用 dry-run）
- **无密钥总检**：`node agentteams/selfcheck.mjs`；加 `--live` 才检查当前部署

## 8. `fact.recheck` — 事实也会过期

```bash
node southbridge/fact-recheck.mjs [--apply] [--root <目录>]
```

- **用途**：事实钉在证据物的 sha256 上，证据变了就降级为 `stale`
- **关键决定**：**遗忘按内容，不按时间。** 本机 git 无 remote、commit date 可伪造，
  `fact.when` 是自签时间，拿它做衰减等于把治理层刚赶出去的病从记忆层放回来
- **安全边界**：`stale` 只能由复核器给，手写会被 `putState` 压回；反方向同样拦；
  退役是墓碑不是删除（只改 `status`，`claim/source` 一字不动——`.ots` 锚点冻结的是当时的证据集合）
- **失败处理**：⚠ 沙箱测试**必须传 `--root`**，否则它扫真仓库
- **验证方式**：`node southbridge/verify-fact-lifecycle.mjs`（48 条）

## 9. `xuetang.exam` — 经验必须能被推翻

```bash
node xuetang/exam.mjs [--dry-run]
```

- **用途**：跑每条经验挂的 `recheck` 命令，按结果升降级
- **安全边界**：`recheck.run` 走白名单首词，**禁管道/重定向/换行**（跑命令不跑脚本）；
  `rm`/`touch` 明令拒绝——考试只许观察不许改变被观察的东西，也不能给自己造考场
- **已知洞（写在协议里，不藏）**：挂一个恒绿命令（`node --version`）就能骗过考试。
  v0.1 不假装解决，只让它**可见可数**：只有被观察到红过至少一次的考题才算 `proven`，
  其余标 `unproven` 并单独计数
- **验证方式**：`node xuetang/verify-xuetang.mjs`（33 条）

## 10. 判据套件 ×15 — 所有主张的可证伪面

```bash
node benxiang/verify-benxiang.mjs        node northbridge/verify-northbridge.mjs
node southbridge/verify-benjing.mjs      node southbridge/verify-fact-lifecycle.mjs
node southbridge/verify-southbridge.mjs  node southbridge/verify-todo.mjs
node xuetang/verify-xuetang.mjs          node oob/verify-oob.mjs
node governance/verify-governance.mjs    node governance/verify-anchor.mjs
node governance/verify-naming.mjs        node governance/verify-selfref.mjs
node agentteams/verify-agentteams.mjs    …
```

- **统一契约**：退出码 `0`=全过 / `1`=有失败；每套自报实际条数，**不硬编码计数**
- **核心设计**：**大部分是反向用例**——正向只能测「实现有没有跑」，测不出「判据成不成立」。
  故意造错的输入必须变红
- **给评审看的一句话**：这 15 套不是单元测试。单元测试问「代码有没有按我写的跑」，
  判据问「这个系统声称的属性还成不成立」。前者作者可以自己写自己过，后者不能

## 11. `oob.crosscheck` — 带外对账

```bash
node oob/crosscheck.mjs
```

- **用途**：三方对账——学历声称 ↔ 影核审计日志 ↔ 磁盘实数
- **失败处理**：退出码 `1` = **有分歧待解释**（不是错误，是需要人看）
- **安全边界**：发现者不做修复。让「分歧数=0」变成某个 Agent 的 KPI，它就会去优化那个数字

## 12. `governance.anchor` — 唯一不由我们自己签发的时间

```bash
node governance/anchor.mjs build|stamp|upgrade|verify
```

- **用途**：把此刻的证据集合压成指纹，交给 OpenTimestamps → 比特币区块头盖章
- **输出/失败处理**：`0`=已进比特币区块 · `3`=有快照但一个都没盖章 · `4`=与磁盘分歧 ·
  `5`=**核不动**（够不着日历服务器，仪器失效）· `6`=只有日历承诺尚未进块
- **四种结局不是两种**：旧版把 pending 和 bitcoin 数成一格，一个尚未进块的承诺就能挣来绿灯；
  同盘一小时内三次报出 12 / 11 / 1 个外部锚，差额全是网络。**所以别拿两次运行的锚点数做对比**
- **安全边界**：清单里**没有任何时间字段**（自己给自己写时间戳就是被批的那个病）；
  排除优先于收录，客户工作区/隐藏判据集/语料一律不锚定，且排除项只出计数不出路径
- **复用价值**：任何需要向外部举证「我们在某时刻确实有这份证据」的合规场景

---

## 版本、发布与回滚

- 全部 Skill 随本仓库同版本发布，`spec` 字段写在每个模块顶部（`shadowcore/0.2`、`xuetang/0.1`、
  `agentteams-bridge/0.1` …）。**协议号变更必须伴随判据套件变更**，否则那个版本号没有含义
- 回滚：南桥每次覆盖写前自动备份到 `southbridge/.backups/`，学籍写前备份到 `demo/.benjing-backups/`，
  返回值里带 `backup_path` 与 `undo_hint`——**reversible 是物证不是形容词**
- 开源分发：Apache-2.0（与 AgentTeams 一致），依赖仅 Node 标准库，无第三方运行时依赖
- ⚠ 历史备份与锚点快照里的旧命名**永远不改**——改一个字节 `.ots` 就失效。
  `demo/.benjing-backups/` 这个目录名因此永久保留旧名：**化石不是债，是证据链完整的证明**
