# ShadowBench-W: 长文续写中的状态一致性基准（论文初稿 v0.1）

> 状态：初稿，未投稿。目标会场：NeurIPS 2026 Datasets & Benchmarks（惯例 5 月 deadline，
> 需查当年 CFP）。作者：贺去病（匿名版用「The Benxiang Protocol Team」）。
> 数据基础：benchmark/shadowbench-w/results-log.md 全部实测（qwen-plus / deepseek-v4-flash 双模型 × 11 轮）。
> ⚠️ 初稿不引用未完成的重跑数据（results-log 中标 [ ] 的 TODO 项），正文只写已站住的数字。

---

## Title（候选）

1. ShadowBench-W: A Benchmark for State Consistency in Long-Form AI Story Continuation
2. Writing 100 Chapters Without Losing the Sword: State Consistency as a Benchmarkable Task
3. ShadowBench-W: Verifiable World State in Long-Form Text Generation

## Abstract（草稿，英文）

Large language models fail silently at long-horizon generation: a sword picked up in
chapter 8 is forgotten by chapter 20, a character's death goes unreported, and the
model itself cannot tell you what it believes the world looks like. Existing
benchmarks for long-form generation measure surface quality (fluency, coherence,
CED) but never ask the question that matters for downstream agents: **is the world
state the model claims consistent with what it wrote, and can every claim be traced
to evidence?**

We introduce ShadowBench-W, a benchmark for state consistency in long-form story
continuation. Built on a 20K-character corpus (chapters 1-10) with a 15-chapter
continuation task (chapters 11-15), it defines two scores: W1 measures consistency
errors per contact in the generated text (EPC), and W3 measures field-level
agreement between the system's claimed world state and ground truth, plus
evidence-traceability of every state field. We also present the Origin IR state
layer, a reference method that compiles context under a token budget and validates
every state mutation as a transaction with evidence chain.

Across two LLMs (qwen-plus, deepseek-v4-flash) and 11 rounds each, the state layer
improves W3 state accuracy from 75.0% (baseline, zero variance) to 98.9%
(p=1.0000), and reduces W1 EPC from 1.00 to 0.20 on qwen-plus (p=0.0392), with
100% evidence traceability. The benchmark and reference implementation are
open-sourced under Apache-2.0.

## 1. Introduction（草稿）

**动机故事。** 让一个 LLM 续写一部小说 50 章，然后问它：主角的剑现在在谁手里？
基线模型答不上来——不是因为它没读过前文，而是因为它**从未被要求维护**一个
可查询的世界状态。续写时它把「剑在赵七手里」写进了某一段正文，但下一个
生成步骤完全可能写出「林峥抽出剑」——正文自相矛盾，而模型毫无察觉，因为
没有任何机制把「它写过什么」和「它相信什么」对齐。

我们把这种缺陷称为**状态错乱**（state corruption）：生成内容在局部读起来通顺，
在长程上却自相矛盾，且系统无法检测、无法定位、无法解释自己的错误。

**三个结构性缺陷。** 长文生成的失败可以归为三类（详见 MANIFESTO.md）：

1. **感知缺陷**：模型从未系统读取前文——上下文窗口装不下 50 章，尾部截断丢关键信息。
2. **记忆缺陷**：模型没有持久状态——「上下文必炸」的本质是记忆缺陷，不是长度问题。
3. **输出缺陷**：模型无法验证自己写的东西——写了就写了的，没有提交门禁、没有回滚。

**现有基准的盲区。** 长文本评测（LongBench 等）测「能否利用长上下文回答问题」；
小说续写评测（ConStory-Bench、天命）测正文质量（连贯性、伏笔回收率）。但
「系统声称的世界状态与正文是否一致、每个字段能否追溯到证据」——没有任何
公开基准覆盖。这不是边角问题：任何要长期自主工作的 agent（写作、代码、运营）
都需要回答「你现在相信什么、凭什么相信」。

**我们的贡献。** 本文贡献四点：

1. **新任务定义**：长文续写中的状态一致性（State Consistency in Long-Form Continuation），
   要求系统维护可查询、可验证的世界状态，而非只产出正文。
2. **新基准 ShadowBench-W**：20K 字符基线语料 + 15 章续写任务 + 双判分器。
   W1 测正文一致性错误（EPC，每百次接触错误数），W3 测状态回写正确性
   （字段级准确率 + 证据可追溯率）。
3. **参考方法 Origin IR 状态层**：context-compiler（输入侧预算编译）+ commit-compiler
   （输出侧解析/校验/留证），状态以事务方式提交，可回滚、带证据链。
4. **实证**：双模型 × 11 轮，状态层把 W3 从 75.0% 提到 98.9%（p=1.0000），
   W1 EPC 从 1.00 降到 0.20（p=0.0392），证据可追溯率 100%。

## 2. Related Work（草稿框架，引用待实查补全）

- **长上下文评测**：LongBench、LongBench v2、∞Bench——测「能不能用上长上下文」，
  不测「长程生成的一致性」。
- **小说续写/创作评测**：ConStory-Bench（arXiv 2603.05890，《Lost in Stories: Consistency Bugs in Long Story Generation by LLMs》，2026-08-06 实查确认）——2000 prompts、4 任务场景、5 类错误×19 子类、ConStory-Checker 自动检测+证据锚定。
  **它测文本内矛盾（事后检测），ShadowBench-W 测状态回写契约（生成时维护可查询状态 + 字段级证据可追溯）——互补，不是重复。**
  天命（zy-zmc/tianming-novel-ai-writer，15 维事实快照 + 12 类 CHANGES 变更声明）——「边写边维护状态」侧最接近的先例，但未开源基准评测口径。
- **World Model / 事务化记忆赛道**：OpenUSD（7423★，活跃）——「保存本源、按需投影」在三维领域
  已成工业标准，本文的 Origin IR 是同一思想在文本状态层的落地。
  更近的先例：**MemTX（arXiv 2607.23929，《Transactional Belief Commit for Stateful Agent Memory》，
  2026-08-06 实查确认）**——「memory write 不是 belief commit」，快照隔离事务 + validate-and-commit
  管线 + 证据/权限/来源/有效性。本象状态层在长文生成场景实现同款纪律；
  ShadowBench-W 的 W3 是第一个**量化**系统是否守这条纪律的公开基准
  （MemTX 只有协议设计，无公开基准与评测数据——我们补上缺失的测量）。
- **文档解析基准**（旁证赛道）：OmniDocBench（arXiv 2412.07626，CVPR 2025）——文档解析有基准，
  状态回写评测没有，这个空白就是本文的位置。
- **AI 评测方法论**：确定性规则 vs LLM-as-judge 的争论；本文 W1/W3 全部用
  确定性规则 + 词表补丁（40/40 命中、0 误报），不做 LLM 判分（避免判分器
  与生成器同源的循环论证）。

> ⚠️ 投稿前必须完成：逐条实查上述引用的最新 arXiv 编号、star、是否被抢跑；
> 按仓库规矩「引用先于宣称」。

## 3. Task & Benchmark（正文骨架）

### 3.1 任务定义

长文续写任务：给定基线语料 D₀（chapters 1-10，约 20K 字符）和续写任务 T
（chapters 11-15，含目标：林峥须从赵七处取得黑钥匙，世界规格 world/spec.origin
给出 state_at_chapter_10 / forbidden_zones），系统续写并维护状态 S。
一致性 C(D, S) 定义为：S 中每个字段与 D 中证据一致，且 D 中无与 S 矛盾的陈述。

### 3.2 基准构成

- **语料**：corpus/ch01-10.txt（约 20K 字符，UTF-8 中文，每字 3 字节——
  注意字节口径，详见 §5.4 Token 口径）
- **世界规格**：world/spec.origin/tasks/continuation.json
  （state_at_chapter_10 / forbidden_zones / goal）
- **判分器 W1**：CED（一致性错误密度）+ EPC（每百次接触错误数）。
  词表补丁版 65 条用例：40/40 命中、25 个误报陷阱全静默（Run #29）。
- **判分器 W3**：状态准确率（字段级匹配）+ 证据可追溯率（每个状态字段
  能否追溯到产生它的事件/场景）。
- **对照臂**：A0 裸模型（尾部截断）、A1 廉价向量 RAG、A3 本象臂（Origin IR 状态层）。
- **模型**：qwen-plus、deepseek-v4-flash（均为推理型，注意 reasoning tokens）。

### 3.3 指标口径（诚实边界）

- W3 的「无状态臂」（A0/A1）通过额外一轮状态询问采集，该轮 Token 计入成本
  ——不占便宜，但要在 §5 说清。
- W1 EPC 依赖词表：补丁前 13/40 命中、27 漏报；补丁后 40/40。判分器版本
  是评测的一部分，随仓库发布。

## 4. Method: Origin IR State Layer（正文骨架）

### 4.1 整体架构

```text
输入侧：context-compiler（预算编译）
  正文 + 世界规格 → 按 token 预算裁剪/投影 → 组装提示词（~6K）
输出侧：commit-compiler（解析/校验/留证）
  模型输出 → 解析状态变更声明 → 校验器（确定性规则 + 词表补丁）
  → 通过则提交事务（带证据链）→ 拒绝则留产物待人工复核（舟舱层）
```

### 4.2 状态即事务

每个状态变更以事务提交：valid_from（哪个事件）+ evidence（哪场场景/哪段正文）。
拒绝必须留下可供人接手的产物（「系统可以拒绝，但不能沉默」原则，
协议 docs/03 十条经验之一）。

### 4.3 关键设计决策（从真实失败中学到的）

- **ID 归一化层**：模型把 `char:zhao-qi` 写成 `zhao-qi` 导致 5 章全废——
  投影一律给完整 ID，提交侧归一化解析（协议第十条实证）。
- **校验器区分「拒绝」与「完成」**：全拒绝的系统错误率恒为 0——
  判定必须先要求任务完成，再比质量（协议第十一条实证）。
- **状态与文字分别把关**：状态正确 ≠ 正文正确；门禁同时校验两者
  （协议第十二条实证，三次运行错误 1/6/3 → 0/0/0）。
- **词表补丁**：确定性规则有系统性同义盲区（13/40 → 40/40），
  词表是判分器的一部分，随版本发布。

## 5. Experiments（表格骨架，数字来自 results-log 已站住的轮次）

### 5.1 主结果（qwen-plus，M-lite 50 章基线，11 轮）

| 臂 | n | W1 EPC 均值 | W3 状态准确率 | Token 均值 |
|---|---|---|---|---|
| A0 裸模型 | 11 | 1.00 | 75.0%（sd=0） | 基准 |
| A1 向量 RAG | 11 | — | 75.0%（sd=0） | — |
| A3 本象臂 | 11 | **0.20** | **98.9%** | 52263 |

W3：均值差 0.0000，p = 1.0000（A0/A1 十轮全同 75.0%）。
W1 EPC：A3 vs A0 均值差 −0.35（A0 按 1.00 计），p = 0.0392。

### 5.2 跨模型稳健性（deepseek-v4-flash）

| 臂 | n | W1 EPC | W3 | Token |
|---|---|---|---|---|
| A3 本象臂 | 11 | **0.55** | **98.9%** | 116390 |

W3 分布逐轮相同（10 轮 100% + 1 轮 87.5%）——跨模型稳健。

### 5.3 消融

| 改动 | W1 效果 | W3 效果 |
|---|---|---|
| ID 归一化前 | 5 章全废（被校验器拒） | — |
| ID 归一化后 | 通过 | — |
| 词表补丁前 | 13/40 命中、27 漏报 | 判分器口径失效 |
| 词表补丁后 | 40/40 命中、0 误报 | 判分器可信 |
| 状态+正文双重门禁 | 错误 1/6/3 → 0/0/0（三次运行） | — |

### 5.4 Token 口径（诚实边界，不选择性披露）

- qwen-plus：A3 贵 25%；deepseek-v4-flash：A3 贵 149%——**按模型分列**，
  只报前者是选择性披露（results-log Run #16 规矩）。
- 探询改送全量正文后对照臂输入 Token 会涨，「贵 25%/75%」旧数作废，
  须随补丁口径重跑一并更新（TODO，投稿前必做）。

### 5.5 已知局限（先自查，别让 reviewer 抓到）

- 判分器与门禁耦合：A3 拿同一份规则当盾、别的臂被它当尺（Run #26），
  确定性通道上的 A3 优势带循环论证成分——已在 §4.3 声明，投稿前须解耦或明确声明。
- 语义通道未并入主评分：补词表追不上自然语言的同义空间（Run #23 结论）。
- 探询口径：对照臂 75.0% 恒定值部分是探询模板自身答案（Run #18），
  已修探询但 0% 轮次是否入均值待定。
- 单一团队、两个模型：跨模型稳健性只覆盖两个模型，未覆盖闭源 SOTA。

## 6. Limitations & Broader Impact

- **局限性**：中文单语料（20K 字符基线）；双模型；确定性判分器的词表依赖；
  状态层参考实现未做生产级（无真实用户）。
- **更广影响**：状态一致性不限于小说——代码仓库、运营计划、法规执行
  （本团队 office 方言正在把「文档→可验证状态对象」落地，见附录 B）。
  基准鼓励 agent 维护可查询的世界状态，这与可解释性、可审计性目标一致。

## 7. Reproducibility（投稿时展开）

- 代码：仓库公开（匿名版去身份信息），三臂实现 + 判分器 + 词表补丁 + 65 条用例。
- 数据：corpus/、world/spec.origin/、results/（11 轮 JSON 全量）。
- 判分器指纹：judgeHashW1 / judgeHashW3，补丁后指纹未变（Run #29）。

## 附录 A：一致性向量 + 变异测试

- 19 条变异：19 条被抓出、0 条漏网（自测守承诺）。
- 其中 2 条仅自测抓到、一致性向量放过——协议覆盖缺口，补向量或声明实现自由。

## 附录 B：office 方言（原生文档 → 可验证状态对象）

- docx → Origin IR：doc:/chapter:/article:/table:/cell:/checkbox 六类对象。
- 先例实查：pandoc 45716★（16 表全丢）、markitdown 171671★（合并不还原）、
  MinerU 76864★（PDF 专用）、OmniDocBench（CVPR 2025，只有 PDF 赛道）。
- 案例：海事局 2019 公开文件，16 表 213 行全还原，悬空引用（Q103）如实报告。
- 这是 ShadowBench-W 思想在真实文档域的落地——「写后验证」的同一原则。

---

## 待办（投稿前）

- [ ] 重跑三臂 × 双模型 × 10 轮（补丁口径，results-log TODO）
- [ ] Token 口径重算（探询改送全量正文后）
- [ ] 语义通道并入主评分或明确声明排除
- [ ] 判分器与门禁解耦声明
- [ ] Related Work 逐条实查（arXiv 编号、star、被抢跑检查）
- [ ] 匿名仓库准备（清邮箱、URL、身份信息）
- [ ] 查当年 CFP：NeurIPS D&B deadline、页数、双盲要求
- [ ] 中文稿 → 英文稿（本稿是中文工作稿，投稿须全英）
- [ ] 图表：三臂对比图、状态错乱示例图（剑的转移轨迹）
