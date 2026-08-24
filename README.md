# Benxiang · 本象协议

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![verify](https://img.shields.io/badge/verify-81%20%2B%2044%20%2B%20101%20%2B%2087%20%2B%2018%20%2B%2013%2F13-brightgreen.svg)](#快速上手)
[![conformance](https://img.shields.io/badge/conformance-87%2F87%20·%20JS%20%2B%20Python-brightgreen.svg)](spec/conformance/README.md)
[![deps](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)
[![English](https://img.shields.io/badge/docs-English-lightgrey.svg)](README.en.md)

> **一源万影：保存本象，按需投影。**
> Save the origin, project on demand.
>
> 「立象以尽意」——《易传·系辞》 · Establish the image to exhaust the meaning.
>
> **如果只读一页，读 [docs/00-极简核心](docs/00-极简核心.md)** —— 整系协议的骨架，一页讲完。

**英文名 Benxiang**：Ben（本）= origin，Xiang（象）= the archetypal image。「象」取自《易传》「圣人立象以尽意」与《道德经》「大象无形」——文字装不下意义，须回到更本源的表示；大象无形，故能投影万形。发音：bun-SHYAHNG。协议的技术核心称 **Origin IR**（描述性术语）。

**状态：v0.1 · 协议草案 + 参考实现 + 两级实验数据**
（[参考实现](compiler/) · [ShadowBench-W 实验记录](benchmark/shadowbench-w/results-log.md)）

> ## ⚠ 主张已二次收窄（2026-08-13 · A2 消融 · [论文 v0.4](benchmark/shadowbench-w/paper/shadowbench-w-paper-en-v0.4.md) §5.3）
>
> **下方 Run #27 的数字没错，归因错了。** 加一条 **A2 提示词臂**（只要求模型每章输出并更新
> 显式状态，**无校验器、无证据链、无上下文编译器**）后：
>
> | 对比 | 效应 | 显著性（穷举置换 184,756 splits） |
> |---|---|---|
> | A0 → **A2（只是「要求」）** | **+41.3 pt** | p = 3.3×10⁻⁵ / 2.2×10⁻⁵ |
> | A2 → **A3（全套机制）** | **+2.5 pt** | **p = 0.4737 / 0.7214 不显著** |
> | Token | A2 比裸模型**还省** −9.7% / −28.2% | A3 比 A2 贵 +26%~+69% |
>
> 两个无关模型上小数点级复现。**在状态准确率上，Origin IR 状态层打不过一句提示词**——
> 43.8 分优势里 41.3 分（94%）来自「向基线要了一件从没向它们要过的东西」。
>
> **幸存的唯一主张（分类性）**：A2 **结构上产不出证据链**（提示词里没有「信念 vs 依据」的区分）。
> A3 对 **15.0% / 27.5%** 的受测字段给出可溯源证据，**A0/A1/A2 均为 0%**。
> ⇒ **必须回答「你为什么信」的系统才需要这套机器；只回答「你信什么」的不需要。**
>
> 旧数字保留不删（墓碑不是删除），但不得再作为机制优势引用。

> **实验已收窄主张（2026-08-03）**：本象的价值经检验只在**一个**维度上成立——**状态追踪**。
> ⚠ 此结论已于 2026-08-13 被自家消融推翻，见上方。以下仅存档。
>
> **状态准确率（W3）**
>
> **⚠ 归因已撤回**（[Run #27](benchmark/shadowbench-w/results-log.md)，2026-08-05）
>
> | qwen-plus · M 级（9.5 万字）· 各 n=6 | 本象 | 裸模型 | 向量 RAG |
> |---|---|---|---|
> | **W3 状态准确率** | **95.8% ± 5.9** | 52.1% ± 19.7 | 58.3% ± 11.8 |
> | 置换检验 vs 本象 | — | **p = 0.0024** | **p = 0.0024** |
> | 总 Token | 64612 | 57598 | 58196 |
>
> 这是**探询修复后**（对照臂拿到自己写的全部两万字、题面上一个答案都没有、八个字段全问）
> 的第一份有效数据。领先 43.8 / 37.5 个百分点，p = 0.0024。
>
> > **那堵 75% 的墙是假的，但墙后面的东西是真的。**
>
> **必须先说不利的一条**：字段级看，本象在 `obj:black-key.holder` 上是 **4/6，比两条对照臂
> 的 5/6 都差**——而那恰恰是唯一能从近文直接读出来的字段。优势全部集中在另外两格，
> 两条对照臂**同时**近乎全灭而本象六轮全中：
>
> | 字段 | 裸模型 | RAG | 本象 |
> |---|---|---|---|
> | `black-key.holder`（最后一次转交就写在自己正文里） | 5/6 | 5/6 | **4/6** |
> | `bai-yao.secret_betrayal`（跨几十章累积的秘密） | 1/6 | 0/6 | **6/6** |
> | `hook:shen-yan-suspicion.status`（**从不存在于任何一段文字里**） | 0/6 | 0/6 | **6/6** |
>
> > **能从自己刚写的正文里读出来的状态，检索和裸模型都够用，本象不占便宜；
> > 需要跨全书累积、且从不在任何一段文字里被陈述的状态，只有状态机答得出来。**
>
> 这是旧口径下那句「检索捞回的是段落不是状态」的**正确版本**——原话已被自己的实验推翻
> （钥匙持有者检索得回来），新版指出了真正的分界线：**状态能否从近文恢复，决定检索有没有用。**
>
> 🛑 **下面三行是旧探询口径，对照两列已作废，仅存档。**
>
> | 旧口径 · 存档 | 本象 | 🛑 裸模型（作废） | 🛑 向量 RAG（作废） |
> |---|---|---|---|
> | qwen-plus · S 级（各 10 轮） | 92.5% | ~~75.0%（sd 0）~~ | ~~75.0%（sd 0）~~ |
> | qwen-plus · M 级（各 11 轮） | 98.9% | ~~75.0%（sd 0）~~ | ~~75.0%（sd 0）~~ |
> | deepseek-v4-flash · M 级（各 11 轮） | 98.9% ± 3.59 | 🛑 作废 | 🛑 作废 |
>
> 作废原因（[Run #18](benchmark/shadowbench-w/results-log.md)）：对照臂的状态靠一次
> **额外的探询调用**采集，而该调用**不传对话历史**——提示词第一句「根据你刚写的内容」
> 送到了一个从未见过那些正文的模型面前；那段 JSON 模板还**把 8 个答案里的 5 个字面印在题面上**，
> 另 1 个填空数组即过、另 1 个模板里根本没问。**6÷8 = 75.0%**，那个「标准差为 0 的墙」
> 是模板自己的答案。**恰恰是那个漂亮的零方差，本该是最大的警报。**
>
> 本象那三行不受影响（A3 不走探询，状态由自己的状态机维护），但**不与新口径并列**。
> deepseek 侧的对照臂尚未用新探询重跑，故该行仍无对照。
>
> **deepseek 上本象臂已跑满**（[Run #19](benchmark/shadowbench-w/results-log.md)）：
> 连同冒烟轮 **n=11，98.9% ± 3.59**，全部 5/5 完成，十轮满分、一轮 87.5%。
> 而它错的那个字段是 `obj:black-key.holder`——**恰好是 Run #18 认定的、
> 八个字段里唯一真正在考东西的那一个**（其余五个答案被模板印在题面上、
> 一个填空数组即过、一个对照臂结构上永远拿不到）。
>
> **这个「不满分」是好消息。** 若跑出十轮零方差，按前一天刚立的规矩，
> 它首先该被当作嫌疑而不是战果。真实模型给出一个偶尔会错的分布，
> 恰恰说明这次量到的是能力，不是模板。
>
> 同一件事在 qwen 上也发生了一次：两个模型各自唯一的那轮非满分，**错的是同一个字段**，
> 而且错法不同——deepseek 把钥匙留在林峥手里（没执行转交），qwen 填了 `loc:moon-platform`
> （把地点填进了人物字段）。
>
> **臂内跨模型对比成立**（[Run #19](benchmark/shadowbench-w/results-log.md)）。
> A3 自己在两个模型上的对照不经过探询调用，**不受 Run #18 影响**，同口径重打分后 11 对 11：
>
> | | qwen-plus (n=11) | deepseek-v4-flash (n=11) | 置换检验 |
> |---|---|---|---|
> | **W3 状态准确率** | **98.9%** | **98.9%** | 均值差 0.0000，**p = 1.0000** |
> | **W1 EPC**（正文，越低越好） | **0.20** | **0.55** | 均值差 −0.35，**p = 0.0392** |
>
> 两个模型的 W3 分布**逐轮相同**（各 10 轮满分 + 1 轮 87.5%），而正文质量差了近三倍。
>
> > **状态层的正确性与底模无关，正文层的质量与底模显著相关。**
>
> ⚠️ 但**仍不能说「本象把水平悬殊的两个模型拉到了同一高度」**——「拉到同一高度」是相对
> 对照臂讲的，而对照臂的 W3 已作废；「两个模型水平悬殊」这个前提原本的依据（A0 的
> 37.5%/75%）同样作废。现在立得住的只有臂内那半句：**本象自己在两个模型上给出同一个状态分。**
>
> **不主张什么**
>
> - **不主张「写得更一致」。** 正文一致性与 RAG 无显著差异，新口径下 W1 也暂不作解读。
>   判分器的词表原先只认得约三分之一的违规写法（[Run #23](benchmark/shadowbench-w/results-log.md)：
>   13/40）；补丁已应用并固化 65 条回归用例（[Run #29](benchmark/shadowbench-w/results-log.md)：
>   40/40、26 个误报陷阱全静默）。**补完之后本象的 W1 原始优势随即消失**
>   （EPC 1.30 vs 裸模型 1.33、RAG 0.97）——按接触度归一化后三臂是 1.71 / 1.46 / 1.58，
>   谁也说不上更好（[Run #28](benchmark/shadowbench-w/results-log.md)）。
>   另外 `ced.mjs` **同时是本象臂的门禁规则源**（[Run #26](benchmark/shadowbench-w/results-log.md)）——
>   同一份规则，本象拿它当盾、所有臂被它当尺，确定性通道上的对比因此带循环论证成分。
> - **不主张「更省 Token」，也不再承认「更贵」。** 同口径实测 64612 vs 57598 = **+12.2%，
>   p = 0.5253，不显著**。此前首页写的「贵 25% / 贵 75% / 贵 149%」全部是旧探询口径或单轮值，
>   一并作废——那时对照臂的探询几乎不花钱，因为它什么上下文都没送。
> - **跨模型仍不成立。** deepseek 侧的对照臂尚未用新探询重跑。
> - **n=6，单模型。** 本轮结论只建立在 W3 上（W3 比的是结构化状态字段，不判文本，
>   因此不受词表问题影响）。

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
边界（limits）——**这份表示保证不了什么**：哪里退化了、哪些没覆盖、哪类查不到、哪些没验过
```

> 第七个是**被发现的，不是被设计的**。四个方言与投影层落地过程中，同一个动作被独立要求了九次
> （CAD 的 `id_basis` 退化、法律的 `closed_world`、xlsx 的缺陷目录、投影的 `dropped`、
> 一致性的覆盖缺口、约束的 `unenforceable`、实验的主张撤回……）——那就不是九个决定，是一条原则。
> 详见 [08-第七要素-边界](docs/08-第七要素-边界.md)。
>
> **为什么必须进包**：消费方是 AI，而 **AI 不读 README，它读包**。边界不进包，边界就不存在，
> 下游会把一个已知有损的东西当本体继续用——那正是本项目开篇要解决的「投影的投影」。

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

> 🕳影域负责隔离，**本象负责保存**，🕳叠象负责看见与比较，↗影核负责行动，🕳确认台负责人类确认。
>
> （🕳 ＝ `candidate`：零实现、零判据，说的是打算不是现状；↗ ＝ 实现在 ShadowOS。
> 逐项状态见 [概念体系](docs/02-概念体系.md)。）

计算机体系类比：

| 本体系 | 类比 |
|---|---|
| 本象 IR / Origin IR | AI 时代的 LLVM IR（通用中间表示） |
| 影核协议 / Action Kernel | 统一指令集 ↗ 实现在 ShadowOS |
| Shadow Runtime | 虚拟机 🕳 candidate |
| 叠象 / Redline | 调试器 + 测试系统 + Git 🕳 candidate |
| 确认台 / Review Console（原 确认台/Review Console） | 面向人的显示器和控制台 🕳 candidate |

## 文档导航

| 文档 | 回答什么 |
|---|---|
| [01-愿景与定位](docs/01-愿景与定位.md) | 为什么做，做到哪个高度 |
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
├── docs/        # 创始文档集（本轮产出）
├── spec/        # JSON Schema + 示例 .origin 包 + **一致性测试集**（87 条语言无关向量）
├── compiler/    # 双向编译器 + 证据链 + 落盘 + `origin` CLI（可运行，81 项跨域自测）
├── adapters/    # 领域方言
│   ├── memory/  #   项目状态：MCP Server（零依赖）+ 回填工具
│   ├── cad/     #   图纸一致性：DXF 导入器 + 制图规范校验
│   ├── law/     #   判决依据链：裁判文书导入器 + 引用白名单 + 量刑复算
│   └── xlsx/    #   表格依赖链：xlsx 导入器 + 公式依赖图 + 五类事故体检
├── benchmark/   # ShadowBench-W 基准 + 判分器 + 全部原始结果（可复核）
├── research/    # 外部格局调研快照（含 2026-08 三线调研与评估）
├── outreach/    # 生态互动草稿（天命/MemTX/ConStory-Bench，均未发送）
└── reference/   # 原始构思文档存档
```

## 快速上手

```bash
npm run verify   # 自测 81 + CAD 44 + 法律 101 + xlsx 87 + MCP 端到端 18 + 一致性 87 + 变异检查 13/13


P=spec/examples/sales-2026.origin
node compiler/cli.mjs status   $P           # 这个包里有什么
node compiler/cli.mjs why      $P revenue-trend.chart   # 这个值凭什么是这个值（前缀可省）
node compiler/cli.mjs diagnose $P           # 体检：约束、悬空引用、双份账本、模型偏差率
node compiler/cli.mjs limits   $P           # 这个包保证不了什么（接手陌生包先问它）

S=$(node compiler/cli.mjs seq $P -q)        # 记下水位
node compiler/cli.mjs commit $P tx.json --expect $S --by me   # 唯一的写入口
```

`commit` 校验不过则**一个字节都不写**，违规理由从 stdout 原样返回供重写；通过则只往
`provenance/history.jsonl` 追加，绝不覆写 `graph/objects.jsonl`——当前状态由二者重放得出，
所以任何一个字段都能回答「凭什么」。加 `--json` 即可当本地 API 给 AI 调用。

四个已跑通的方言：

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
#   ⚠️ 三份 fixture 全是自己造的——**自己出的卷子考满分不算能力证据**。
#     这些数字只保证「改代码不会让它变差」，真文书上的假阳性率尚未验证。

node adapters/law/import.mjs adapters/law/fixtures/A-合规.txt /tmp/A.origin --staged
node adapters/law/sentence.mjs /tmp/A.origin --declare 7 --by 承办法官-李
node compiler/cli.mjs why /tmp/A.origin case:2026沪0101刑初123号.调节比例合计
#   → 从基准刑到宣告刑，每一步带 basis（情节 + 证据 + 法条）；超出 20% 幅度当场拒绝

# 表格依赖链（详见 adapters/xlsx/README.md）
node adapters/xlsx/import.mjs adapters/xlsx/fixtures/B-缺陷.xlsx /tmp/B.origin
node compiler/cli.mjs diagnose /tmp/B.origin
#   → 自动抓出：公式列混入硬编码常量 / 同列公式形状不一致 / 求和漏行
#     / 错误值残留 / 引用不存在的表 / 文本型数字

node adapters/xlsx/import.mjs adapters/xlsx/fixtures/A-合规.xlsx /tmp/A.origin
node adapters/xlsx/trace.mjs /tmp/A.origin 预算!D7
#   → 这个数凭什么是这个数：顺依赖链追到 10 个人工录入的源头（Excel 答不了这个）
#
# 一源万影：从本象投影回 xlsx（往返 40/40 逐格一致）
node adapters/xlsx/project.mjs /tmp/A.origin /tmp/A-v2.xlsx
#   → 有损投影会当面报出丢了什么：诊断字段、证据链、以及缓存值已过期的公式格
#   ⚠️ 夹具同样是自己造的。真文件上跑过 16 份、86,590 格假阳性为 0，
#     但其中公式列为 0——三条公式类规则在真实数据上一次都没生效过。

# 项目状态（详见 adapters/memory/README.md）
node compiler/cli.mjs status project.origin        # 本仓库自己的世界状态就在这里
claude mcp add -s local benxiang -- node <绝对路径>/adapters/memory/mcp-server.mjs <包路径>
```

四个方言合计只给核心加了 **4 行**（`why` 输出补一列 `basis`）——领域知识进的是**数据**
（约束表、条文库），不是代码。这是「通用外壳 + 领域方言」在实现上的验收标准。

其中 **xlsx 方言一行核心都没改**（落地时 `git diff --stat compiler/ spec/` 为空）。
它是四个域里唯一带「算出来的值」和依赖图的——公式依赖直接落在协议本来就有的
`relations` 上，没能逼出任何新谓词。目前这是该主张最强的一次验证。

> 说清楚一件事：核心后来确实多了一个文件 `compiler/project.mjs`（投影层）。
> 它**不是为 xlsx 方言加的**——它补的是协议自己声明了却一直没实现的那一半
> （manifest 里的 `projections:` 块与「一源万影」）。区别在于：
> 方言要什么核心就长什么，是坏味道；协议欠什么就补什么，是还账。
>
> ⚠️ 而这笔账还了一半：`compiler/project.mjs` 目前**没有任何一致性向量覆盖**，
> 已列入 [覆盖缺口第 3 条](spec/conformance/README.md)。在补上之前，
> 「本象协议保证投影会披露自己丢了什么」这句话**不成立**——
> 另写一份实现可以合法地发出一份不声明任何丢弃项的投影。

### 凭什么说这是「协议」而不是「一个库」

一份实现自己跑通自己的测试，证明不了协议存在。分界线在
[一致性测试集](spec/conformance/README.md)：**87 条测试向量是数据不是代码**，
不依赖任何宿主语言。任何实现只要写一个几十行的适配器（stdin 收 case、stdout 出结果），
就能当场自证合规。

```bash
npm run test:conformance                       # JavaScript 参考实现：87/87（core 79 + full 8）
node spec/conformance/run.mjs --level core \
  --adapter "python spec/conformance/implementations/python/adapter.py"   # Python 第二实现：79/79
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

**Measured result:** on long-form narrative state tracking, Benxiang reaches 98.9–100% state accuracy across 33 runs on two models. **The control-arm numbers were withdrawn on 2026-08-04**: a self-audit found the probe that collected their state carried no conversation history *and* printed most of the answers in the prompt, so the comparison has to be re-run before any claim of a margin stands. Full numbers, limitations and eight self-caught instrumentation accidents: [README.en.md](README.en.md) · [MANIFESTO.en.md](MANIFESTO.en.md) · [CONTRIBUTING.md](CONTRIBUTING.md).

Docs are primarily in Chinese with bilingual terminology.

## License

**Apache-2.0**（见 [LICENSE](LICENSE)）。示例与测试语料按 docs/07 的约定分别采用 MIT 与 CC0——语料由世界规格构造生成，不含第三方版权文本。详见 [07-开源与商业](docs/07-开源与商业.md)。
