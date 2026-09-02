# 本象协议 Benxiang · Origin IR

[![官网 2origin.org](https://img.shields.io/badge/官网-2origin.org-blue)](https://2origin.org)
[![CI](https://github.com/dongsheng123132/2origin/actions/workflows/ci.yml/badge.svg)](https://github.com/dongsheng123132/2origin/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![conformance](https://img.shields.io/badge/conformance-87%2F87%20%C2%B7%20JS%20%2B%20Python-brightgreen.svg)](spec/conformance/README.md)
[![deps](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)
[![English](https://img.shields.io/badge/docs-English-lightgrey.svg)](README.en.md)

**给 AI 用的持久对象表示层。** AI 不再直接写出终态，只提交**语义事务**；确定性编译器校验通过才落地，校验不过一个字节都不写。落地之后，包里**每一个字段都能回答「凭什么是这个值」**。

> mem0 和 Letta 帮 Agent 记住「**是什么**」；
> 本象让持久状态还能回答「**为什么信**」，并在每次写入落地前**确定性校验**。

**凭什么信**：CI 绿（test + conformance + mutation）· **87 条语言无关一致性向量**钉死语义（JS 参考实现全绿；Python 第二实现 60/79、19 项未实现，如实计入下文） · **19 条协议变异全部被抓出**（2026-08-26 实测；其中 2 条属协议覆盖缺口，[公开列在这里](spec/conformance/README.md)）· 四个已跑通的方言（CAD / 法律 / xlsx / 项目记忆）· **零 npm 依赖**。全部数字以 `npm run verify` 实跑为准；诚实边界与两次自我撤回见下方[诚实状态](#诚实状态我们两次推翻了自己)。

<p align="center"><img src="docs/demo-90s.gif" alt="90 秒终端实录：status → commit（含诚实警告）→ why 证据链 → 并发冲突拒绝" width="720"></p>

> 🎬 **90 秒演示**：建包 → AI 提交事务（校验不过一个字节都不写，连自己管不了的约束都当面告诉你）→ `why` 追出证据链 → 并发插队当场拒绝。全部为真实终端输出。

## 60 秒试起来

```bash
# 方式一：直接装 CLI（零依赖，已发布到 npm）
npm i -g benxiang-origin              # 之后所有 `node compiler/cli.mjs` 都可换成 `benxiang`

# 方式二：从源码跑（带示例包与全套判据）
git clone https://github.com/dongsheng123132/2origin && cd 2origin   # 零依赖，不需要 npm install
npm run verify                        # 全套判据一次跑完（含一致性 87/87、变异 19/19）

P=spec/examples/sales-2026.origin
node compiler/cli.mjs status $P       # 这个包里有什么
node compiler/cli.mjs why    $P revenue-trend.chart   # 这个值凭什么是这个值
node compiler/cli.mjs limits $P       # 这个包保证不了什么（接手陌生包先问它）

# 接进 Claude Code：项目状态从此存在包里，不靠聊天记录
node adapters/memory/init.mjs ./my-project.origin my-project "我的项目"
claude mcp add -s local benxiang -- node "$PWD/adapters/memory/mcp-server.mjs" "$PWD/my-project.origin"
```

## 和 mem0 / Letta / 向量 RAG 有什么不同

mem0 / Letta 聚焦 Agent memory（记住「是什么」）；本象聚焦跨领域对象状态的**事务校验与协议级 provenance**——每个值可追到依据、每次写入先过确定性校验。两者互补而非替代。两个结构性缺陷，本象直接打：

| 缺陷 | 表现 | 本象的回答 |
|---|---|---|
| 记忆：上下文必炸 | 聊天记录被当成项目状态，越聊越接近内存爆满 | Chat 只是操作本象的临时窗口；世界状态持久存在于本象中，随时可恢复 |
| 输出：终态不稳 | AI 直接输出完整成品（几十页 PPT、百万字全文），内容、格式、引用一起失控 | AI 只输出紧凑的**语义事务**（改什么、依赖什么、断言什么），确定性编译器生成终态 |

实验给出的分界线：**能从近文恢复的状态，检索和裸模型都够用；需要跨全书累积、且从不在任何一段文字里被陈述的状态，只有状态机答得出来。**

## 一分钟原理

本象不是「一个更大的 JSON」，它同时保存七种东西：

```text
对象 objects      关系 relations     数据 payloads
状态 states       约束 constraints   来源 provenance
边界 limits —— 这份表示保证不了什么：哪里退化了、哪些没覆盖、哪类查不到、哪些没验过
```

第七个要素是**被发现的，不是被设计的**：四个方言落地过程中，同一个动作被独立要求了九次——那就不是九个决定，是一条原则（详见 [08-第七要素-边界](docs/08-第七要素-边界.md)）。**AI 不读 README，它读包**：边界不进包，下游就会把一个已知有损的东西当本体继续用——那正是本项目开篇要解决的「投影的投影」。

```text
Word / CAD / Excel / 视频 / 网页 / 对话历史
        ↓ 导入
   本象 IR（Origin IR）：对象 + 语义 + 关系 + 状态 + 约束 + 来源 + 边界
        ↓ Context Compiler（输入侧编译）
   视觉地图 + 对象图 + 精确片段 + 可用动作 → AI
        ↓ AI 输出语义事务
   Commit Compiler（输出侧编译）：校验约束 → 更新状态 → 留存证据 → 重新投影
        ↓
   PDF / 图片 / 文字 / 三维 / 界面 …（多影输出）
```

> 🕳影域负责隔离，**本象负责保存**，🕳叠象负责看见与比较，↗影核负责行动，🕳确认台负责人类确认。（🕳 ＝ `candidate`：零实现、零判据；↗ ＝ 实现在 ShadowOS。逐项状态见 [概念体系](docs/02-概念体系.md)。）

唯一的写入口是 `commit`：校验不过则一个字节都不写，违规理由原样返回供重写；通过则只往 `provenance/history.jsonl` 追加，绝不覆写 `graph/objects.jsonl`——当前状态由二者重放得出，所以任何一个字段都能回答「凭什么」。加 `--json` 即可当本地 API 给 AI 调用。

## 四个方言 · 各一条命令

```bash
# 图纸一致性：自动抓出图元留在 0 层 / 编号 C2 重复 / 画了 4 樘窗只标 3 个编号
node adapters/cad/import.mjs adapters/cad/fixtures/A-101.dxf /tmp/A-101.origin
node compiler/cli.mjs diagnose /tmp/A-101.origin

# 判决依据链：抓出部门规章被列为裁判依据 / 引已失效司法解释 / 引查无此文的文件 / 自首减 55% 超法定 40% 上限 / 说理段金额与认定事实对不上
node adapters/law/import.mjs adapters/law/fixtures/B-缺陷.txt /tmp/B.origin
node compiler/cli.mjs diagnose /tmp/B.origin

# 表格依赖链：抓出公式列混入硬编码 / 同列公式形状不一致 / 求和漏行 / 错误值残留 / 引用不存在的表 / 文本型数字
node adapters/xlsx/import.mjs adapters/xlsx/fixtures/B-缺陷.xlsx /tmp/B.origin
node adapters/xlsx/trace.mjs /tmp/B.origin 预算!D7   # 这个数凭什么是这个数：顺依赖链追到人工录入源头（Excel 答不了）

# 项目状态（MCP Server，零依赖）：接法见上方 60 秒试起来的最后两行
```

诚实边界，一条不删：**法律与 CAD/xlsx 的缺陷夹具全是我们自己造的——自己出的卷子考满分不算能力证据**，这些数字只保证「改代码不会让它变差」。已知量化：法律方言种入 12 个缺陷抓到 10 个，2 个已知抓不到并写进缺陷目录，合规卷假阳性为 0；xlsx 在真实文件上跑过 16 份、86,590 格假阳性为 0，但**其中公式列为 0——三条公式类规则在真实数据上一次都没生效过**。完整命令与细节见各 [adapters/](adapters/) 目录下 README。

四个方言合计只给核心加了 **4 行**（`why` 输出补一列 `basis`）；其中 xlsx 方言一行核心都没改（落地时 `git diff --stat compiler/ spec/` 为空）——领域知识进的是**数据**（约束表、条文库），不是代码。这是「通用外壳 + 领域方言」在实现上的验收标准。

## 凭什么叫「协议」，而不是「一个库」

一份实现自己跑通自己的测试，证明不了协议存在。分界线在[一致性测试集](spec/conformance/README.md)：**87 条测试向量是数据不是代码**，不依赖任何宿主语言——任何实现只要写一个几十行的适配器（stdin 收 case、stdout 出结果），就能当场自证合规：

```bash
npm run test:conformance    # JavaScript 参考实现：87/87
node spec/conformance/run.mjs --level core \
  --adapter "python spec/conformance/implementations/python/adapter.py"
```

实跑现状（2026-08-26）：JavaScript 参考实现 core 79/79、full 8/8 全绿；[Python 第二实现](spec/conformance/implementations/python/benxiang.py)约 250 行、零依赖，core 通过 **60/79，另 19 项适配器声明未实现——未实现不等于通过，不得据此声称合规**（工具自己会这么报），补齐前 Python 侧不算合规实现。诚实边界：两份实现出自同一作者，向量证明的是「语言中立的契约」，**不**证明「任何人只读规范就能写对」。

`compiler/mutation-check.mjs` 是验证里最关键的一环：故意打坏每一条协议承诺，同时跑自测与一致性向量，看**谁**抓得到。当前 **19 条变异全部被抓出（2026-08-26 测定），其中 2 条只有自测抓到——那是协议的覆盖缺口**，公开列在 [conformance/README §五](spec/conformance/README.md)，未掩盖。**协议只保证向量钉住的部分。**

⚠️ 还欠的账也说清楚：「变异 2 条覆盖缺口」只是 mutation 这一把尺子量的——加上核心投影层 `compiler/project.mjs` **尚无任何一致性向量覆盖**，协议当前已知覆盖缺口共 **3 条**，全列在 [conformance/README §五](spec/conformance/README.md)。补上之前，「本象协议保证投影会披露自己丢了什么」这句话**不成立**——另写一份实现可以合法地发出一份不声明任何丢弃项的投影。

## 诚实状态：我们两次推翻了自己

这个项目的差异化资产之一是撤回记录：两次用自家实验推翻自己的归因，全程公开、墓碑不删。

**最终口径（A2 消融，2026-08-13，[论文 v0.4 §5.3](benchmark/shadowbench-w/paper/shadowbench-w-paper-en-v0.4.md)）**：

| 对比 | 效应 | 显著性（穷举置换） |
|---|---|---|
| A0 → **A2（只是一句提示词：要求模型显式维护状态）** | **+41.3 pt** | p = 3.3×10⁻⁵，显著 |
| A2 → **A3（全套机制：校验器 + 证据链 + 编译器）** | **+2.5 pt** | p = 0.47 / 0.72，**不显著** |

**唯一幸存的分类性主张**：提示词**结构上产不出证据链**。A3 对 **15.0% / 27.5%** 的受测字段给出可溯源证据，所有提示词基线均为 **0%**。⇒ **必须回答「你为什么信」的系统才需要这套机器；只回答「你信什么」的不需要。**

**不主张**：更省 Token（差异不显著）、写得更一致（判分器词表补完后 W1 优势消失）。三臂对照其后已在修补后的判分器与探询下全量重跑（两模型 × 三臂 × 各 10 轮，见[论文 §7 可复现性](benchmark/shadowbench-w/paper/shadowbench-w-paper-en-v0.4.md)），当前对照数字一律以论文 §5 为准，本 README 不转述。样本量：A2 消融为**两模型、各 n=10**；更早的三臂对照（Run #27）为 qwen 单模型、各 n=6。

两次撤回的完整过程未删除、可复核：第一次仪器事故（探询调用不带历史、模板泄题）见 results-log [Run #18](benchmark/shadowbench-w/results-log.md)；第二次归因推翻（94% 优势来自「要求」本身）见 [Run #27](benchmark/shadowbench-w/results-log.md)。全部原始数据与八次自曝的仪器事故都在 [results-log.md](benchmark/shadowbench-w/results-log.md)。

## 文档导航

| 文档 | 回答什么 |
|---|---|
| [00-极简核心](docs/00-极简核心.md) | 整系协议的骨架，一页讲完（只读一页就读它） |
| [01-愿景与定位](docs/01-愿景与定位.md) | 为什么做，做到哪个高度（题词与命名考据在此） |
| [02-概念体系](docs/02-概念体系.md) | 术语表：本象/影子/叠象/影核/影域/确认台（全项目术语准绳） |
| [03-协议草案-v0.1](docs/03-协议草案-v0.1.md) | `.origin` 包结构、Origin IR 最小核心、事务格式 |
| [04-架构设计](docs/04-架构设计.md) | 双向编译器、三级记忆、与 RAG 的区别 |
| [05-生态对照](docs/05-生态对照.md) | 借鉴谁、不重复造谁（OfficeCLI/Docling/Flint/GraphRAG…） |
| [06-路线图与MVP候选](docs/06-路线图与MVP候选.md) | 三条 MVP 路径对比与决策标准（ShadowBench） |
| [07-开源与商业](docs/07-开源与商业.md) | 许可选择、开源/商业边界、诚实边界声明 |
| [08-第七要素-边界](docs/08-第七要素-边界.md) | 这份表示保证不了什么：五种边界、为什么必须进包 |

## 仓库结构

```text
本象协议/
├── docs/        # 创始文档集
├── spec/        # JSON Schema + 示例 .origin 包 + 一致性测试集（87 条语言无关向量）
├── compiler/    # 双向编译器 + 证据链 + 落盘 + origin CLI
├── adapters/    # 领域方言：memory(MCP Server) / cad(DXF导入+制图校验) / law(判决依据链) / xlsx(依赖链体检)
├── benchmark/   # ShadowBench-W 基准 + 判分器 + 全部原始结果（含自 README 迁入的实验史）
├── research/    # 外部格局调研快照（2026-08 三线调研与评估）
├── outreach/    # 生态互动草稿（均未发送）
└── reference/   # 原始构思文档存档
```

## 路线与参与

三条候选 MVP（待定，先跑 ShadowBench 小实验用数据说话）：**① 本象记忆 MCP Server**——聊天历史持续提交为项目世界状态，解决上下文爆炸；**② 100 页 PPT 低 Token 审阅**——视觉总览+对象编号+按需加载；**③ OriginWriter**——百万字小说不失忆。

📜 **[本象宣言](MANIFESTO.md)** —— 为什么要做这件事、今天证明了什么、往哪里去
🔬 **[参与 / 复现](CONTRIBUTING.md)** —— 最欢迎的贡献不是加功能，是把我们的结论推翻
🌍 **[English](README.en.md)** · [Manifesto](MANIFESTO.en.md)

---

## English Summary

**Benxiang** (本象, "origin-image"; *Ben* = origin, *Xiang* = the archetypal image, after the I Ching's "the sages established images to exhaust the meaning") is a persistent, AI-native object representation layer. Its technical core is the **Origin IR** spec. (Earlier drafts used the name "Origin Protocol"; renamed to avoid collision with the OGN crypto project.) Instead of feeding AI flattened projections (screenshots, OCR text, lossy summaries), it preserves the *origin* of a digital artifact — objects, relations, payloads, states, constraints and provenance — then compiles task-specific projections for the model on demand ("one origin, many shadows"). The AI writes back not full documents but compact **semantic transactions**, which a deterministic compiler validates, applies and re-projects, with evidence retained at every step. Think of it as an LLVM-style IR for AI work: renderers become projection backends, actions become a portable instruction set, and chat context becomes a disposable cache over a durable world state.

Status: v0.1 — draft spec **plus a runnable reference implementation** (`compiler/`; run `npm run test` for the live count) and two tiers of controlled experimental data with raw results committed.

**Measured result (A2 ablation):** one sentence of prompt (A0 → A2) accounts for +41.3 points of state accuracy, with a significant permutation result. Adding the full machinery (A2 → A3) adds only +2.5 points, not significant (p = 0.47 / 0.72). Token differences are also not significant, so we claim neither savings nor added cost. The only surviving categorical claim is structural: A2 cannot produce evidence chains, while A3 provides traceable evidence for 15.0% / 27.5% of tested fields and every prompt-only baseline remains at 0%. See [paper v0.4 §5.3](benchmark/shadowbench-w/paper/shadowbench-w-paper-en-v0.4.md#53-the-method-ablation--and-separately-judgeharness-validation) and the [results log](benchmark/shadowbench-w/results-log.md). Earlier results remain below as tombstones; they are not erased or cited as mechanistic advantage.

Docs are primarily in Chinese with bilingual terminology.

## License

### 许可证适用表

| 路径 | 许可证 | 备注 |
|---|---|---|
| 除下列例外外的仓库内容 | Apache-2.0 | 代码、规范与文档；见 [LICENSE](LICENSE)。 |
| `novels/` | CC BY-NC-ND 4.0 | 原创叙事正文与 `.origin` 内容物，公开可验证、非商用，不可改写。 |
| `adapters/story/rk/`、`adapters/story/zs/` | CC BY-NC-ND 4.0 | 原创叙事正文与 `.origin` 内容物；同上。 |

宣传措辞纪律：`novels/` 内容应称为「公开可验证、非商用」，不得称为 open source。

**Apache-2.0**（见 [LICENSE](LICENSE)）。示例与测试语料按 docs/07 的约定分别采用 MIT 与 CC0——语料由世界规格构造生成，不含第三方版权文本。详见 [07-开源与商业](docs/07-开源与商业.md)。
