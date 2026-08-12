// Paper 方言 —— 用本象表示「一批论文的主张，以及我们凭什么信它」。
//
// 通用外壳（对象 + 字段 + 确定性规则 + 证据链）由 compiler/ 提供，这里只加两样东西：
// **一组对象类型**，和**一组机器可判定的约束**。没有一行新的校验代码——
// 这是方言的入场券：若表示一批论文还需要改校验器，那它就不是协议，只是又一个文献管理器。
//
// ── 为什么需要这个方言 ────────────────────────────────────────────────
//
// 读论文的默认产物是**散文摘要**：「A 论文说 harness evolution 有 16.6 点增益」。
// 散文摘要有三个结构性缺陷，且三个都在 ShadowOS 的文献台账上实际发生过：
//
//   1. **读没读过原文，散文里看不出来**。同一句话，可能来自 abs 页，也可能来自搜索
//      引擎的二次转述。2026-08-10 的台账里 12 条只有绰号没有出处，事后核了 3 条。
//   2. **数字与它的成立条件分家**。「+16.6 点」脱离基准、脱离预算就是个装饰。
//      arXiv:2607.12227 的全部论点就是这件事：harness evolution 自己是一次迭代搜索，
//      拿搜索时用的基准做最终评测，增益分不清来自设计还是来自预算。
//   3. **作者自称与外部复现混在一起**。论文里的「我们提升了 X」是**作者给自己发证**，
//      与学堂盘点出的「58 条经验、49 条自称 verified、0 条能被任何人重跑」同型。
//
// 方言把这三件事变成会变红的判据，而不是写作纪律。
//
// ── 五类对象 ──────────────────────────────────────────────────────
//
//   paper:      论文本身——元数据必须来自我们控制不了的外部索引
//   claim:      论文做的一条主张——**按定义是作者自称，一律 candidate**
//   repl:       独立复现——唯一能把主张抬成 verified 的东西，且必须指出是谁做的
//   bench:      评测基准——必须交代搜索集与评测集是否同源
//   critique:   论文之间的批评关系——批评是否被回应，是领域可信度的一手指标
//
// 刻意不收的：论文全文、我们自己的读后感、「这篇很重要」之类的评价。
// 那些属于操作窗口。**能被丢掉而不心疼，正是这套设计要换来的东西。**

export const PAPER_TYPES = ['paper', 'claim', 'repl', 'bench', 'critique']

/** 元数据来源。分界线是「谁能改它」——我们改得动的，不算外部核验。 */
export const INDEX_SOURCES = ['openalex', 'crossref', 'datacite']

/**
 * 我们读到什么程度。**这一列是本方言最便宜也最值钱的一格。**
 * `search_snippet`（只见搜索引擎摘要）刻意不在合法取值里——它必须变红，
 * 因为它是「二次转述当一手引用」的唯一入口，而那正是 2026-08-10 事故的形状。
 */
export const READ_LEVELS = ['fulltext', 'abstract']
export const READ_LEVELS_ALL = ['fulltext', 'abstract', 'search_snippet']

/**
 * 成熟度。**这一格是跑真数据跑出来的**，第一版方言没有，结果录进三条 Zenodo 自存件
 * 才发现分不开：其中一条正文自称「structured research outline establishing priority,
 * full paper in preparation」——**那是占坑，不是论文**，但它当时和一篇完整预印本
 * 长得一模一样，主张会被同等计入结论。
 *
 * 分界线不是「在哪发的」（arXiv 也是自存），而是**有没有完整正文与可核的结果**：
 *   peer_reviewed  过了同行评议
 *   preprint       有完整正文，未评议
 *   outline        占坑稿 / 摘要式声明，作者自己说正文还没写
 *   release        软件发布物 / 数据集存档，不是研究主张
 * 后两种不在合法取值里 —— 不是说它们没价值，是说**它们的主张不该和论文的主张一起计数**。
 */
export const MATURITY = ['peer_reviewed', 'preprint']
export const MATURITY_ALL = ['peer_reviewed', 'preprint', 'outline', 'release']

/** 主张状态。与学堂的经验生命周期同构：verified 只由外部复现给，作者自称一律 candidate。 */
export const CLAIM_STATUS = ['candidate', 'verified', 'refuted']

/** 搜索集与评测集的关系。`undisclosed` 不在合法取值里——不交代就是红。 */
export const SPLIT_DISCLOSURE = ['disjoint', 'shared']
export const SPLIT_DISCLOSURE_ALL = ['disjoint', 'shared', 'undisclosed']

/** 批评的下场。领域健康度看的是 answered 的比例，不是 critique 的条数。 */
export const CRITIQUE_STATUS = ['open', 'answered', 'withdrawn']

/**
 * 方言约束。全部用通配对象——新录一篇论文，约束自动覆盖它，
 * 不需要有人记得去补一条规则。「忘了加约束」是台账腐坏最常见的入口。
 *
 * 注意 `claim:` 与 `repl:` 是**两个命名空间，不是一个字段的两个取值**。
 * 这是刻意的：作者自称的主张，无论写得多确定，都进不了 `repl:`——
 * 想让一条主张变成 verified，唯一的路径是有人往 `repl:` 里放一个对象，
 * 并交代出处与独立性。**用命名空间承载举证责任，比用字段更难绕过。**
 */
export const PAPER_CONSTRAINTS = [
  // ── paper：元数据不能是我们自己转述的 ──
  { id: 'paper-title', rule: '每篇论文必须有标题',
    check: { type: 'exists', object: 'paper:*', field: 'title' } },

  { id: 'paper-doi', rule: '每篇论文必须有 DOI 或等价永久标识',
    check: { type: 'exists', object: 'paper:*', field: 'doi' } },

  // 同一篇被录两次，会让「N 篇论文都这么说」凭空变大——统计者谎报的最省事版本
  { id: 'paper-doi-unique', rule: 'DOI 不得重复',
    check: { type: 'unique', object: 'paper:*', field: 'doi' } },

  { id: 'paper-index-source', rule: '论文元数据必须来自外部索引（openalex/crossref/datacite）',
    check: { type: 'in', object: 'paper:*', field: 'index_source', values: INDEX_SOURCES } },

  { id: 'paper-index-source-req', rule: '元数据来源必填',
    check: { type: 'exists', object: 'paper:*', field: 'index_source' } },

  { id: 'paper-read-level-req', rule: '必须声明我们读到什么程度',
    check: { type: 'exists', object: 'paper:*', field: 'read_level' } },

  // 只见搜索摘要就引用 —— 这条红是设计出来的，不是失败
  { id: 'paper-read-level', rule: '只见搜索引擎摘要不构成可引用的阅读',
    check: { type: 'in', object: 'paper:*', field: 'read_level', values: READ_LEVELS } },

  { id: 'paper-maturity-req', rule: '必须声明成熟度（评议/预印本/占坑稿/发布物）',
    check: { type: 'exists', object: 'paper:*', field: 'maturity' } },

  // 占坑稿与软件发布物的主张，不该和论文的主张一起计数
  { id: 'paper-maturity', rule: '占坑稿 / 软件发布物不构成可引用的研究主张',
    check: { type: 'in', object: 'paper:*', field: 'maturity', values: MATURITY } },

  // ── claim：数字必须和它的成立条件一起存在 ──
  { id: 'claim-paper', rule: '每条主张必须指向一篇论文',
    check: { type: 'exists', object: 'claim:*', field: 'paper' } },

  { id: 'claim-statement', rule: '每条主张必须写明主张内容',
    check: { type: 'exists', object: 'claim:*', field: 'statement' } },

  { id: 'claim-bench', rule: '每条主张必须指明在哪个基准上成立',
    check: { type: 'exists', object: 'claim:*', field: 'bench' } },

  // arXiv:2607.12227 的判据搬过来：报增益必须同时报预算，否则分不清设计还是搜索
  { id: 'claim-budget', rule: '报告增益必须同时报告搜索/推理预算',
    check: { type: 'equals', object: 'claim:*', field: 'budget_reported', value: true } },

  { id: 'claim-split-req', rule: '必须交代搜索集与评测集的关系',
    check: { type: 'exists', object: 'claim:*', field: 'split_disclosed' } },

  { id: 'claim-split', rule: '搜索集与评测集的关系不得是「未交代」',
    check: { type: 'in', object: 'claim:*', field: 'split_disclosed', values: SPLIT_DISCLOSURE } },

  { id: 'claim-status-domain', rule: '主张状态只能是 candidate / verified / refuted',
    check: { type: 'in', object: 'claim:*', field: 'status', values: CLAIM_STATUS } },

  // **本方言的承重判据。** 作者自称不是证据，无论他多确定。
  // 与学堂 X2.1「写经验只能写 candidate，verified 只由考试给」逐字对称。
  { id: 'claim-no-self-cert', rule: '论文自报的主张一律 candidate —— verified 只能由 repl: 对象给',
    check: { type: 'equals', object: 'claim:*', field: 'status', value: 'candidate' } },

  // ── repl：唯一的发证通道，因此举证责任最重 ──
  { id: 'repl-target', rule: '每条复现必须指明复现的是哪条主张',
    check: { type: 'exists', object: 'repl:*', field: 'claim' } },

  { id: 'repl-source', rule: '每条复现必须给出可核验的出处',
    check: { type: 'exists', object: 'repl:*', field: 'source' } },

  // 原作者又跑了一遍不叫复现——这条防的是「换个马甲自己给自己发证」
  { id: 'repl-independent', rule: '复现方必须独立于原作者',
    check: { type: 'equals', object: 'repl:*', field: 'independent', value: true } },

  // ── bench：同源评测是本领域当前最大的系统性风险 ──
  { id: 'bench-name', rule: '每个基准必须有名字',
    check: { type: 'exists', object: 'bench:*', field: 'name' } },

  { id: 'bench-public', rule: '必须交代基准是否公开可跑',
    check: { type: 'exists', object: 'bench:*', field: 'public' } },

  // ── critique：批评有没有被回应 ──
  { id: 'critique-ends', rule: '批评必须写明双方',
    check: { type: 'exists', object: 'critique:*', field: 'from' } },

  { id: 'critique-target', rule: '批评必须写明被批评方',
    check: { type: 'exists', object: 'critique:*', field: 'to' } },

  { id: 'critique-status', rule: '批评状态只能是 open / answered / withdrawn',
    check: { type: 'in', object: 'critique:*', field: 'status', values: CRITIQUE_STATUS } },

  // ── 台账对账：防「统计者谎报」──
  // 台账自己声称收了几篇几条，必须和盘上真实的对象数对得上。
  // 这是门窗表 5 樘 / 平面图 4 樘那类事故在文献域的同构体。
  { id: 'ledger-papers', rule: '台账声称的论文数必须等于实有论文数',
    check: { type: 'count', object: 'paper:*', equals_ref: 'ledger:harness.papers_declared' } },

  { id: 'ledger-claims', rule: '台账声称的主张数必须等于实有主张数',
    check: { type: 'count', object: 'claim:*', equals_ref: 'ledger:harness.claims_declared' } },
]

export const PAPER_MANIFEST = (id, title) => `# 本象文献包（Paper 方言）
artifact:
  id: ${id}
  kind: paper
  title: ${title}

provenance:
  history: ./provenance/history.jsonl
`

/** 交给模型的输出契约。模型只有知道要交什么形状的东西，才可能交对。 */
export const TX_CONTRACT = [
  '一个语义事务。只写本轮**真实核到**的东西，不要把「大概是这样」写成字段。',
  'object 必须用完整 ID（含 paper: / claim: / repl: / bench: / critique: 前缀）。',
  '**不许自己给主张写 status: verified**。作者自称一律 candidate；',
  '要抬成 verified，必须新建一个 repl: 对象，写明 source 与 independent。',
  'read_level 只有三种可写：fulltext（读了全文）、abstract（读了摘要页）、',
  'search_snippet（只见搜索引擎转述）。**第三种会判红，这是对的**——',
  '把它写成 abstract 来换绿灯，就是本方言唯一真正防不住的作弊，也是唯一不可原谅的。',
  '不确定当前值就不要写 from——写错只记为偏差，不影响落地。',
].join('\n')

/** 一个空文献包的初始对象表。留一个台账锚对象，否则连对账都没处对。 */
export const emptyPaperObjects = (topic = 'harness') => ({
  [`ledger:${topic}`]: {
    type: 'ledger',
    topic,
    papers_declared: 0,
    claims_declared: 0,
  },
})
