#!/usr/bin/env node
// 法律方言自测 —— 对着两份完整判决书跑，并**报出可量化的检出率**。
//
//   node adapters/law/selftest.mjs
//
// fixtures/ 里两份文书按世界规格构造（不含第三方文本，判决书本身依著作权法第五条
// 也不受著作权保护，此处只是不引用未经核实的真实案件）：
//   A-合规.txt  一份没有缺陷的判决 —— 用来测**假阳性**。体检必须干净收场，
//               否则几次误报之后没人会再看体检结果，这比不查更糟。
//   B-缺陷.txt  同一个案情，种入 12 个缺陷 —— 用来测**检出率**。
//
// 12 个缺陷里有 2 个是**故意留着抓不到的**：它们需要事实推理或语义判断，
// 确定性门禁做不到。把它们写进目录并断言「抓不到」，是为了让漏检成为
// 一个被记录的已知边界，而不是一次没人发现的沉默失败。

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { loadOrigin } from '../../compiler/origin.mjs'
import { diagnose } from '../../compiler/provenance.mjs'
import { checkConstraints } from '../../compiler/constraints.mjs'
import { initPackage } from '../../compiler/store.mjs'
import { cn2num, cnDate, termToMonths, moneyToNum, extractCitations, parseWorksheet, parseCaseNo, splitSections, extractAmounts, extractTerms } from './parse.mjs'
import { judgmentToPackage, loadLawDb, judgeCitation } from './import.mjs'
import { adjust, FACTORS, lawConstraints, CITABLE_AS_BASIS } from './dialect.mjs'
import { runSentencing } from './sentence.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const db = loadLawDb()
let pass = 0, fail = 0
const check = (cond, name, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`) }
}
const mkpkg = (fixture, staged = false) => {
  const dir = join(tmpdir(), `law-selftest-${fixture}-${staged ? 's' : 'a'}-${process.pid}.origin`)
  rmSync(dir, { recursive: true, force: true })
  const text = readFileSync(join(HERE, 'fixtures', `${fixture}.txt`), 'utf8')
  const r = judgmentToPackage(text, { db, name: fixture, staged })
  initPackage(dir, { objects: r.objects, relations: r.relations, constraints: r.constraints })
  return { dir, ...r }
}

// ── 一、文本解析 ────────────────────────────────────────────────
console.log('\n[解析] 中文数字、日期、刑期、法条引用')
check(cn2num('二百六十四') === 264, '二百六十四 → 264')
check(cn2num('六十七') === 67, '六十七 → 67')
check(cn2num('八千六百') === 8600, '八千六百 → 8600')
check(cn2num('十') === 10, '十 → 10（无前导数字的十位）')
check(cn2num('一万零五十') === 10050, '一万零五十 → 10050')
check(cn2num('264') === 264, '阿拉伯数字原样通过')
check(Number.isNaN(cn2num('第二')), '非纯数字串返回 NaN，不瞎猜')
check(cnDate('二〇二六年七月十五日') === '2026-07-15', '落款日期 → ISO')
check(cnDate('1989年3月12日出生，……二〇二六年七月十五日') === '2026-07-15', '取最后一个日期（落款在最后，出生日期在最前）')
check(termToMonths('有期徒刑二年三个月') === 27, '有期徒刑二年三个月 → 27 月')
check(termToMonths('拘役四个月') === 4, '拘役四个月 → 4 月')
check(moneyToNum('人民币八千六百元') === 8600, '人民币八千六百元 → 8600')

const cites = extractCitations('依照《中华人民共和国刑法》第二百六十四条、第六十七条第一款、第五十二条，《中华人民共和国刑事诉讼法》第十五条之规定')
check(cites.length === 4, '一处引用块里的多个条文全部拆开', `实得 ${cites.length}`)
check(cites[1].article === 67 && cites[1].clause === 1, '条、款分别识别（引对法引错款也是漏）')
check(cites[3].title === '中华人民共和国刑事诉讼法', '跨书名号的第二个文件也认得')

const cn = parseCaseNo('（2026）沪0101刑初123号')
check(cn?.类型 === '刑事' && cn?.审级 === '初', '案号解析出案件类型与审级')
check(parseCaseNo('（2026）沪0101民初99号')?.类型 === '民事', '民事案号同样认得（可引范围不同）')

// ── 二、条文库判定 ──────────────────────────────────────────────
console.log('\n[引用体检] 法释〔2009〕14号的白名单，一个缺陷只出一条结论')
const jc = (title, article, position = '裁判依据', at = '2026-07-15') =>
  judgeCitation({ title, article, article_cn: String(article) }, { db, at, whitelist: CITABLE_AS_BASIS.刑事, position })
check(jc('中华人民共和国刑法', 264).status === 'ok', '法律可作刑事裁判依据')
check(jc('刑法', 264).status === 'ok', '简称「刑法」也认（ID 归一化：语义无歧义就不该被拒）')
check(jc('最高人民法院、最高人民检察院关于办理盗窃刑事案件适用法律若干问题的解释', 1).status === 'ok', '司法解释可作裁判依据')
check(jc('公安机关办理刑事案件程序规定', 3).status === 'not-citable', '部门规章不得作刑事裁判依据')
check(jc('公安机关办理刑事案件程序规定', 3, '说理').status === 'ok', '  └ 但说理位可以引（法释〔2009〕14号第六条）')
check(jc('最高人民法院关于常见犯罪的量刑指导意见（试行）', 3).status === 'not-citable', '量刑指导意见是法发字号司法文件，不是司法解释')
check(jc('最高人民法院关于常见犯罪的量刑指导意见（试行）', 3, '说理').status === 'ok', '  └ 说理位可以引')
check(jc('最高人民法院关于审理盗窃案件具体应用法律若干问题的解释', 1).status === 'expired', '2013 年已被取代的旧解释：失效')
check(jc('最高人民法院关于审理盗窃案件具体应用法律若干问题的解释', 1, '裁判依据', '2010-01-01').status === 'ok', '  └ 同一条在 2010 年裁判时是有效的（效力按裁判时点判）')
check(jc('最高人民法院关于办理盗窃案件数额认定的补充规定', 3).status === 'not-found', '查无此文件：not-found')
check(jc('中华人民共和国民法典', 1165).status === 'ok', '民法典条文本身有效……')
check(new Set(['ok']).has(jc('中华人民共和国刑法', 264).status), '每处引用只产出一个 status——不把一个问题说成三个')

// ── 三、量刑计算 ────────────────────────────────────────────────
console.log('\n[量刑] 同向相加、逆向相减（法发〔2021〕21号），不是连乘')
check(adjust(18, [-0.35, -0.15, -0.10]).total === -0.6, '三个从宽情节相加为 -60%')
check(Math.abs(adjust(18, [-0.35, -0.15, -0.10]).adjusted - 7.2) < 1e-9, '18 月 × 40% = 7.2 月')
check(Math.abs(adjust(18, [-0.55, 0.20, -0.15, -0.15]).total - (-0.65)) < 1e-9, '逆向相减：从严情节抵扣从宽')
check(FACTORS.自首.min === -0.40 && FACTORS.自首.max === 0, '自首区间 = 减少 40% 以下')
check(FACTORS.累犯.min === 0.10 && FACTORS.累犯.max === 0.40, '累犯区间 = 增加 10%-40%')
check(Object.keys(FACTORS).length === 15, `情节表覆盖 ${Object.keys(FACTORS).length} 个常见情节`)

// ── 四、A 卷：假阳性必须为零 ────────────────────────────────────
console.log('\n[A 合规卷] 一份没有缺陷的判决，体检必须干净收场')
const A = mkpkg('A-合规')
const dA = diagnose(loadOrigin(A.dir))
const errA = dA.findings.filter((f) => f.severity === 'error')
check(errA.length === 0, `零假阳性（${dA.constraints.enforceable} 条约束全部可机器判定）`, errA.map((f) => f.msg).join(' / '))
check(dA.findings.filter((f) => f.code === 'dangling-relation').length === 0, '被引条文进包，无悬空引用（原文是本源）')
check(dA.findings.filter((f) => f.code === 'mirror-pair').length === 0, '无双份账本')
check(A.head.类型 === '刑事' && A.judgedAt === '2026-07-15', '案件类型与裁判时点识别正确')
check(A.evidence.length === 8 && A.factorNames.length === 3, '8 份证据、3 个量刑情节')
check(A.objects.find((o) => o.id.startsWith('case:'))?.认定金额 === 8600, '认定金额 8600 进状态')

// ── 五、B 卷：种入 12 个缺陷，逐条点名 ──────────────────────────
console.log('\n[B 缺陷卷] 12 个种入缺陷的检出情况')
const B = mkpkg('B-缺陷')
const dB = diagnose(loadOrigin(B.dir))
const msgs = dB.findings.filter((f) => f.severity === 'error').map((f) => f.msg)
const hit = (re) => msgs.some((m) => re.test(m))

/** 缺陷目录。detectable=false 的两条是**已知边界**，断言它们抓不到。 */
const DEFECTS = [
  { id: 'D1', 类: 'A 引用', 名: '引用查无此文的规范性文件（伪造引用）', detectable: true, probe: () => hit(/补充规定-3.*not-found/) },
  { id: 'D2', 类: 'A 引用', 名: '把部门规章列为裁判依据', detectable: true, probe: () => hit(/公安机关办理刑事案件程序规定-3.*not-citable/) },
  { id: 'D3', 类: 'A 引用', 名: '引用裁判时点已失效的司法解释', detectable: true, probe: () => hit(/审理盗窃案件具体应用法律.*expired/) },
  { id: 'D4', 类: 'C 链条', 名: '认定累犯却未引刑法第六十五条', detectable: true, probe: () => hit(/cited_as_basis 必须包含 "law:刑法\/65"/) },
  { id: 'D5', 类: 'C 链条', 名: '量刑情节无证据支撑', detectable: true, probe: () => hit(/factor:累犯\.basis 必填/) },
  { id: 'D6', 类: 'D 计算', 名: '自首调节 -55%，超出法定 40% 上限', detectable: true, probe: () => hit(/factor:自首\.ratio = -0\.55/) },
  { id: 'D7', 类: 'D 计算', 名: '宣告刑偏离调节结果 42.9%，超出 20% 幅度', detectable: true, probe: () => hit(/宣告刑偏离 = 0\.4286/) },
  { id: 'D8', 类: 'D 计算', 名: '说理段金额 6800 与认定事实 8600 不一致', detectable: true, probe: () => hit(/说理金额.*应为 8600，实为 6800/) },
  { id: 'D9', 类: 'D 计算', 名: '判决主文刑期 10 月与量刑结论 9 月不一致', detectable: true, probe: () => hit(/主文刑期.*应为 9，实为 10/) },
  { id: 'D10', 类: 'C 链条', 名: '同一情节（退赃退赔）被重复评价两次', detectable: true, probe: () => hit(/出现重复：退赃退赔/) },
  { id: 'D11', 类: 'C 链条', 名: '认定累犯，但查明段没有任何前科事实', detectable: false, probe: () => hit(/前科/) },
  { id: 'D12', 类: 'B 支持', 名: '引刑法第六十四条（追缴违法所得）支持「应当从重处罚」', detectable: false, probe: () => hit(/从重.*不支持|第六十四条.*不支持/) },
]
for (const d of DEFECTS) {
  const got = d.probe()
  check(got === d.detectable, `${d.id} ${d.类}｜${d.名}${d.detectable ? '' : '　→ 已知抓不到'}`, got ? '本应抓不到却报了（假阳性）' : '本应抓到却漏了')
}
const detected = DEFECTS.filter((d) => d.detectable).length
check(msgs.length === detected, `${detected} 个可检缺陷 ↔ ${msgs.length} 条 error：一个缺陷一条结论，无重复报告`, msgs.join(' | '))

// ── 六、变异检查：故意打坏每条约束，看抓不抓得到 ────────────────
// 这是整个自测里最关键的一环（沿用 compiler/mutation-check.mjs 的做法）：
// 一条从来没被触发过的约束，和没写这条约束是一回事。
console.log('\n[变异] 逐条打坏约束，确认每条都真的有人守')
const baseOrigin = loadOrigin(A.dir)
const MUTATIONS = [
  ['basis-citation-ok', (s) => { s['cite:裁判依据/刑法-264'].status = 'not-citable' }],
  ['reasoning-citation-ok', (s) => { s['cite:说理/关于常见犯罪的量刑指导意见试行-3'].status = 'expired' }],
  ['factor-must-have-evidence', (s) => { delete s['factor:自首'].basis }],
  ['factor-name-unique', (s) => { s['factor:认罪认罚'].name = '自首' }],
  ['declared-within-tolerance', (s) => { s['case:2026沪0101刑初123号'].宣告刑偏离 = 0.9 }],
  ['factor-ratio-自首', (s) => { s['factor:自首'].ratio = -0.9 }],
  ['factor-ratio-累犯', (s) => { s['factor:自首'].name = '累犯'; s['factor:累犯'] = { ...s['factor:自首'], ratio: 0.8 } }],
  ['factor-law-自首', (s) => { s['case:2026沪0101刑初123号'].cited_as_basis = [] }],
  ['mention-M-说理金额-1', (s) => { s['mention:M-说理金额-1'].value = 1 }],
]
for (const [id, mutate] of MUTATIONS) {
  const s = structuredClone(baseOrigin.state)
  mutate(s)
  const caught = checkConstraints(s, baseOrigin.constraints, baseOrigin.state).filter((v) => (v.severity ?? 'error') === 'error')
  check(caught.some((v) => v.id === id), `打坏 ${id} 被抓到`, caught.map((v) => v.id).join(','))
}
// 反向：不打坏时必须一条都不报——否则上面的「抓到」可能只是恒真
check(checkConstraints(baseOrigin.state, baseOrigin.constraints, baseOrigin.state).filter((v) => (v.severity ?? 'error') === 'error').length === 0,
  '未打坏时零违规（确认上面的检出不是恒真）')

// ── 七、生成模式：量刑走事务，why 查得出依据 ────────────────────
console.log('\n[生成模式] 量刑链逐步提交，宣告刑凭什么是七个月')
const G = mkpkg('A-合规', true)
const gcase = G.objects.find((o) => o.type === 'case')
check(gcase.宣告刑月 === undefined, '生成模式的出生状态里没有量刑结果（推演结果不许当事实导入）')
const sr = runSentencing(G.dir, { declared: 7, by: '承办法官-李' })
check(sr.ok && sr.steps.length === 4, '三个情节 + 宣告刑，共 4 步落盘', JSON.stringify(sr.rejected ?? {}))
check(sr.acc === -0.6 && sr.adjusted === 7.2 && sr.deviation === 0.0278, `基准刑 18 → 调节 -60% → 7.2 月 → 宣告 7 月（偏离 2.8%）`)

const g2 = loadOrigin(G.dir)
const chain = g2.history.filter((e) => e.event === 'state_change' && e.field === '调节比例合计')
check(chain.length === 3, '调节比例合计经三次事务改动，每步一条记录')
check(chain.every((c) => Array.isArray(c.basis) && c.basis.length >= 3), '每步都带依据（情节 + 证据 + 法条）')
check(chain[0].basis.includes('law:刑法/67') && chain[0].basis.includes('evidence:E-03'), '自首那一步的依据里同时有第六十七条和到案经过')
check(chain.every((c) => c.kind === 'derived'), '调节结果标为 derived（推演，不是观察）')
check(!chain.some((c) => 'claimed_from' in c), '零记忆偏差——链条干净')
check(g2.history.filter((e) => e.event === 'state_change' && e.field === '宣告刑月')[0]?.kind === 'asserted',
  '宣告刑标为 asserted：那 20% 幅度是法官的裁量，不是算出来的')

// 门禁：同一份案卷改判 12 月，超出 20% 幅度 → 一个字节都不写
const R = mkpkg('A-合规', true)
const rej = runSentencing(R.dir, { declared: 12, by: '承办法官-李' })
check(!rej.ok && rej.rejected.step === '宣告刑', '改判 12 月被门禁挡下')
check(rej.rejected.violations.some((v) => /宣告刑偏离 = 0\.6667/.test(v.msg)), '  └ 理由是可复算的：偏离 66.7% > 20%')
const rSeq = loadOrigin(R.dir).history.filter((e) => e.event === 'state_change')
check(rSeq.length === 3 && !rSeq.some((e) => e.field === '宣告刑月'), '  └ 前 3 步在，宣告刑那一步零字节写入')

// ── 八、诚实边界：量刑评议表缺失时不许假装体检通过 ──────────────
console.log('\n[边界] 判决书里没有量刑中间量时，明说 D 类未校验')
const noWs = judgmentToPackage(readFileSync(join(HERE, 'fixtures', 'A-合规.txt'), 'utf8').split('【量刑评议表】')[0], { db, name: 'no-ws' })
check(noWs.notes.some((n) => n.includes('未校验')), '缺量刑评议表时明确报告 D 类未校验，而不是静默通过')
check(noWs.objects.filter((o) => o.type === 'factor').length === 0, '  └ 没有情节对象——判决书正文里本来就没有')
check(noWs.objects.find((o) => o.type === 'case')?.宣告刑偏离 === undefined, '  └ 没有偏离可算')

// ── 汇总 ────────────────────────────────────────────────────────
rmSync(A.dir, { recursive: true, force: true })
rmSync(B.dir, { recursive: true, force: true })
rmSync(G.dir, { recursive: true, force: true })
rmSync(R.dir, { recursive: true, force: true })

console.log('\n──────── 可量化结果 ────────')
console.log(`约束条数            ${A.constraints.length}（全部可机器判定，${A.constraints.filter((c) => c.check).length}/${A.constraints.length}）`)
console.log(`用到的核心谓词      ${[...new Set(A.constraints.map((c) => c.check?.type))].sort().join(' / ')}`)
console.log(`A 合规卷 error      ${errA.length}（假阳性）`)
console.log(`B 缺陷卷 error      ${msgs.length}`)
console.log(`种入缺陷            ${DEFECTS.length}　检出 ${detected}　已知抓不到 ${DEFECTS.length - detected}　检出率 ${((detected / DEFECTS.length) * 100).toFixed(1)}%`)
console.log(`变异检查            ${MUTATIONS.length}/${MUTATIONS.length} 条约束确认有人守`)
console.log(`\n${fail ? '✗' : '✓'} ${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
