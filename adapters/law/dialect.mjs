// 法律方言 —— 用本象表示一份刑事裁判文书的「依据链」。
//
// 对象命名把**规范性文件的类别编进 ID 前缀**：
//   law:刑法/264        法律
//   interp:法释2013-8/1 司法解释
//   adminreg: / localreg: / adminrule:  行政法规 / 地方性法规 / 规章
//   guide:法发2021-21/三 司法文件（法发字号）——**不是**司法解释
//
// 这跟 CAD 方言把图层编进 ID 是同一个手法：类别本来就是法律体系里的既有分类
// （没人会把部门规章当法律），编进 ID 之后「刑事案件的裁判依据只能是法律或司法解释」
// 就是一条通配约束，校验器不需要任何法律知识。
//
// 下面的规则全部是**法律文件里本来就写着的**，不是为了演示编出来的：
//   引用白名单  法释〔2009〕14号：刑事、民事裁判文书应当引用法律、法律解释或司法解释；
//               规章及其他规范性文件经审查确认合法有效的，只能在说理部分引用
//   量刑区间    法发〔2021〕21号《关于常见犯罪的量刑指导意见（试行）》
//   调节方法    同上：同向相加、逆向相减，再对基准刑调节；可在 20% 幅度内确定宣告刑
//
// 这些今天靠人逐条核对，且量刑的中间量根本不写进判决书——错了没人看得见。

/** 各类规范性文件在各类案件中能否作为**裁判依据**引用（法释〔2009〕14号）。 */
export const CITABLE_AS_BASIS = {
  刑事: ['law', 'interp'],
  民事: ['law', 'interp', 'adminreg', 'localreg'],
  行政: ['law', 'interp', 'adminreg', 'localreg', 'adminrule'],
}

/**
 * 常见量刑情节的法定调节区间（法发〔2021〕21号 第三部分）。
 *
 * `ratio` 一律用**带符号**的比例：从宽为负、从严为正。
 * 于是「自首减少 40% 以下」就是 ratio ∈ [-0.40, 0]，直接是一条 range 约束——
 * 不需要为「减少」和「增加」写两套判定。
 *
 * `requires_law`：认定该情节后，裁判依据里必须出现的条文。
 *   注意「退赃退赔」「赔偿谅解」「认罪认罚从宽的幅度」在刑法里没有独立条文，
 *   故为 null——**没有依据的规则不许硬编一个出来**，否则会制造合规假象。
 */
export const FACTORS = {
  自首:          { min: -0.40, max: 0,     requires_law: 'law:刑法/67',     rule: '自首可以减少基准刑的40%以下' },
  坦白:          { min: -0.20, max: 0,     requires_law: 'law:刑法/67',     rule: '坦白可以减少基准刑的20%以下' },
  当庭自愿认罪:  { min: -0.10, max: 0,     requires_law: null,              rule: '当庭自愿认罪可以减少基准刑的10%以下' },
  认罪认罚:      { min: -0.30, max: 0,     requires_law: 'law:刑事诉讼法/15', rule: '认罪认罚可以减少基准刑的30%以下' },
  一般立功:      { min: -0.20, max: 0,     requires_law: 'law:刑法/68',     rule: '一般立功可以减少基准刑的20%以下' },
  重大立功:      { min: -0.50, max: -0.20, requires_law: 'law:刑法/68',     rule: '重大立功可以减少基准刑的20%-50%' },
  未遂:          { min: -0.50, max: 0,     requires_law: 'law:刑法/23',     rule: '未遂可以比照既遂犯减少基准刑的50%以下' },
  从犯:          { min: -0.50, max: -0.20, requires_law: 'law:刑法/27',     rule: '从犯应当减少基准刑的20%-50%' },
  退赃退赔:      { min: -0.30, max: 0,     requires_law: null,              rule: '退赃、退赔可以减少基准刑的30%以下' },
  赔偿谅解:      { min: -0.40, max: 0,     requires_law: null,              rule: '赔偿并取得谅解可以减少基准刑的40%以下' },
  刑事和解:      { min: -0.50, max: 0,     requires_law: null,              rule: '达成刑事和解协议可以减少基准刑的50%以下' },
  累犯:          { min: 0.10,  max: 0.40,  requires_law: 'law:刑法/65',     rule: '累犯应当增加基准刑的10%-40%' },
  前科:          { min: 0,     max: 0.10,  requires_law: null,              rule: '有前科可以增加基准刑的10%以下' },
  '未成年14-16': { min: -0.60, max: -0.30, requires_law: 'law:刑法/17',     rule: '已满14不满16周岁应当减少基准刑的30%-60%' },
  '未成年16-18': { min: -0.50, max: -0.10, requires_law: 'law:刑法/17',     rule: '已满16不满18周岁应当减少基准刑的10%-50%' },
}

/** 宣告刑相对调节结果的允许偏离（法发〔2021〕21号：可在 20% 幅度内确定宣告刑）。 */
export const DECLARED_TOLERANCE = 0.20

/**
 * 同向相加、逆向相减——指导意见规定的多情节调节方法，不是连乘。
 * @returns { total 总调节比例（带符号）, adjusted 调节后刑期（月，未取整） }
 */
export function adjust(baseMonths, ratios = []) {
  const total = ratios.reduce((s, r) => s + (Number(r) || 0), 0)
  return { total, adjusted: baseMonths * (1 + total) }
}

/**
 * 生成本案的约束表。
 *
 * 全部用核心现有的十个谓词表达（equals / in / range / exists / contains / unique / count …），
 * 不给 compiler/ 加一行代码——这是 CAD 方言已经验证过的模式：
 * **把判定所需的分类在导入时物化成字段，判定本身留给领域无关的谓词。**
 *
 * @param caseId    案件对象 ID
 * @param caseType  刑事 / 民事 / 行政
 * @param mentions  文书正文里出现的数字 [{ id, expect }]，用于正文对照状态
 * @param factors   本案认定的情节名列表，用于生成「认定该情节须引对应条文」
 */
export function lawConstraints({ caseId, caseType = '刑事', mentions = [], factors = [] } = {}) {
  const whitelist = CITABLE_AS_BASIS[caseType] ?? CITABLE_AS_BASIS.刑事
  const out = [
    // 一处引用的体检结论收敛成**一个** status 字段（ok / not-found / expired / not-citable），
    // 于是一个缺陷只产生一条违规。若拆成「存在吗」「有效吗」「可引吗」三条约束，
    // 一处伪造的引用会同时触发三条——把一个问题说成三个，几次之后没人再看体检结果。
    {
      id: 'basis-citation-ok',
      rule: `${caseType}裁判文书的裁判依据只能引用现行有效的${whitelist.map((k) => KIND_CN[k]).join(' / ')}（法释〔2009〕14号）`,
      check: { type: 'in', object: 'cite:裁判依据/*', field: 'status', values: ['ok'] },
    },
    {
      id: 'reasoning-citation-ok',
      rule: '说理引用的规范性文件必须真实存在且现行有效（法释〔2009〕14号第六条：经审查认定为合法有效的方可引用）',
      check: { type: 'in', object: 'cite:说理/*', field: 'status', values: ['ok'] },
    },
    {
      id: 'factor-must-have-evidence',
      rule: '每个量刑情节必须附证据引用（推断与事实分离：没有证据的只能标为推断，不能直接调节刑期）',
      check: { type: 'exists', object: 'factor:*', field: 'basis' },
    },
    {
      id: 'factor-name-unique',
      rule: '同一量刑情节不得重复评价',
      check: { type: 'unique', object: 'factor:*', field: 'name' },
    },
    {
      id: 'declared-within-tolerance',
      rule: `宣告刑相对调节结果的偏离不得超过 ${DECLARED_TOLERANCE * 100}%（法发〔2021〕21号）`,
      check: { type: 'range', object: caseId, field: '宣告刑偏离', max: DECLARED_TOLERANCE },
    },
  ]

  // 每个情节一条 range —— 谓词遇到字段不存在自动跳过，
  // 所以这 16 条可以无条件全发：约束是对未来的承诺，不是对当下的断言。
  for (const [name, f] of Object.entries(FACTORS))
    out.push({
      id: `factor-ratio-${name}`,
      rule: `${f.rule}（法发〔2021〕21号）`,
      check: { type: 'range', object: `factor:${name}`, field: 'ratio', min: f.min, max: f.max },
    })

  // 认定了某情节，裁判依据里就必须出现对应条文——「认定自首却不引第六十七条」是真实高发的漏引。
  for (const name of factors) {
    const need = FACTORS[name]?.requires_law
    if (need)
      out.push({
        id: `factor-law-${name}`,
        rule: `认定「${name}」的，裁判依据须引用 ${need}`,
        check: { type: 'contains', object: caseId, field: 'cited_as_basis', value: need },
      })
  }

  // 正文对照状态：说理段与判决主文里的每个数字，必须等于状态里那一份。
  //
  // 这是本象在 ShadowBench-W 上付过学费的一条——状态字段全对、正文却写错人，
  // 把确定性对照接进门禁后三次运行的错误数从 1/6/3 降为 0/0/0。
  // 判决书里同一个数字要写三遍（认定事实 / 本院认为 / 判决主文），是同一个 bug 的更贵版本。
  //
  // ⚠ 局限：这里把期望值**固化**成字面量，因为审计的是一份既成文书，其认定事实不再变动。
  //   若要在生成模式下持续成立，核心需要一个 `equals_ref`（字段对字段）谓词——
  //   `count` 已有 equals_ref，标量谓词还没有。登记为 v0.2 候选，不在方言里私自补。
  for (const m of mentions)
    out.push({
      id: `mention-${m.id}`,
      rule: `${m.where}提到的${m.label}必须与认定事实一致（派生优先于存储，同一事实不得两处记账）`,
      check: { type: 'equals', object: `mention:${m.id}`, field: 'value', value: m.expect },
    })

  return out
}

export const KIND_CN = {
  law: '法律', interp: '司法解释', adminreg: '行政法规', localreg: '地方性法规',
  adminrule: '规章', guide: '司法文件', unknown: '未知/查无此文',
}

export const LAW_MANIFEST = (id, title, source) => `# 本象包（法律方言）
artifact:
  id: ${id}
  kind: judgment
  title: ${title}

payload:
  uri: ${source}
  media_type: text/plain

provenance:
  source: ${source}
  history: ./provenance/history.jsonl
`
