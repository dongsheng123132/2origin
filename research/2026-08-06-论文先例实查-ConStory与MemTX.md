# 2026-08-06 · 论文先例实查：ConStory-Bench 与 MemTX

> 缘起：论文初稿写 Related Work 时，必须验证引用的先例是否真实存在、做了什么、
> 我们的增量是否站得住。按仓库规矩「引用先于宣称」——如果引用是编的或被抢跑，
> 论文会被 reviewer 直接打死，比不引用更糟。
> 核实方式：arXiv 页面实查（2026-08-06 当日）。

---

## 一、两个关键先例（都真实存在，且高度相关）

### 1. ConStory-Bench —— arXiv 2603.05890

**《Lost in Stories: Consistency Bugs in Long Story Generation by LLMs》**

- 2000 prompts，4 个任务场景
- 一致性错误分类法：5 类错误 × 19 个细分子类
- ConStory-Checker：自动化矛盾检测管线，每个判定锚定显式文本证据
- 发现：错误在事实维和时间维最常见、集中在叙事中段、与高熵文本段相关

**对我们的威胁**：它已经在测「长故事一致性」——如果论文宣称「状态一致性是空白」，会被直接拒。

**但差异是真实的**：
- ConStory-Bench 测**文本内矛盾**（text vs text，事后检测已生成散文）
- ShadowBench-W 的 W3 测**状态回写契约**（state-writeback）：系统被要求维护可查询世界状态（一等对象），
  该状态是否与正文字段级一致、每个字段能否追溯到证据
- 一句话：ConStory 问「故事自相矛盾了吗？」，ShadowBench-W 问「系统能说出它相信什么、并证明吗？」
- W3 的证据可追溯率在 ConStory-Bench 里没有对应物

### 2. MemTX —— arXiv 2607.23929

**《Transactional Belief Commit for Stateful Agent Memory》**

- 核心论点：memory write 不是 belief commit（记忆写入≠信念提交）
- 每条记录带 evidence / permissions / provenance / validity
- 写入在快照隔离事务内 staged，由 validate-and-commit 管线准入
- 撤回信念触发类型化级联修复

**对我们的意义**：这是和本象协议核心主张**几乎同构**的协议设计（事务、证据链、validate-and-commit）。
仓库 outreach/02 已有给 MemTX 作者的信（定位：工程化落地尝试，求反馈）。

**差异**：MemTX 是协议设计，**没有公开基准、没有评测数据**。
ShadowBench-W 的 W3 是第一个量化「系统是否守这条纪律」的公开基准——
我们补上的是 MemTX 缺的测量。这反而强化论文：不是重复，是补缺。

---

## 二、对论文的影响（已落实到稿件）

1. **定位修正**：从「状态一致性是空白」→「状态回写契约无基准」。
   ConStory-Bench 是文本内矛盾检测（事后），ShadowBench-W 是状态回写评测（生成时维护）。
   互补，不重复——这个差异要写进 Abstract / Intro / Related Work 三处。
2. **MemTX 进 Related Work**：承认同构性（引用先于宣称），说明差异是「协议 vs 基准」。
3. **OmniDocBench 编号修正**：真实 arXiv 是 2412.07626（我最初猜 2408.15216 是量子物理论文，错了）。
4. **检查清单更新**：投稿前仍需逐条核实 LongBench 等其余引用。

---

## 三、教训

- Related Work 必须逐条实查 arXiv——ConStory-Bench 就是差点被当「空白」的例子，
  实查救了一篇论文的定位。
- 先例相关不等于被抢跑：同赛道（一致性评测）但不同测量对象（文本内 vs 状态回写），
  差异说清楚就是互补，说不清楚就是撞车。
- 仓库 outreach/02 的 MemTX 信在此刻显得更聪明了——作者联系在先，引用在后，顺理成章。
