# 预注册 · ShadowBench-W 消融第二批（validator / evidence 拆分）

> 状态：**预注册，未跑**。本文写于任何新实验开跑之前（2026-08-23）。
> 对应论文债务：`paper/shadowbench-w-paper-en-v0.4.md` §5.11（"What is still not separated. (b) from (c)."）。
> 写作依据全部来自只读代码审查，未改动任何现有文件；本文件是本次任务唯一新建物。

## 0. 口径冻结（开跑前的指纹）

写本文时实测（`eval/spec-hash.mjs`，2026-08-23）：

| 指纹 | 当前值 | 历史 v3-m 结果里存的值 | 含义 |
|---|---|---|---|
| specHash (continuation-m.json) | `530fa01ad056` | `530fa01ad056` | ground truth 未漂，**可比** |
| judgeHashW1 | `5da0b8adc695` | `b0eaab705dab` | 判分器改过（2026-08-13 evidenceCoverage 修正等），**历史结果必须用当前判分器重判后才可并列**。`eval/significance.mjs` 本就从 raw 正文现算分数，满足此要求 |
| judgeHashW3 | `bff505896ffb` | `e2a12b4d9710` | 同上 |
| armsHash | `1b774ce1c220` | `80b1ffb7b389`（a3）/ `d15bc56d43b0`（a2） | 本次要**新增**臂文件，armsHash 必然再变。可比性不由 armsHash 相等担保，改由「`arms/a3-benxiang/`、`arms/a2-prompt-state/` 及其外部依赖（`compiler/*.mjs`、`eval/ced.mjs`）在新臂落地前后 `git diff` 为空」担保，执行时须留存该 diff 为空的记录 |

模型通道映射（`arms/lib/model.mjs:107-234` 实核）：`--provider hermes` = deepseek-v4-flash，`--provider bailian` = qwen-plus（默认）。历史文件名里的 `-hermes-` 是 deepseek，`-bailian-` 是 qwen。

---

## 1. 要回答的问题（可证伪形式）

论文 §5.11 把 A3 的机器拆成 (b) 校验器与 (c) 证据链，问残余的 +2.5pt（不显著）和证据能力（15.0% / 27.5% 覆盖率）是否来自同一部件。**代码审查发现这个二分法与实现不对齐**，先重述再提问。

### 1.1 代码审查结论（核实过的，不是推测）

A3 臂（`arms/a3-benxiang/index.mjs`）实际由四个部件组成：

1. **上下文编译器**（`context-compiler.mjs`）：输入侧投影 + 预算。
2. **事务契约**：输出格式要求 `state_changes` 差分 + `assertions`（`context-compiler.mjs:154-167` buildPrompt）。
3. **校验器 + 退回重试**（`commit-compiler.mjs` validateTransaction + `index.mjs:32-78` 的 ≤2 次重试循环）。
4. **证据链**：`index.mjs:80` + `commit-compiler.mjs:156-161`——evidence 映射（如 `"obj:black-key.holder": "ch52"`）由 applyTransaction 的 journal **纯派生**。

**关键事实：证据链是只写不读的遥测。** 它在事务被接受之后从 journal 里抄出来，从不回流进提示词，也不参与校验（全代码路径核实）。因此：

> **「A3 − evidence chain」这条臂在因果上是退化的：删掉 evidence 映射不改变生成路径的任何一个字节，W1/W3 必然与 A3 逐字节同分，唯一变化是证据指标被硬置为 0。这个问题不需要跑实验，读代码就能裁决。**

真正能因果地影响生成、同时又是证据能力前提的，是**事务契约本身**（部件 2）：模型以差分形式写状态 → 才有 journal → 才有 evidence。A2 以整份快照写状态，结构上无 journal，evidence 恒为 `{}`（`a2-prompt-state/index.mjs:76-86` 核实，历史结果 `results-v3-m-ablation/a2-m-hermes-rep1.json` evidence 键数为 0 实测确认）。

### 1.2 重述后的可证伪问题（2×2 因子设计）

以 {输出契约: 快照 | 事务差分} × {校验器: 关 | 开} 张成四臂：

| | 校验器关 | 校验器开 |
|---|---|---|
| 快照契约 | **A2**（已有 n=10×2） | **A2+V**（新） |
| 事务契约（含编译器） | **A3−V**(新) | **A3**（已有 n=10×2） |

- **Q1（校验器对状态准确率）**：A3−V 的 W3 与 A3 有无可检出差异？可证伪命题：*若校验器对 W3 无贡献，则 A3 vs A3−V 的 W3 置换检验 p ≥ 0.05 且点差 ≤ 2.5pt（两模型均如此）。*
- **Q2（校验器对正文错误）**：A3−V 的 W1 EPC 是否劣化？可证伪命题：*在校验器实际高频开火的模型（qwen-plus，历史 10 轮共 72 次拒绝）上，A3−V 的 EPC 显著高于 A3（单侧 p < 0.05）。*
- **Q3（证据能力归属）**：A3−V 的 evidenceCoverage 是否 ≈ A3？可证伪命题：*若证据能力来自事务契约而非校验器，则 A3−V 的覆盖率与 A3 之差在 ±10pt 以内，且 A2+V 覆盖率恒为 0%。*
- **Q4（校验器可移植性）**：把校验器加到快照契约上（A2+V），W1 是否改善、W3 是否仍在天花板？

Q3+Q4 合起来回答论文 §5.11 的原问题：证据能力和残余分数是否同源——预期答案是**不同源**：证据能力属于契约，残余 2.5pt 属于噪声。

## 2. 臂定义（精确到关掉哪个环节）

**通则**：新臂各建独立目录（`arms/a3v-novalidator/`、`arms/a2v-validated/`），只 import 现有模块，**不改动 A2/A3 任何现有文件**——历史臂的字节不变是可比性的根。新臂通过 `run.mjs --arm` 显式选择（不入 `all`，同 a2/a4 先例，`run.mjs:84-86`）。

### A3（对照，不重跑）
原样。数据复用 `results-v3-m/a3-m-{hermes,bailian}-rep1..10.json`。

### A3−V（新）
- 复用 `a3-benxiang/context-compiler.mjs` 的 `compileContext` 与 `buildPrompt`——**提示词与 A3 逐字节相同**（含「将由校验器逐条复核」那句；见 §7 对该欺骗性混淆的披露）。
- 每章只调用模型 **1 次**：`normalizeTransaction(res.parsed, knownIds)` 后**直接** `applyTransaction`，不调 `validateTransaction` 决定取舍、不退回、不重试。
- 正文取值规则：`tx.text` 为非空字符串则用之，否则用 `res.raw` 落为该章正文（不设 rejected 概念）；`state_changes` 非数组则本章不落任何状态变更（显式记账 `parseFailures`，同 A2 的处理哲学）。
- **影子校验（观测不干预）**：每章仍调用一次 `validateTransaction`，但结果只记入输出 JSON 的 `shadowGate` 字段（attempts/would-reject/byCode），**绝不**影响接受、提示词或重试。它是 §6 恒绿守卫的数据来源。
- evidence 派生路径原样保留（journal → evidence 映射）。

**耦合披露**：关掉校验器会连带关掉「重试即多采样」——A3 每章最多 3 稿取（首个通过 | 错误最少）稿，A3−V 恒为 1 稿。因此 Q2 若阳性，无法区分「确定性规则反馈」与「多采样 best-of-n」两种机制（见 §7.4）。这是实现层的真耦合，本预注册选择披露而非硬拆。

### A2+V（新）
- 复用 `a2-prompt-state/index.mjs` 的 buildPrompt 与快照解析——提示词与 A2 逐字节相同。
- 每章解析出 `{text, state, hooks}` 后过校验：以快照本身为 stateAfter，跑 ① `checkConstraints(stateAfter, zonesToConstraints(task.forbidden_zones))`（`commit-compiler.mjs:46-58` 的翻译表）② `hookViolations`（hooks 投影上的 equals）③ `eval/ced.mjs` RULES 正文对照 ④ text 非空。不校验 assertions（A2 契约不含它，此为两臂已声明的差异）。
- 不通过则按 A3 同款文案格式退回重试，≤2 次；重试耗尽收错误最少一稿并记 needsReview——**与 A3 的门禁语义逐条对齐**（`a3-benxiang/index.mjs:62-75`）。
- evidence 恒为 `{}`（快照契约结构上无 journal——这正是要测的）。

### A3−evidence（原论文设想的第二臂）：**裁定不跑**
理由见 §1.1：evidence 是接受后的纯派生物，删除它不触碰生成路径，跑 10 轮的期望产出是「与 A3 在 W1/W3 上无差异」这句用一行代码引用就能证明的话。以 A2+V（证据能力=0 的带校验臂）替代其解释职能。**若审稿人坚持要跑**，其唯一合法解读是作为装置回归测试（应得逐字节可预期的结果），不是消融。

## 3. 指标（全部确定性，无 LLM-as-judge）

| 级别 | 指标 | 定义处 | 说明 |
|---|---|---|---|
| **主** | W3 stateAccuracy | `eval/state-diff.mjs:42-107` | 必答字段逐一比对，Q1 的判据 |
| **主** | W1 EPC（errors/章） | `eval/ced.mjs` RULES，`run.mjs:158` | Q2 的判据 |
| 副 | evidenceCoverage | `state-diff.mjs:89-96`（按 id.field 精确匹配必答字段） | Q3 判据；**必与 evidenceTraceability 并报**，只报一个是选择性披露（该文件 70-81 行注释的既有裁决） |
| 副 | evidenceTraceability | `state-diff.mjs:83-84` | 精确率维度 |
| 副 | token 用量（API 真值） | result.usage | 校验器的成本项 |
| 观测 | shadowGate would-reject 数 / A2+V gate.rejections | 新臂输出 | 恒绿守卫输入，不是成绩 |

判分为何必须确定性：本仓库判分器已九次因口径漂移引发事故并逐一上了指纹闸（`eval/spec-hash.mjs` 全文），引入 LLM 判分等于把全部指纹闸作废；且同型先例（source 解引用式判据）已证明确定性判据够用。

**统计方法**：沿用 `eval/significance.mjs` 的精确置换检验（C(20,10)=184,756 全枚举，轮为独立单元）。验证性检验族 = {Q1-W3, Q2-EPC} × {deepseek, qwen} 共 4 个，Holm 校正，族 α=0.05。Q2 单侧（A3−V 更差），Q1 双侧。Q3/Q4 为描述性/次要，报点估计与全部 p 值，不进验证性结论。**分析用当前判分器从 raw 正文现算**（significance.mjs 本就如此），历史与新批同口径；注意该脚本现版硬编码 `results/` 目录与 `-bailian-` 文件名（`significance.mjs:23,33`），执行时需加 `--dir/--provider` 参数化——这是分析工具补全，不改判分逻辑，改动纳入 judgeHash 之外的工具集（SCORERS 白名单外，`spec-hash.mjs:63-64`）。

## 4. 模型与 n

- **钉死 deepseek-v4-flash（hermes 通道）与 qwen-plus（bailian 通道）**，与全部历史数据同通道同配置。理由：本次消融的对照组（A2/A3 各 n=10×2）已在盘上，换模型等于把 40 轮已验证数据作废重跑。
- **n = 10 / 臂 / 模型**，新增 2 臂 × 2 模型 × 10 = 40 轮。与历史 n 对齐才能用同一个精确置换检验。不加大 n：W3 在天花板（A3 多数轮 100%），n=10 检不出 2.5pt 本就是已发表事实，加 n 是钓鱼。
- **免费模型 `x-preview-f-free`（Ox Alpha）裁定：不进验证性实验，允许一个隔离的探索性附录。**
  - 不进的理由（按强度排序）：① 无 model card——**连「测的是什么」都无法命名**，验证性主张的最低要求是被测物可指认；② 约一周后消失，而 A0/A2/A3 在它身上没有任何历史基线，进主对比必须 4 臂 × 10 轮全套重跑，其结论却锚不到任何可复现的被测物上；③ 主实验的全部 p 值来自与历史数据的并列，换模型即不可并列。
  - 允许探索性附录的条件（全部满足才跑）：4 臂（A0/A2/A3/A3−V）各 n=10 在**同一窗口**内跑完；结果落 `results-v3-m-ablation2-explore/` 隔离目录；raw 输出冻结（生成不可复现，但判分永远可复现——这与本仓库对 API 模型漂移的既有立场一致）；论文若引用只能进附录并标注「被测模型已不可获得」。价值：检验「要状态 vs 造机器」的模式是否在前沿级模型上重现。它的失败或缺席不影响主实验任何结论。

## 5. 预先声明的预期结果（跑之前写死）

论文 §5.11 原话：「the honest expectation is that the validator contributes nothing measurable here and the evidence chain is doing all the remaining work」。本预注册把它细化为四条并加上机制依据：

| # | 预期 | 机制依据（跑前实测） | 若相反意味着什么 |
|---|---|---|---|
| E1 | **Q1 无差异**：A3−V 的 W3 与 A3 差 ≤2.5pt，p≥0.05，两模型均如此 | 历史 A3 的拒绝里 W3 相关码（forbidden-zone/assertion-failed/schema）合计仅 8/82，主力是 prose-violation（106/114 条错误）；且 stale-write 本就是不拦截的警告 | 校验器确实守住状态 → §5.11 的预期错了，残余归 (b)；「机器无用」的叙事需收回一半 |
| E2 | **Q2 在 qwen 上阳性、deepseek 上弱或无**：qwen A3−V 的 EPC 显著劣于 A3；deepseek 差异不显著 | qwen 历史 10 轮 72 次拒绝（首稿 prose-violation 密集，`results-v3-m/a3-m-bailian-*` 实测）；deepseek 仅 10 次且 6 轮为 0 | 若 qwen 上也无差异：被拒首稿与重写稿在判分器眼里等价 → 校验器连正文都不贡献，或 W1 判分器对该类错误不敏感（用 shadowGate 与 EPC 的逐章对照区分这两种解释） |
| E3 | **Q3 证据幸存**：A3−V 的 evidenceCoverage 与 A3 差 ±10pt 内（deepseek 15.0%、qwen 27.5% 附近）；A2+V 恒 0% | evidence 由 journal 派生，与校验无关（代码事实）；唯一可能拉低它的是无校验时垃圾事务污染 journal | 若 A3−V 证据崩塌：证据能力依赖校验器过滤 → (b)(c) 真同源，论文「机器只剩证据链值得留」需改写为「证据链连着校验器一起留」 |
| E4 | **Q4 半阳性**：A2+V 的 EPC 优于 A2（至少 qwen 上），W3 与 A2 无差异（天花板），evidence 0% | 校验器的主开火面是正文规则，与契约无关，理应可移植 | 若 EPC 不改善：校验器的 W1 贡献依赖事务契约的上下文（编译器投影），不可单独移植 |

**总预期写死为**：残余 2.5pt 无人认领（继续不显著），证据能力归事务契约，校验器的可测贡献只在 W1、且只在首稿质量差的模型上。**事后不得以「探索发现」名义把任何与此表冲突的结果升格为验证性结论。**

## 6. 恒绿守卫：什么算「这次什么都没测出来」

对标 LoCoMo 预注册的 nomem 地板臂——一次没有暴露量的消融不是阴性结果，是没做实验：

1. **曝险下限**：A3−V 的 shadowGate 在某模型 10 轮累计 would-reject < 5 次 → 该模型上的 Q1/Q2 判「**未受测**」（校验器本就没机会开火，拆掉它当然无差异），不得写成「校验器无贡献」。按历史数据预测：qwen 约 72、deepseek 约 10，deepseek 已贴着这条线——**跑前就承认 deepseek 侧很可能只产出「未受测」**。
2. **A2+V 退化检查**：其 gate.rejections 10 轮累计 < 5 → 该臂退化为贵版 A2，Q4 判未受测。
3. **结构地板**：A2 既有数据的 evidence=0% 是结构性地板；A2+V 若测出任何非零 evidence，是装置 bug（快照路径不可能产生 journal），立即停跑查错。
4. **装置对照**：A3−V 与 A3 的提示词必须逐字节相同（写一个 projection-equivalence 同款比对脚本），不同即全部作废——否则测的是提示词差异不是机制差异。

## 7. 已知会让结果难看的地方（先写在这里）

1. **天花板效应**：A3 的 W3 在 20 轮里 18 轮 100%，Q1 只能检「拆掉后掉不掉」，检不出「装上有多好」；n=10 对 2.5pt 的功效低到论文自己都以 p=0.47 收场。**本次实验大概率给 Q1 一个信息量很低的阴性。**
2. **编译器混杂**：A3−V 保留上下文编译器，所以「事务契约」因子实为「契约+编译器」捆绑；2×2 表的行因子不纯。拆干净要再加 2 臂，本次裁定不加，作为设计上限声明。
3. **提示词欺骗混杂**：A3−V 的提示词仍宣称「将由校验器逐条复核……写了做不到会被判失败」，但实际无人复核。模型对威慑的信念可能独立于机制起作用——这会把 Q1/Q2 **推向阴性**（威慑还在，只少了执行）。保留原文是为了单变量；代价是「校验器无贡献」若成立，只能主张「执行环节无贡献」，不能主张「威慑句无贡献」。
4. **重试=多采样混杂**（§2 已述）：Q2 阳性时归因含糊。干净的拆法需要「无反馈同次数重试」对照臂，本次不跑，列为条件性后续（仅当 Q2 效应量大再立项）。
5. **armsHash 必变**：新增臂文件后所有新 provenance 的 armsHash 与历史不同，可比性论证从「指纹相等」降级为「共享文件 git diff 为空 + 判分现算」。这是指纹机制跟着目录走的已知局限（`spec-hash.mjs:94-112` 自己注释过）。
6. **A2 的 W3 对照里有 95.0%（qwen）**：若 A2+V 的 W3 反而下降（重试引入的快照重写噪音），会出现「加校验掉分」的难看格子——先声明这是可能结果而非装置错误。

## 8. 停止条件（中止优于硬跑）

1. `specHash` ≠ `530fa01ad056` → 立即中止（ground truth 漂了，第二起事故同型）。
2. 生成期内任何人改 SCORERS 白名单内文件 → 生成照跑（正文是冻结产物），但分析必须等全部批次跑完后用**单一版本**判分器统一现算；禁止批次间混用口径。
3. 任一钉死通道连续失败率 > 20% → 暂停该模型全部臂（并发/超时惩罚不对称的教训，`run.mjs:94-101` 注释）；**禁止**中途换通道或换模型续跑。
4. 结果目录检出并发锁 → 等待，禁用 `--allow-concurrent`（Run #10 事故）。
5. 守卫 1 触发（曝险不足）→ 该模型侧到 n=10 即停，**不得加轮次钓显著性**；n=10 跑满后无论结果如何不追加。
6. A2+V 出现非零 evidence（守卫 3）→ 停跑修装置。
7. 免费模型探索附录：配额消失/失败率超 20% → 直接放弃整个附录，不迁移不补跑。

---

## 9. 执行方案

### 步骤与依赖（顺序硬约束用 → 标注）

| 步 | 内容 | 类型 | 执行者 | 预估 |
|---|---|---|---|---|
| 1 | 写 `arms/a3v-novalidator/`、`arms/a2v-validated/`（只 import 不改现有文件）+ 提示词逐字节等价比对脚本 | **产物型**（代码冻结后可校验，谁写的无所谓） | 可委外 ox/codex 起草，**Claude 终审**（判断不外包） | 半天 |
| 2 | → stub 全流程连通（`--provider stub`，含 violating 场景验 A2+V 真会拒） | 产物型 | 本机 | 10 分钟 |
| 3 | → 留存 `git diff` 为空证明（a2/a3 臂目录 + compiler 依赖）+ 记录四指纹 | 产物型 | 本机 | 5 分钟 |
| 4 | → 正式跑：`node run.mjs --provider {hermes,bailian} --task continuation-m.json --arm {a3v,a2v} --repeat 10 --out results-v3-m-ablation2`（沿 relay-v3-m.sh 的断点续跑模式） | **测量型**（必须钉死模型，不可用免费模型顶班） | 本机钉死通道 | A3−V 每轮 5 调用、A2+V 5–15 调用；按历史 ~110s/调用，40 轮约 6–12 小时墙钟，可两通道并行（不同 --out 无锁冲突） |
| 5 | → 分析：significance.mjs 参数化（--dir/--provider）后跑 4 个验证性检验 + 副指标表 | 产物型（判分确定性，永远可重跑） | Claude | 1 小时 |
| 6 | （可选）免费模型探索附录：4 臂 × 10 于 `results-v3-m-ablation2-explore/` | 生成不可复现、**判分可复现**的混合型；raw 冻结即为产物 | ox 通道 | 免费，~31s/题，但受一周窗口硬限 |
| 7 | → 结果按 §5 预期表逐条对照写入 results-log.md 新 Run 条目；论文改动另立提交 | 产物型 | Claude | — |

产物型/测量型划分依据：raw 正文与状态一旦落盘即冻结，判分器确定性 → 事后任何人任何时候可重判（模型消失无所谓）；唯独**生成**那一步依赖活模型，故步 4 是全案唯一不可回溯环节，通道纪律全部压在它身上。

## 10. 值不值得做（裁定）

**值得，但只值原设想的一半，且必须按本文重述后的形状做。**

- 「A3−evidence」按论文原设想**不值得跑**：读代码即可裁决（§1.1），跑它是花 10 轮 API 钱买一句代码注释。
- 「A3−validator」**值得跑**：成本小（≤6 小时墙钟、几百次调用），而它是论文已锚定文本里的显式债务；且 shadowGate 设计让哪怕全阴性的结果也带机制解释（曝险数据），不是白跑。
- A2+V 是新增的、原论文没许诺的臂，但它是把「证据能力归属契约」从代码论证升级为实验论证的唯一途径，边际成本一臂而已。
- 同时压低期望：Q1 大概率产出低信息阴性（天花板+低功效），deepseek 侧大概率「未受测」。这次消融买到的主要是三样东西：§5.11 债务的清偿、E2/E4 两个真有开火面的测量、以及证据能力归属的实验封印。买不到的是对 2.5pt 的最终裁决——那需要一个不在天花板上的任务，超出本预注册范围。
