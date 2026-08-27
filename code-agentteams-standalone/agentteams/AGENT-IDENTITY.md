# Agent Identity 清单（agentteams-bridge/0.1）

> 赛题要求「不少于 3 个不同职能 Agent」。本清单要说清楚的不是「我们分了几个」，
> 而是**为什么必须分，以及为什么是这么分的**。
>
> 绝大多数多 Agent 方案的分工来自任务流程（规划 / 执行 / 汇报）——那种分法里，
> 合并任意两个 Agent 都不损失任何**属性**，只损失一点并行度。本方案的分工来自一条
> 安全属性：**凭据的签发者不能是凭据的受益者**。合并任意两个角色，都会有一条判据变红。

---

## 0. 分工是从哪推出来的

本仓库有一条早就写死的铁律：**作者不能给自己发证**。它在单进程下由 `xuetang/exam.mjs`
落实——写经验的人只能写 `candidate`，`verified` 只能由考试给。

把这套东西搬到多 Agent 上时，这条铁律**当场失效**，原因很朴素：

```
exam.mjs 是一个任何 Worker 都能自己跑的脚本。
Worker 干完活 → 自己跑一遍考试 → 自己给自己发证 → 现有每一道闸门都放行。
```

放行是因为学历里从来只记「有没有考试通过记录」，不记「考试是谁跑的」。
盘上 58 条经验，49 条自称 `verified`，**考官字段一律为空**——那不是数据缺失，
是这个问题在单进程时代根本没被问过。

要问出这个问题，就得有一个**我们自己造不出来的身份签发者**。
AgentTeams 恰好是：Worker 的 Matrix 身份由 homeserver 签发，
`/_matrix/client/v3/account/whoami` 的答案来自一个我们控制不了的进程。

于是三个角色是被推出来的，不是被分出来的：

| 如果合并 | 哪条属性没了 | 哪条判据变红 |
|---|---|---|
| 执行 + 判据 | 作者给自己发证 | `C3 self_certification` |
| 执行 + 取象 | 自己干的活自己看，观察退化成确认偏误机 | `O3 observer_is_author` |
| 判据 + 取象 | **判决依据由判决者自己生产** | `O4 observer_is_examiner`、`O1`（行为）、`O1b`（源码） |
| 少了取象这一环 | 考官无凭无据也能发证 | `O2 no_observation` |
| 任意 + 审计 | 对账方与被对账方同源 | `oob/crosscheck.mjs` 退出码失去意义 |

> **「判据 + 取象」这一格是 v0.2 补的，而 v0.1 漏了它。**
> v0.1 四道闸拦住了「作者给自己发证」，却让考官**自己跑考题、又自己采信结果**——
> 那是同一个病换了位置（透镜：决策权与判断依据分离）。
> 所以第三个 Agent 不是为了凑赛题的「不少于 3 个」，是从这个洞推出来的。
> 现在**整个协议里只有 `observe` 子命令会执行命令**，`certify` 一行都不跑（`O1b` 逐字锁住）。

这与本仓库另一条已经落地的原则同源：**可审计性来自我们控制不了的东西。**
时间锚在比特币区块头（`governance/anchor.mjs` → OpenTimestamps），
身份锚在平台签发的 Matrix 令牌。两者是同一条原则的两个实例。

---

## 1. 执行 Agent · Executor

| 项 | 内容 |
|---|---|
| **AgentTeams 载体** | Worker（运行时 OpenClaw / Hermes / QwenPaw 均可） |
| **职责** | 领任务、干活、落盘、登记经验 |
| **输入** | Matrix 房间里的任务消息；北桥装载的学历上下文（`northbridge/compile.mjs`） |
| **输出** | `demo/` 下的产物文件；学历里的 `facts` / `actions` 追加；`candidate` 经验 |
| **可用工具** | 南桥 CLI（`southbridge-cli.mjs write/verify`）、学籍字段级写入（`benjing-put --append`）、`certify.mjs stamp` |
| **禁止** | 直接用运行时自带的写文件工具改 `demo/`；写 `status: verified`；调用 `certify.mjs certify` |
| **权限边界** | 只持有 Higress 签发的消费者令牌，拿不到真 API Key；写路径限白名单 `demo/`，受保护路径（`*.mjs` / `task.origin.json` / `schemas/`）覆盖需 `expect_sha256` |
| **状态流转** | 产出的经验一律停在 `candidate`，等判据 Agent 发证 |
| **异常分支** | 南桥返回 `requires_approval`(2) → 回房间请人；`diverged`(4) → 重新读盘再来，**不得硬写**；`denied`(3) → 越界，停 |
| **它凭什么不能作弊** | 自封 `verified` 会被 `putState` 的写入闸门压回 `candidate` 并在 stderr 出声；自己调 `certify` 会撞上 `C3` |

## 2. 取象 Agent · Sensor

| 项 | 内容 |
|---|---|
| **AgentTeams 载体** | Worker（独立容器、独立 Matrix 身份） |
| **职责** | 只回答「盘上现在是什么样」，不回答「应该是什么样」 |
| **输入** | 待观察对象的路径。**只有路径。** |
| **输出** | `state.object` 观察结果（exists / size / sha256 / mtime）；`benxiang/observations.jsonl` 追加一轮 |
| **可用工具** | `benxiang/observe.mjs`、`benxiang/reobserve.mjs`、`southbridge-cli.mjs verify` |
| **禁止** | 接收任何形式的「预期值」；写任何文件（`observations.jsonl` 除外）；参与判决 |
| **权限边界** | 只读。它是唯一被允许说「世界现在什么样」的角色 |
| **异常分支** | 对象不存在 → 如实报 `exists:false`，**不报错**（很多事实描述的恰恰是「文件被删了」） |
| **它凭什么不能作弊** | `observe()` 传第三个参数直接抛错——观察器一旦收预期就退化成确认偏误机。`identity.mjs` 的 `observeIdentity()` 同理：传任何参数都抛错（判据 `I1`） |

## 3. 判据 Agent · Examiner

| 项 | 内容 |
|---|---|
| **AgentTeams 载体** | Worker（**必须**是与执行 Agent 不同的 Matrix 身份） |
| **职责** | 只读取象 Agent 产生的观察证据，按结果给经验升降级；给执行 Agent 的「我做完了」翻案 |
| **输入** | 学历路径 + 待考经验 id |
| **输出** | `certify.result` JSON；学历里 `exam.{runs,passes,fails,examiner,separation_strength}`；发证台账 |
| **可用工具** | `agentteams/certify.mjs certify`。**没有别的**——它读观察记录，不执行任何命令 |
| **禁止** | 修改被判对象；**执行任何命令**（v0.2 起，判据 `O1b` 逐字检查 `cmdCertify` 段内不得出现 `spawnSync`/`execSync`/`exec(`） |
| **权限边界** | 只能改学历里 `learnings[].status`、`exam`、`observation.consumed_by` 三处；八道闸门全部在写盘之前：G1 考官须 attested / G2 须知作者 / G3 考官≠作者 / G4 recheck 形式可跑 / G5 必须有观察记录 / G6 观察者须 attested 且 ≠作者≠考官 / G7 观察须对应当前考题（改题即作废）/ G8 观察未被用过（防重放） |
| **状态流转** | `pass` → candidate 升 verified；`fail` → verified 当场降 candidate；`error` → 不升不降 |
| **异常分支** | 够不着 homeserver → 报 `examiner_unreachable`、退出 `4` 并拒绝发证，但不判经验对错（仪器失效 ≠ 被测对象的属性） |
| **它凭什么不能作弊** | 身份必须 `attested`（问过 homeserver），`declared` 不算；拒绝发证也要留台账（判据 `C7`）——只在通过时记账的账本，记的是喜报不是历史 |

## 4. 审计 Agent · Auditor（第四个，可选但强烈建议）

| 项 | 内容 |
|---|---|
| **AgentTeams 载体** | Worker，或由 Manager 定时触发 |
| **职责** | 只读复核已发证记录：证书、观察、角色分离与人工确认回执必须内部一致 |
| **输入** | 学历路径 + learning id（需要复核回执哈希时带回执路径） |
| **输出** | `certify.result` JSON（逐项 findings）与认证台账 |
| **可用工具** | `agentteams/certify.mjs audit` |
| **禁止** | 修复它发现的分歧（发现者不做修复，否则「分歧数=0」会变成它的 KPI） |
| **异常分支** | 退出码 2 = 有分歧待解释/审计拒绝（身份未签发、角色重合、证书不一致、人工回执缺失），交回房间给人；退出码 4 = 仪器故障（身份服务不可达、超时）；锚定退出码 5 = 够不着日历服务器（仪器失效），6 = 只有日历承诺尚未进块 |

---

## 5. 一轮完整闭环长什么样

```
人在 Matrix 房间下任务
      │
      ▼
Manager 拆解，派给 Executor
      │
      ▼
Executor 干活 ──► 南桥 CLI 落盘（审计/风险分级/幂等/写后回读）
      │                  │
      │                  └─► 高风险动作 → requires_approval → 回房间等人点头
      ▼
Executor 登记经验（certify.mjs stamp，身份=自己）→ 只能是 candidate
      │
      ▼
Sensor 独立观察产物（observe.mjs，只给路径，不给预期）
      │
      ▼
Examiner 发证（certify.mjs certify，身份=自己）
      │   G1 我的身份 homeserver 认吗？   否 → refused，学历一字不改
      │   G2 这条经验的作者是谁？          不知道 → refused
      │   G3 作者是我吗？                  是 → refused（self_certification）
      │   G4 recheck 形式合法且与观察一致吗？ 否 → refused
      │
      ├─ pass  → verified，exam.examiner 落盘
      ├─ fail  → candidate，即使考官完全合法
      └─ error → 不升不降
      │
      ▼
Auditor 对账（学历声称 ↔ 影核审计 ↔ 磁盘实数）→ 分歧退出码 2
      │
      ▼
Auditor 锚定（证据集合指纹 → OpenTimestamps → 比特币区块头）
```

**下一轮换个模型、换个 harness、换台机器接着干**——这是本架构的核心主张，
已在单进程上验证过（跨会话 / 跨 harness / 跨模型），本桥要验证的是它在多 Agent 上还成不成立。

---

## 6. 签发强度有四级，而**代码分不出第 2 到第 4 级**

这一节是 2026-08-12 实测逼出来的。最初 `identityRecord` 只落一个布尔 `attested`，
直到发现：**把 `MATRIX_HOMESERVER_URL` 指向一个自己起的服务器，一样得到 `attested: true`。**
学历里那条「已由平台签发」的记录，事后没人能判断它有多硬——记录里根本没写是谁签的。

| 级 | 签发者 | 谁能伪造 | 本仓库的状态 |
|---|---|---|---|
| ① | 同进程 mock | 被测进程自己 | 无意义，不接受 |
| ② | 独立进程，被测进程拿不到签发权 | 起这个进程的人 | **判据里的 stub 在这一级** |
| ③ | 部署方运营、Worker 控制不了 | 部署方 | AgentTeams 自带的 Tuwunel（目标） |
| ④ | 第三方运营 | 没人（除非你就是那个身份） | ⛔ 实测不可达 |

第 ④ 级为什么拿不到：2026-08-12 用 Matrix Client-Server API 逐个探了 13 个公共 homeserver
（matrix.org / tchncs.de / midov.pl / converser.eu / nitro.chat / kernal.eu / matrix.im /
grin.hu / dendrite.matrix.org / envs.net …），**0 个允许 `m.login.dummy` 注册**——
要么关闭注册，要么要 reCAPTCHA + 邮箱验证。原始探测结果见
`demo/agentteams-bridge/matrix-registration-probe.md`。**没有绕过任何人机验证。**

**处理方式：不输出等级。** 从进程里看，homeserver 就是 homeserver，代码分不出 ②③④。
输出一个等级字段就是自封（判据 `C17` 锁住这一点：`identity.mjs` 里不许出现
`attestation_tier` / `trust_level` 这类被输出的字段）。改为如实记下 `homeserver` 主机名
（判据 `C15`），把「这个签发者可信到什么程度」留给读账的人判断——
同北桥「投影必须披露自己丢了什么」：给不出的结论就别给，但原始材料必须在场。

> 顺带一个反直觉的结论：**AgentTeams 自带的 Tuwunel 并不是「第三方」**，它跑在我们自己的
> 容器里。它的强度来自**进程隔离**（Worker 只拿消费者令牌，签发权在 Higress/homeserver 手里），
> 不来自「别人运营」。把它说成第三方签发是抬高了自己的证据等级。

## 7. 目前的证明强度，以及它的上限

- ✅ 闸门逻辑成立：`node agentteams/verify-agentteams.mjs` 为 50/50，其中 44 条是反向用例（以实跑输出为准）。
- ✅ 真身份闭环成立：本机 AgentTeams v1.2.2 自带 Tuwunel 签发三个不同身份，
  `node demo/agentteams-bridge/e2e-real-attestation.mjs` 为 12/12；作者自证、无观察发证、
  作者自观察和观察重放都被拒绝。
- ✅ 重启可复现：`node agentteams/provision-identities.mjs` 可在令牌目录被系统清理后重新签发三身份，
  令牌只落本机临时目录，stdout 只输出不可逆指纹。
- ⚠️ 判据里的 homeserver 仍是本仓库 stub，所以那套 50/50 只证明闸门逻辑；
  12/12 才是真 Tuwunel 身份链。
- ⚠️ Tuwunel 由我们自己部署，强度来自进程与签发权隔离，不来自“第三方运营”。
  因此可以主张“平台签发且 Worker 不能伪造三身份”，不主张“第三方身份锚定”。
