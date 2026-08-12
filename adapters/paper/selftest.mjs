#!/usr/bin/env node
/**
 * paper 方言自检。
 *
 * **反向用例（标 ✗ 的）比正向用例重要。** 正向用例只证明「合规的包能过」，
 * 反向用例证明「不合规的包会被拦下来」——而后者才是判据存在的理由。
 * 本仓库反复复发的那个病就是判据写了但拦不住东西（函数在、判据在、调用方不在）。
 *
 * 另外专门测一条「空当全绿」：空包必须能被看出是空的，
 * 不能让「0 违规」同时是「合规」和「什么都没录」的答案。
 */
import { checkConstraints } from '../../compiler/constraints.mjs'
import {
  PAPER_CONSTRAINTS, emptyPaperObjects,
  READ_LEVELS_ALL, SPLIT_DISCLOSURE_ALL, CLAIM_STATUS, MATURITY_ALL,
} from './dialect.mjs'

let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`) }
}

const run = (state) => checkConstraints(state, PAPER_CONSTRAINTS)
const hit = (state, id) => run(state).some((v) => v.id === id)
const ids = (state) => [...new Set(run(state).map((v) => v.id))].sort()

/** 一个处处合规的最小包：1 篇论文、1 条主张、1 个基准、台账对得上。 */
const good = () => ({
  'ledger:harness': { type: 'ledger', topic: 'harness', papers_declared: 1, claims_declared: 1 },
  'paper:p1': {
    type: 'paper', title: 'A', doi: '10.48550/arxiv.0000.00001',
    index_source: 'openalex', read_level: 'abstract', maturity: 'preprint',
  },
  'claim:p1-1': {
    type: 'claim', paper: 'paper:p1', statement: 'X 提升 1 点',
    bench: 'bench:b1', budget_reported: true, split_disclosed: 'disjoint', status: 'candidate',
  },
  'bench:b1': { type: 'bench', name: 'B', public: true },
})

console.log('\npaper 方言自检\n')

console.log('正向：合规包不应有违规')
{
  const v = run(good())
  ok('合规包 0 违规', v.length === 0, JSON.stringify(v.map((x) => x.id)))
}

console.log('\n反向：每条判据都必须真的会变红')
{
  // 只见搜索摘要 —— 本方言最便宜也最值钱的一格
  const s = good(); s['paper:p1'].read_level = 'search_snippet'
  ok('✗ read_level=search_snippet 被拦', hit(s, 'paper-read-level'))
}
{
  const s = good(); delete s['paper:p1'].read_level
  ok('✗ 不声明读到什么程度被拦', hit(s, 'paper-read-level-req'))
}
{
  // 我们自己转述的元数据不算外部核验
  const s = good(); s['paper:p1'].index_source = 'websearch'
  ok('✗ index_source=websearch 被拦', hit(s, 'paper-index-source'))
}
{
  // 占坑稿：作者自己说正文还没写，主张不该和论文的主张一起计数。
  // 这三条是**跑真数据跑出来的**——录进三条 Zenodo 自存件才发现方言分不开它们。
  const s = good(); s['paper:p1'].maturity = 'outline'
  ok('✗ 占坑稿被拦', hit(s, 'paper-maturity'))
}
{
  const s = good(); s['paper:p1'].maturity = 'release'
  ok('✗ 软件发布物被拦', hit(s, 'paper-maturity'))
}
{
  const s = good(); delete s['paper:p1'].maturity
  ok('✗ 不声明成熟度被拦', hit(s, 'paper-maturity-req'))
}
{
  const s = good(); s['paper:p2'] = { ...s['paper:p1'], title: 'A 的副本' }
  s['ledger:harness'].papers_declared = 2
  ok('✗ DOI 重复被拦', hit(s, 'paper-doi-unique'))
}
{
  // 承重判据：作者自称抬不成 verified
  const s = good(); s['claim:p1-1'].status = 'verified'
  ok('✗ 手写 status=verified 被拦', hit(s, 'claim-no-self-cert'))
}
{
  const s = good(); s['claim:p1-1'].status = 'ground-truth'
  ok('✗ 状态取值越界被拦', hit(s, 'claim-status-domain'))
}
{
  // arXiv:2607.12227 那条判据
  const s = good(); s['claim:p1-1'].budget_reported = false
  ok('✗ 报增益不报预算被拦', hit(s, 'claim-budget'))
}
{
  const s = good(); delete s['claim:p1-1'].budget_reported
  ok('✗ 预算字段缺失也被拦（不是「没写就不判」）', hit(s, 'claim-budget'))
}
{
  const s = good(); s['claim:p1-1'].split_disclosed = 'undisclosed'
  ok('✗ 搜索集/评测集关系未交代被拦', hit(s, 'claim-split'))
}
{
  const s = good(); delete s['claim:p1-1'].bench
  ok('✗ 主张不指明基准被拦', hit(s, 'claim-bench'))
}
{
  // 原作者又跑了一遍不叫复现
  const s = good()
  s['repl:r1'] = { type: 'repl', claim: 'claim:p1-1', source: 'https://x', independent: false }
  ok('✗ 非独立复现被拦', hit(s, 'repl-independent'))
}
{
  const s = good()
  s['repl:r1'] = { type: 'repl', claim: 'claim:p1-1', independent: true }
  ok('✗ 复现不给出处被拦', hit(s, 'repl-source'))
}
{
  // 统计者谎报
  const s = good(); s['ledger:harness'].papers_declared = 9
  ok('✗ 台账论文数对不上被拦', hit(s, 'ledger-papers'))
}
{
  const s = good(); s['ledger:harness'].claims_declared = 9
  ok('✗ 台账主张数对不上被拦', hit(s, 'ledger-claims'))
}
{
  const s = good(); s['critique:c1'] = { type: 'critique', from: 'paper:p1', to: 'paper:p2', status: '搁置' }
  ok('✗ 批评状态越界被拦', hit(s, 'critique-status'))
}
{
  const s = good(); s['critique:c1'] = { type: 'critique', from: 'paper:p1', status: 'open' }
  ok('✗ 批评不写被批评方被拦', hit(s, 'critique-target'))
}

console.log('\n结构：判据集本身的性质')
{
  // 每条约束都必须有 machine_check —— 没有的会被引擎报 unenforceable，
  // 那是「有约束的假象掩盖没校验的事实」，本仓库点名过的病
  const noCheck = PAPER_CONSTRAINTS.filter((c) => !c.check)
  ok('所有约束都可机器判定（无 unenforceable）', noCheck.length === 0,
    noCheck.map((c) => c.id).join(', '))
}
{
  const dup = PAPER_CONSTRAINTS.map((c) => c.id).filter((v, i, a) => a.indexOf(v) !== i)
  ok('约束 id 不重复', dup.length === 0, dup.join(', '))
}
{
  // 判据集必须覆盖到每个对象类型，否则某类对象等于没人管
  const covered = new Set(PAPER_CONSTRAINTS.map((c) => (c.check?.object || '').split(':')[0]))
  const missing = ['paper', 'claim', 'repl', 'bench', 'critique'].filter((t) => !covered.has(t))
  ok('五类对象都至少被一条判据钉着', missing.length === 0, '没人管：' + missing.join(', '))
}
{
  // 非法取值必须真的被排除在合法集之外，而不是只写在注释里
  ok('search_snippet 不在合法 read_level 内',
    READ_LEVELS_ALL.includes('search_snippet') &&
    !PAPER_CONSTRAINTS.find((c) => c.id === 'paper-read-level').check.values.includes('search_snippet'))
  ok('undisclosed 不在合法 split 内',
    SPLIT_DISCLOSURE_ALL.includes('undisclosed') &&
    !PAPER_CONSTRAINTS.find((c) => c.id === 'claim-split').check.values.includes('undisclosed'))
  ok('outline/release 在全集内但不在合法集内',
    MATURITY_ALL.includes('outline') && MATURITY_ALL.includes('release') &&
    !PAPER_CONSTRAINTS.find((c) => c.id === 'paper-maturity').check.values.includes('outline'))
  ok('verified 是合法状态但拿不到（只能由 repl 给）',
    CLAIM_STATUS.includes('verified') &&
    PAPER_CONSTRAINTS.find((c) => c.id === 'claim-no-self-cert').check.value === 'candidate')
}

console.log('\n空当全绿：0 违规不等于「已核验」')
{
  const empty = emptyPaperObjects('harness')
  const v = run(empty)
  ok('空包也是 0 违规（这是事实，不是合规）', v.length === 0)
  // 所以调用方必须自己报对象数——判据管不了「什么都没录」
  ok('空包的台账明确自报 0 篇 0 条',
    empty['ledger:harness'].papers_declared === 0 && empty['ledger:harness'].claims_declared === 0)
  console.log('    ↑ 判据集在空包上必然全绿。**报告里必须同时打印录入条数**，')
  console.log('      否则「0 违规」会被读成「都核过了」，那就是恒绿考题。')
}

console.log(`\n判决 ${pass}/${pass + fail}`)
process.exit(fail ? 1 : 0)
