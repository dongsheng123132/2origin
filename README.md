# Benxiang · 本象协议

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![verify](https://img.shields.io/badge/verify-81%20%2B%2044%20%2B%2079%20%2B%2018%20%2B%2013%2F13-brightgreen.svg)](#快速上手)
[![conformance](https://img.shields.io/badge/conformance-68%2F68%20·%20JS%20%2B%20Python-brightgreen.svg)](spec/conformance/README.md)
[![deps](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)
[![English](https://img.shields.io/badge/docs-English-lightgrey.svg)](README.en.md)

> **一源万影：保存本象，按需投影。**
> Save the origin, project on demand.
>
> 「立象以尽意」——《易传·系辞》 · Establish the image to exhaust the meaning.

**英文名 Benxiang**：Ben（本）= origin，Xiang（象）= the archetypal image。「象」取自《易传》「圣人立象以尽意」与《道德经》「大象无形」——文字装不下意义，须回到更本源的表示；大象无形，故能投影万形。发音：bun-SHYAHNG。协议的技术核心称 **Origin IR**（描述性术语）。

**状态：v0.1 · 协议草案 + 参考实现 + 两级实验数据**
（[参考实现](compiler/) · [ShadowBench-W 实验记录](benchmark/shadowbench-w/results-log.md)）

> **实验已收窄主张（2026-08-03）**：本象的价值经检验只在**一个**维度上成立——**状态追踪**。
>
> **状态准确率（W3）**
>
> | 模型 · 基线 | 本象 | 裸模型 | 向量 RAG |
> |---|---|---|---|
> | qwen-plus · S 级（2 万字，各 10 轮） | **92.5%** | 75.0%（sd 0） | 75.0%（sd 0） |
> | qwen-plus · M 级（9.5 万字，各 11 轮） | **98.9%** | 75.0%（sd 0） | 75.0%（sd 0） |
> | deepseek-v4-flash · M 级 | *n=1：100.0%* ⏳ | 53.8% ± 32.6（n=10） | 32.1% ± 37.1（n=7） |
>
> **qwen 上的结论是扎实的**：两条对照臂在三十三轮里全部 75.0%、标准差 0——卡在同一堵墙上
> 一步没动；本象则 92.5% → 98.9%。基线从 2 万字拉到 9.5 万字，优势**不降反升**。
> 向量 RAG 本该在长上下文时更有用，结果纹丝不动：检索能找回文本，找不回「关键物品此刻在
> 谁手上」——那个答案不在任何一段原文里，是推演出来的。
>
> ⚠️ **deepseek 那一行还不能下结论。** 该模型上方差极大，对照臂呈双峰分布（多数轮次 75%，
> 但有若干轮直接 0%），**单轮值完全不代表分布**——首轮冒烟测得 A0 37.5%、A1 75.0%，
> 十轮后实为 53.8% 与 32.1%。本象臂的多轮正在跑，跑完才更新。
> 在此之前，请只把 qwen 两行当作结论。
>
> **不主张什么**：正文一致性与 RAG **无显著差异**（S 级 p=0.9905，M 级 p=0.3361）；
> Token **更贵**——qwen 上贵 25%，带长思维链的 deepseek 上贵 149%。
> 「写得更一致」「更省 Token」两条早先的主张已撤回。

---

> 📜 **[本象宣言](MANIFESTO.md)** —— 为什么要做这件事、今天证明了什么、往哪里去
> 🔬 **[参与 / 复现](CONTRIBUTING.md)** —— 最欢迎的贡献不是加功能，是把我们的结论推翻
> 🌍 **[English](README.en.md)** · [Manifesto](MANIFESTO.en.md)

## 这是什么

本象协议是一套**面向 AI 的持久对象表示层**。

过去的软件把数字世界展示给人看；本象协议要做的，是把数字世界的**本源结构**保存下来，按需投影给 AI 看、供 AI 改、由系统验证——并证明 AI 真的做对了。

一句话对比：

> 过去，人类把世界压缩成文档交给计算机；
> 未来，AI 直接理解世界的本象，再为人类生成所需要的投影。

## 它解决什么问题

当前 AI 工作方式有三个结构性缺陷：

| 缺陷 | 表现 | 本象协议的回答 |
|---|---|---|
| **感知**：AI 没有眼睛 | AI 能生成 Word/Excel/PPT/CAD，却没有稳定的「打开-看见-定位-修改-复验」系统；读到的往往是投影的投影（截图的 OCR、摘要的摘要） | 保留本源对象、投影规则和修改历史，按任务编译 AI 最需要的上下文 |
| **记忆**：上下文必炸 | 聊天记录被当成项目状态，聊得越久越接近内存爆满，压缩摘要不断失真 | Chat 只是操作本象的临时窗口；世界状态持久存在于本象中，随时可恢复 |
| **输出**：终态不稳 | AI 直接输出完整成品（几十页 PPT、百万字全文、几百行图表配置），内容、格式、引用一起失控 | AI 只输出紧凑的**语义事务**（改什么、依赖什么、断言什么），确定性编译器生成终态 |

## 核心理念

**本象不是「一个更大的 JSON」**，它同时保存六种东西：

```text
对象（objects）——稳定 ID 的真实实体
关系（relations）——谁拥有/引用/依赖/生成谁
数据（payloads）——各领域的原生载荷（几何、公式、时间轴……）
状态与时间（states）——过去、现在、变化及其原因
行为与约束（constraints）——能做什么、不能违反什么
来源与证据（provenance）——谁创建、谁修改、哪些是推断
```

PDF、图片、Markdown、EPUB 都**不是源文件**，而是本象生成的**投影（缓存视图）**。

## 体系一图流

```text
Word / CAD / Excel / 视频 / 网页 / 对话历史
                    ↓  导入
              本象 IR（Origin IR）
        对象 + 语义 + 关系 + 状态 + 约束 + 来源
                    ↓  Context Compiler（输入侧编译）
     视觉地图 + 对象图 + 精确片段 + 可用动作 → AI
                    ↓  AI 输出语义事务
              Commit Compiler（输出侧编译）
        校验约束 → 更新状态 → 留存证据 → 重新投影
                    ↓
      PDF / 图片 / 文字 / 三维 / 界面 …（多影输出）
```

配套概念分工（详见 [概念体系](docs/02-概念体系.md)）：

> **影域负责隔离，本象负责保存，叠象负责看见与比较，影核负责行动，舟舱负责人类确认。**

计算机体系类比：

| 本体系 | 类比 |
|---|---|
| 本象 IR / Origin IR | AI 时代的 LLVM IR（通用中间表示） |
| 影核协议 / ActionParity | 统一指令集 |
| Shadow Runtime | 虚拟机 |
| 叠象 / Redline | 调试器 + 测试系统 + Git |
| 舟舱 / PodApp | 面向人的显示器和控制台 |

## 文档导航

| 文档 | 回答什么 |
|---|---|
| [01-愿景与定位](docs/01-愿景与定位.md) | 为什么做，做到哪个高度 |
| [02-概念体系](docs/02-概念体系.md) | 术语表：本象/影子/叠象/影核/影域/舟舱（全项目术语准绳） |
| [03-协议草案-v0.1](docs/03-协议草案-v0.1.md) | `.origin` 包结构、Origin IR 最小核心、事务格式 |
| [04-架构设计](docs/04-架构设计.md) | 双向编译器、三级记忆、与 RAG 的区别 |
| [05-生态对照](docs/05-生态对照.md) | 借鉴谁、不重复造谁（OfficeCLI/Docling/Flint/GraphRAG…） |
| [06-路线图与MVP候选](docs/06-路线图与MVP候选.md) | 三条 MVP 路径对比与决策标准（ShadowBench） |
| [07-开源与商业](docs/07-开源与商业.md) | 许可选择、开源/商业边界、诚实边界声明 |

## 仓库结构

```text
本象协议/
├── docs/        # 创始文档集（本轮产出）
├── spec/        # JSON Schema + 示例 .origin 包 + **一致性测试集**（68 条语言无关向量）
├── compiler/    # 双向编译器 + 证据链 + 落盘 + `origin` CLI（可运行，81 项跨域自测）
├── adapters/    # 领域方言
│   ├── memory/  #   项目状态：MCP Server（零依赖）+ 回填工具
│   ├── cad/     #   图纸一致性：DXF 导入器 + 制图规范校验
│   └── law/     #   判决依据链：裁判文书导入器 + 引用白名单 + 量刑复算
├── benchmark/   # ShadowBench-W 基准 + 判分器 + 全部原始结果（可复核）
├── research/    # 外部格局调研快照（含 2026-08 三线调研与评估）
├── outreach/    # 生态互动草稿（天命/MemTX/ConStory-Bench，均未发送）
└── reference/   # 原始构思文档存档
```

## 快速上手

```bash
npm run verify   # 自测 81 + CAD 44 + 法律 79 + MCP 端到端 18 + 一致性 68 + 变异检查 13/13


P=spec/examples/sales-2026.origin
node compiler/cli.mjs status   $P           # 这个包里有什么
node compiler/cli.mjs why      $P revenue-trend.chart   # 这个值凭什么是这个值（前缀可省）
node compiler/cli.mjs diagnose $P           # 体检：约束、悬空引用、双份账本、模型偏差率

S=$(node compiler/cli.mjs seq $P -q)        # 记下水位
node compiler/cli.mjs commit $P tx.json --expect $S --by me   # 唯一的写入口
```

`commit` 校验不过则**一个字节都不写**，违规理由从 stdout 原样返回供重写；通过则只往
`provenance/history.jsonl` 追加，绝不覆写 `graph/objects.jsonl`——当前状态由二者重放得出，
所以任何一个字段都能回答「凭什么」。加 `--json` 即可当本地 API 给 AI 调用。

三个已跑通的方言：

```bash
# 图纸一致性（详见 adapters/cad/README.md）
node adapters/cad/import.mjs adapters/cad/fixtures/A-101.dxf /tmp/A-101.origin
node compiler/cli.mjs diagnose /tmp/A-101.origin
#   → 自动抓出：图元留在 0 层 / 编号 C2 重复 / 画了 4 樘窗只标 3 个编号

node adapters/cad/import.mjs adapters/cad/fixtures/B-201.dxf /tmp/B-201.origin
node compiler/cli.mjs diagnose /tmp/B-201.origin
#   → 块引用图纸：读出块定义与块属性，抓出门窗重号 C1

# 判决依据链（详见 adapters/law/README.md）
node adapters/law/import.mjs adapters/law/fixtures/B-缺陷.txt /tmp/B.origin
node compiler/cli.mjs diagnose /tmp/B.origin
#   → 自动抓出：部门规章被列为裁判依据 / 引了已失效的司法解释 / 引了查无此文的文件
#     / 自首减 55% 超出法定 40% 上限 / 说理段金额 6800 与认定事实 8600 对不上
#     种入 12 个缺陷抓到 10 个，2 个已知抓不到并写进缺陷目录；合规卷假阳性为 0

node adapters/law/import.mjs adapters/law/fixtures/A-合规.txt /tmp/A.origin --staged
node adapters/law/sentence.mjs /tmp/A.origin --declare 7 --by 承办法官-李
node compiler/cli.mjs why /tmp/A.origin case:2026沪0101刑初123号.调节比例合计
#   → 从基准刑到宣告刑，每一步带 basis（情节 + 证据 + 法条）；超出 20% 幅度当场拒绝

# 项目状态（详见 adapters/memory/README.md）
node compiler/cli.mjs status project.origin        # 本仓库自己的世界状态就在这里
claude mcp add -s local benxiang -- node <绝对路径>/adapters/memory/mcp-server.mjs <包路径>
```

三个方言合计只给核心加了 **4 行**（`why` 输出补一列 `basis`）——领域知识进的是**数据**
（约束表、条文库），不是代码。这是「通用外壳 + 领域方言」在实现上的验收标准。

### 凭什么说这是「协议」而不是「一个库」

一份实现自己跑通自己的测试，证明不了协议存在。分界线在
[一致性测试集](spec/conformance/README.md)：**68 条测试向量是数据不是代码**，
不依赖任何宿主语言。任何实现只要写一个几十行的适配器（stdin 收 case、stdout 出结果），
就能当场自证合规。

```bash
npm run test:conformance                       # JavaScript 参考实现：68/68（core + full）
node spec/conformance/run.mjs --level core \
  --adapter "python spec/conformance/implementations/python/adapter.py"   # Python 第二实现：60/60
```

[Python 第二实现](spec/conformance/implementations/python/benxiang.py) 约 250 行、零依赖，
跑同一套向量全绿——证明这套语义在另一门语言里独立成立。诚实的边界：两份实现出自同一作者，
所以它证明的是「向量确实是语言中立的契约」，**不**证明「任何人只读规范就能写对」。

`compiler/mutation-check.mjs` 是验证里最关键的一环：它故意打坏每一条协议承诺，
同时跑自测与一致性向量，看**谁**抓得到。只被自测抓到的，是**协议的覆盖缺口**——
那条承诺只约束得了这一份实现，换个人照规范另写一份可以合法做丢。
当前 13 条变异全部被抓出，其中 2 条属于覆盖缺口，已列在
[conformance/README §五](spec/conformance/README.md)，未掩盖。**协议只保证向量钉住的部分。**

## 三条候选 MVP（待定）

1. **本象记忆 / Shadow Memory**——MCP Server，把聊天历史持续提交为项目世界状态，新会话秒恢复，解决上下文爆炸
2. **100 页 PPT 低 Token 审阅**——视觉总览 + 对象编号 + 按需加载，公开 Benchmark 对比纯文本/纯截图方案
3. **本象写作引擎 / OriginWriter**——百万字小说不失忆：正文 + 人物状态 + 时间线 + 伏笔图谱，AI 以事务提交写作

决策方式：先跑 ShadowBench 小实验，用数据说话。详见 [06-路线图与MVP候选](docs/06-路线图与MVP候选.md)。

---

## English Summary

**Benxiang** (本象, "origin-image"; *Ben* = origin, *Xiang* = the archetypal image, after the I Ching's "the sages established images to exhaust the meaning") is a persistent, AI-native object representation layer. Its technical core is the **Origin IR** spec. (Earlier drafts used the name "Origin Protocol"; renamed to avoid collision with the OGN crypto project.) Instead of feeding AI flattened projections (screenshots, OCR text, lossy summaries), it preserves the *origin* of a digital artifact — objects, relations, payloads, states, constraints and provenance — then compiles task-specific projections for the model on demand ("one origin, many shadows"). The AI writes back not full documents but compact **semantic transactions**, which a deterministic compiler validates, applies and re-projects, with evidence retained at every step. Think of it as an LLVM-style IR for AI work: renderers become projection backends, actions become a portable instruction set, and chat context becomes a disposable cache over a durable world state.

Status: v0.1 — draft spec **plus a runnable reference implementation** (`compiler/`, 81 self-tests across two unrelated domains) and two tiers of controlled experimental data with raw results committed.

**Measured result:** on long-form narrative state tracking, Benxiang reaches 98.9–100% state accuracy where a naive LLM and vector RAG sit at 75.0% and 37.5% respectively — lifting two models of very different strength to the same height. State correctness comes from the architecture, not the model. Full numbers, limitations and six self-caught instrumentation accidents: [README.en.md](README.en.md) · [MANIFESTO.en.md](MANIFESTO.en.md) · [CONTRIBUTING.md](CONTRIBUTING.md).

Docs are primarily in Chinese with bilingual terminology.

## License

**Apache-2.0**（见 [LICENSE](LICENSE)）。示例与测试语料按 docs/07 的约定分别采用 MIT 与 CC0——语料由世界规格构造生成，不含第三方版权文本。详见 [07-开源与商业](docs/07-开源与商业.md)。
