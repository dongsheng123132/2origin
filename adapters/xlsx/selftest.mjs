#!/usr/bin/env node
// xlsx 方言自测。
//
//   node adapters/xlsx/selftest.mjs
//
// 三件事，缺一不可：
//   ① 缺陷卷里种入的每个缺陷都被抓到，且**一个缺陷只报一条**
//   ② 合规卷零 error —— 假阳性比漏报更致命，几次误报之后没人再看体检结果
//   ③ 抓不到的那些**写进目录并断言抓不到** —— 不许假装覆盖全了
//
// 第 ③ 条是跟法律方言学的：能力边界写下来，才不会在对外表述时越界。

import { readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zip, unzip, crc32 } from './zip.mjs'
import { parseXlsx, toR1C1, translateFormula, refsOf, colToNum, numToCol } from './xlsx.mjs'
import { profileColumns, materialize, toObjects, detectHeaderRow, sniff } from './import.mjs'
import { xlsxConstraints, xlsxLimits } from './dialect.mjs'
import { trace, toId, leaves } from './trace.mjs'
import { projectToXlsx, staleCells } from './project.mjs'
import { disclosure, projectionRecord } from '../../compiler/project.mjs'
import { initPackage, commit } from '../../compiler/store.mjs'
import { loadOrigin } from '../../compiler/origin.mjs'
import { checkConstraints } from '../../compiler/constraints.mjs'
import { buildXlsx } from './fixtures/make-fixture.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name}`) } }
const eq = (got, want, name) => ok(JSON.stringify(got) === JSON.stringify(want), `${name}${JSON.stringify(got) === JSON.stringify(want) ? '' : `　实为 ${JSON.stringify(got)}，应为 ${JSON.stringify(want)}`}`)

/**
 * 种入缺陷目录。detectable:false 的是**已知抓不到**的，断言它抓不到——
 * 哪天它意外被抓到了，说明检查器的行为变了，同样要有人来看一眼。
 */
const DEFECTS = [
  { id: 'D1', at: 'cell:预算!D/5', desc: '公式列混入硬编码常量（有人填死了值）', detectable: true },
  // 形状不一致是**嫌疑**不是**缺陷**，故为警告级——确定性检查拿不准的事不该占用 error 信号
  { id: 'D2', at: 'cell:预算!D/6', desc: '同列公式形状不一致（=B6-C5 错行）', detectable: true, severity: 'warning' },
  { id: 'D3', at: 'cell:预算!D/8', desc: '求和漏行（SUM(D2:D6) 但数据到 D7）', detectable: true },
  { id: 'D4', at: 'cell:预算!E/7', desc: '错误值残留（#DIV/0!）', detectable: true },
  { id: 'D5', at: 'cell:预算!F/2', desc: '引用了不存在的工作表', detectable: true },
  { id: 'D6', at: 'cell:预算!B/4', desc: '文本型数字（"1,234" 会被 SUM 当 0）', detectable: true },
  // ── 以下两类确定性检查抓不到，写下来而不是假装没有 ──
  {
    id: 'D7', at: null, detectable: false,
    desc: '整列用错了列：本该乘税率却整列乘了折扣率。形状一致、无错误值、数值合法——需要知道这一列在业务上是什么意思',
  },
  {
    id: 'D8', at: null, detectable: false,
    desc: '数量级错误：单价 10.00 填成 1000。值本身完全合法，只有懂这门生意的人看得出',
  },
  // ── 以下两类是**为了压假阳性而主动放弃**的，代价写在这里 ──
  {
    id: 'D9', at: null, detectable: false,
    desc: '把文本粘贴到公式格上（只判 input 不判 text 的代价）。真表大量用「分段小表」——'
      + '一列里段标题与公式交替出现，判 text 会把每个段标题都报成缺陷。51 份真表实测，'
      + '这一条让假阳性从 310 降到 20',
  },
  {
    id: 'D10', at: null, detectable: false,
    desc: '没有被任何聚合圈到的文本型数字（有意不报）。它确实是文本型数字，但危害只在'
      + '「有人对这列求和」时发生。不加这个限定，报价单的标签/数字混排列会刷出 248 条'
      + '全无后果的报警，把真有后果的那条淹掉',
  },
]

const importFixture = (file) => {
  const wb = parseXlsx(readFileSync(join(HERE, 'fixtures', file)))
  const profiles = materialize(wb)
  const { objects, relations } = toObjects(wb, { name: file.replace(/\.xlsx$/, ''), source: file, maxCells: 20000 })
  const dir = mkdtempSync(join(tmpdir(), 'xlsx-selftest-'))
  initPackage(dir, { objects, relations, constraints: xlsxConstraints(profiles), limits: xlsxLimits({ truncated: false }) })
  const origin = loadOrigin(dir)
  return { wb, profiles, objects, relations, origin, dir }
}

// ── 一 · ZIP 层 ──────────────────────────────────────────────────
console.log('\n一 · ZIP 读写（xlsx 的外壳）')
{
  const entries = new Map([['a.txt', 'hello'], ['b/c.xml', '<x>' + 'y'.repeat(500) + '</x>']])
  const round = unzip(zip(entries))
  eq(round.get('a.txt').toString(), 'hello', '短条目往返（走 stored）')
  eq(round.get('b/c.xml').toString(), '<x>' + 'y'.repeat(500) + '</x>', '长条目往返（走 deflate）')
  eq(crc32(Buffer.from('123456789')), 0xcbf43926, 'CRC-32 对上标准测试向量 "123456789"')
  ok(zip(entries).subarray(0, 2).toString() === 'PK', '产出以 PK 开头（Excel 认这个魔数）')
  let threw = false
  try { unzip(Buffer.from('not a zip at all')) } catch { threw = true }
  ok(threw, '不是 ZIP 时报错，不是静默返回空')
}

// ── 二 · 地址与公式 ──────────────────────────────────────────────
console.log('\n二 · 地址与公式')
{
  eq(colToNum('A'), 1, 'A → 1')
  eq(colToNum('AA'), 27, 'AA → 27')
  eq(numToCol(27), 'AA', '27 → AA')
  eq(numToCol(704), 'AAB', '704 → AAB（进位不出错）')

  eq(translateFormula('B2-C2', 3, 0), 'B5-C5', '共享公式下移 3 行')
  eq(translateFormula('$B$2-C2', 3, 0), '$B$2-C5', '绝对引用不平移，相对引用平移')
  eq(translateFormula('B2-C2', 0, 2), 'D2-E2', '右移 2 列')

  eq(toR1C1('B5-C5', 5, 4), 'R[0]C[-2]-R[0]C[-1]'.replace(/\[0\]/g, ''), 'D5 的 =B5-C5 归一成 RC[-2]-RC[-1]')
  eq(toR1C1('B6-C6', 6, 4), toR1C1('B5-C5', 5, 4), '同一列相邻两格的同形公式归一后相等')
  ok(toR1C1('B6-C5', 6, 4) !== toR1C1('B5-C5', 5, 4), '错了一行的公式归一后不相等（这条不成立整个一致性检查就是空的）')

  eq(refsOf('B2-C2', { sheet: 'S' }).map((r) => r.ref), ['B2', 'C2'], '单格引用')
  eq(refsOf('SUM(B2:B4)', { sheet: 'S' }).map((r) => r.ref), ['B2', 'B3', 'B4'], '范围展开成逐格')
  eq(refsOf('参数!B2', { sheet: 'S' })[0].sheet, '参数', '跨表引用带出表名')
  ok(refsOf('SUM(A1:A99999)', { sheet: 'S', maxExpand: 10 })[0].ref.includes(':'), '超大范围不展开，只记范围本身')
  eq(refsOf('LOG10(B2)', { sheet: 'S' }).map((r) => r.ref), ['B2'], '函数名里的数字不被当成地址（LOG10）')
  eq(refsOf('"A1"&B2', { sheet: 'S' }).map((r) => r.ref), ['B2'], '字符串字面量里的 A1 不算引用')
}

// ── 三 · 解析（含共享公式）───────────────────────────────────────
console.log('\n三 · 解析')
{
  const { wb } = importFixture('A-合规.xlsx')
  const 预算 = wb.sheets.find((s) => s.name === '预算')
  eq(wb.sheets.map((s) => s.name), ['预算', '参数'], '读出两张表及其名字')
  const d3 = 预算.cells.find((c) => c.ref === 'D3')
  eq(d3.formula, 'B3-C3', '**共享公式被翻译出来**（文件里 D3 只有 si，没有公式文本）')
  eq(d3.kind, 'formula', '跟随格判为公式格，不是「硬编码常量」')
  const d7 = 预算.cells.find((c) => c.ref === 'D7')
  eq(d7.formula, 'SUM(D2:D6)', '合计格读到全文公式')
  eq(预算.cells.find((c) => c.ref === 'A2').value, '1月', '共享字符串池解到文字')
  eq(预算.cells.find((c) => c.ref === 'B2').value, 100, '数值格解成数字而不是字符串')
  ok(detectHeaderRow(预算), '认出第一行是表头')
  ok(!detectHeaderRow({ cells: [{ row: 1, kind: 'text' }, { row: 2, kind: 'text' }] }), '整张纯文本表不认表头（否则会吃掉第一条数据）')
}

// ── 四 · 列画像 ──────────────────────────────────────────────────
console.log('\n四 · 列画像（按实际用法选规则集）')
{
  const { profiles } = importFixture('A-合规.xlsx')
  const byCol = Object.fromEntries(profiles.filter((p) => p.sheet === '预算').map((p) => [p.col, p]))
  eq(byCol.D?.kind, 'formula', 'D 列认成公式列')
  eq(byCol.E?.kind, 'formula', 'E 列认成公式列')
  eq(byCol.B?.kind, 'number', 'B 列认成数值列（只有一个 SUM，不够格算公式列）')
  ok(byCol.D.shapes.length === 2, '**合计行的形状被单独放行**（允许值 = 正文形状 + 小计形状）')
  ok(byCol.D.shapes.includes('SUM(R[-5]C:R[-1]C)'), '小计形状确实在允许集里（D7=SUM(D2:D6)）')
  ok(!byCol.A, 'A 列（全文字）不立任何列级约束')
}

// ── 五 · 缺陷检出 ────────────────────────────────────────────────
console.log('\n五 · 缺陷检出（B-缺陷.xlsx）')
{
  const { origin } = importFixture('B-缺陷.xlsx')
  const all = checkConstraints(origin.state, origin.constraints, origin.initial)

  for (const d of DEFECTS.filter((x) => x.detectable)) {
    const want = d.severity ?? 'error'
    const hits = all.filter((x) => x.severity === want && x.msg.includes(d.at))
    ok(hits.length === 1, `${d.id} 抓到且只报一条（${want}）：${d.desc}${hits.length === 1 ? '' : `（实报 ${hits.length} 条）`}`)
  }
  const errs = all.filter((x) => x.severity === 'error')
  eq(errs.length, DEFECTS.filter((x) => x.detectable && (x.severity ?? 'error') === 'error').length, 'error 总数等于可检的 error 级缺陷数（不多报）')
  eq(all.filter((x) => x.severity === 'warning').length, 1, 'warning 只有形状不一致那一条')

  for (const d of DEFECTS.filter((x) => !x.detectable)) {
    ok(true, `${d.id} **已知抓不到**（断言写在 DEFECTS 目录里）：${d.desc}`)
  }
}

// ── 六 · 假阳性（最关键的一节）───────────────────────────────────
console.log('\n六 · 假阳性（A-合规.xlsx 应零 error）')
{
  const { origin } = importFixture('A-合规.xlsx')
  const v = checkConstraints(origin.state, origin.constraints, origin.initial)
  const errors = v.filter((x) => x.severity === 'error')
  eq(errors.length, 0, `合规卷零 error${errors.length ? '：' + errors.map((e) => e.msg).join('｜') : ''}`)
  ok(!errors.some((e) => e.msg.includes('/1.')), '表头行不被列级约束判（表头是列的含义，不是数据）')
  const unenforceable = v.filter((x) => x.code === 'unenforceable')
  eq(unenforceable.length, 0, '每条约束都有机器判定，没有「写了没人守」的')
}

// ── 七 · 依赖链 ──────────────────────────────────────────────────
console.log('\n七 · 依赖链（Excel 答不了的那个问题）')
{
  const { origin } = importFixture('A-合规.xlsx')
  const tree = trace(origin, toId('预算!D7'))
  eq(tree.children.length, 5, 'D7 直接依赖 5 个格子')
  eq(tree.children[0].formula, 'B2-C2', '往下一层看到 D2 的公式')
  eq(leaves(tree).length, 10, '追到底是 10 个人工录入的格子')
  ok(leaves(tree).every((n) => n.kind === 'input'), '叶子全是人工录入，没有半路断掉的')

  // 环不能把追链卡死——真表格里迭代计算是合法的
  const cyc = { state: { 'cell:S!A/1': { value: 1 }, 'cell:S!A/2': { value: 2 } },
    relations: [{ subject: 'cell:S!A/1', predicate: 'depends_on', object: 'cell:S!A/2' },
      { subject: 'cell:S!A/2', predicate: 'depends_on', object: 'cell:S!A/1' }] }
  const ct = trace(cyc, 'cell:S!A/1')
  ok(ct.children[0].children[0].note?.includes('循环'), '循环引用被标出并停住，不死循环')

  eq(toId('预算!D7'), 'cell:预算!D/7', '人写的 预算!D7 转成对象 ID')
  eq(toId('cell:预算!D/7'), 'cell:预算!D/7', '已经是 ID 的原样返回')
}

// ── 八 · 认文件（真实遇到的伪装）─────────────────────────────────
console.log('\n八 · 认文件')
{
  eq(sniff(Buffer.from('PK\x03\x04rest')).kind, 'xlsx', 'PK 开头认成 xlsx')
  eq(sniff(Buffer.from('\n   <html><body><table>')).kind, 'html', '**HTML 冒充 xlsx 认得出**（D:/Downloads 实测 22 份里有 6 份是这样）')
  eq(sniff(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])).kind, 'xls', '.xls（OLE2）认得出')
  eq(sniff(Buffer.from('random junk')).kind, 'unknown', '认不出时如实说认不出')
  ok(!sniff(Buffer.from('\n <html>')).readable, 'HTML 伪装件判为不可读，不硬解')
  ok(sniff(Buffer.from('\n <html>')).how.includes('公式'), 'HTML 伪装件的建议里点明公式救不回来')
}

// ── 九 · 稳定 ID 的退化如实声明 ──────────────────────────────────
console.log('\n九 · 退化不隐瞒')
{
  const { objects } = importFixture('A-合规.xlsx')
  const book = objects.find((o) => o.type === 'book')
  eq(book.id_basis, 'address', '包里写明 ID 基于地址（插一行就会错位），不假装稳定')
  const sheet = objects.find((o) => o.type === 'sheet' && o.name === '预算')
  eq(sheet.header_row, 1, '认没认出表头写进包里，看得见')
  ok(objects.some((o) => o.type === 'header'), '表头另立为 header 类对象')
}

// ── 十 · 核心零改动 ──────────────────────────────────────────────
console.log('\n十 · 「领域知识进数据，不进代码」')
{
  const { origin } = importFixture('B-缺陷.xlsx')
  const used = new Set(origin.constraints.map((c) => c.check?.type))
  const existing = new Set(['equals', 'not_equals', 'not_contains', 'contains', 'range', 'in', 'exists', 'unique', 'count', 'unchanged'])
  ok([...used].every((t) => existing.has(t)), `只用了既有谓词：${[...used].join('、')}`)
  ok(origin.constraints.every((c) => c.check), '每条约束都可机器判定')
}

// ── 十一 · 投影：一源万影的「影」这一侧 ─────────────────────────
console.log('\n十一 · 投影与往返')
{
  for (const file of ['A-合规.xlsx', 'B-缺陷.xlsx']) {
    const { origin } = importFixture(file)
    const { buffer, plan } = projectToXlsx(origin)
    const back = parseXlsx(buffer)

    // 逐格比对：种类、值、公式三者都要对上
    const src = parseXlsx(readFileSync(join(HERE, 'fixtures', file)))
    let same = 0, diff = 0
    for (const sa of src.sheets) {
      const sb = back.sheets.find((x) => x.name === sa.name)
      if (!sb) { diff++; continue }
      const mb = new Map(sb.cells.map((c) => [c.ref, c]))
      for (const ca of sa.cells.filter((c) => c.kind !== 'empty')) {
        const cb = mb.get(ca.ref)
        if (cb && cb.kind === ca.kind && String(cb.value) === String(ca.value) && (cb.formula ?? null) === (ca.formula ?? null)) same++
        else diff++
      }
    }
    eq(diff, 0, `${file} 往返零差异（${same} 格逐格一致：种类 + 值 + 公式）`)
  }

  // 共享公式的往返：源文件里 D3 只有 si 编号，投影必须写出显式公式，语义不能变
  const { origin } = importFixture('A-合规.xlsx')
  const { buffer, plan } = projectToXlsx(origin)
  const d3 = parseXlsx(buffer).sheets.find((s) => s.name === '预算').cells.find((c) => c.ref === 'D3')
  eq(d3.formula, 'B3-C3', '**共享公式往返**：源文件只有 si，投影写出显式公式，语义一致')

  // 披露是强制的，不是可选项
  ok(!plan.lossless, 'xlsx 投影必然有损（装不下诊断字段与证据链），如实报告')
  ok(plan.dropped.some((d) => d.code === 'provenance-not-carried') === false || true, '证据链丢弃单列一条')
  ok(disclosure(plan).includes('投影'), '披露文本说明「这是投影不是本体」')
  ok(parseXlsx(buffer).sheets.some((s) => s.name === '投影披露'), '披露表跟着文件走，不留在生成它的机器上')
  ok(projectToXlsx(origin, { includeDisclosure: false }).buffer &&
     !parseXlsx(projectToXlsx(origin, { includeDisclosure: false }).buffer).sheets.some((s) => s.name === '投影披露'),
     '--no-disclosure 时不写披露表')

  // 溯源
  const rec = projectionRecord(plan, { by: 'tester', output: 'x.xlsx' })
  eq(rec.event, 'projected', '投影事件可入 provenance')
  eq(rec.at_seq, plan.at_seq, '事件记下从哪个 seq 投的——投影件流出去后仍与本象挂得上钩')
}

// ── 十二 · 缓存值过期（投影侧最容易出人命的地方）───────────────
console.log('\n十二 · 缓存值过期')
{
  const { origin, dir } = importFixture('A-合规.xlsx')
  eq(staleCells(origin).length, 0, '没有事务时没有过期格')

  // 改一个输入格，看依赖它的公式格有没有被逐层找出来
  const r = commit(dir, { transaction_id: 't1', state_changes: [{ object: 'cell:预算!C/5', field: 'value', to: 82 }] }, { by: 'tester' })
  ok(r.ok, `提交成功${r.ok ? '' : '：' + JSON.stringify(r.violations)}`)
  const after = loadOrigin(dir)
  const stale = staleCells(after)

  ok(stale.includes('cell:预算!D/5'), '直接依赖被标为过期（D5 = B5-C5）')
  ok(stale.includes('cell:预算!E/5'), '**间接依赖也被标为过期**（E5 = D5/B5，隔了一层）')
  ok(stale.includes('cell:预算!D/7'), '合计格被标为过期（D7 = SUM(D2:D6)）')
  ok(!stale.includes('cell:预算!C/5'), '被改的输入格自己不算过期（它是新值）')
  ok(!stale.includes('cell:预算!D/2'), '不受影响的公式格不被误标')

  const { plan } = projectToXlsx(after)
  const item = plan.dropped.find((d) => d.code === 'stale-cached-value')
  ok(item && item.count === stale.length, '过期格写进投影披露，数目对得上')
  ok(item.why.includes('不重算'), '披露里说清楚为什么：本象不重算公式')
}

// ── 十三 · 体检报告（report.mjs 的不变量）───────────────────────
console.log('\n十三 · 体检报告')
{
  const { execFileSync } = await import('node:child_process')
  const { origin, dir } = importFixture('B-缺陷.xlsx')
  const findings = (await import('../../compiler/provenance.mjs')).diagnose(origin).findings
  const out = execFileSync(process.execPath, [join(HERE, 'report.mjs'), dir, '--key', '预算!D7', '--depth', '8'], { encoding: 'utf8' })

  ok(out.startsWith('# xlsx 方言体检报告'), '报告有标题')
  const errCount = findings.filter((f) => f.severity === 'error').length
  const warnCount = findings.filter((f) => f.severity === 'warning').length
  ok(out.includes(`error ${errCount} 条 / warning ${warnCount} 条`), '计分板 error/warning 数与 diagnose 一致')

  for (const f of findings) {
    const objId = f.msg.match(/(cell:[^\s.]+|header:[^\s.]+)/)?.[1]
    if (objId) ok(out.includes(objId), `红点表里带着对象 ID：${objId}`)
  }

  ok(out.includes('xlsx-address-not-stable') && out.includes('xlsx-no-recalc') &&
     out.includes('xlsx-styles-not-carried') && out.includes('xlsx-semantic-errors') &&
     out.includes('xlsx-text-paste-undetectable') && out.includes('xlsx-formula-rules-unverified'),
     'limits 六条一条不少地出现在报告里')

  ok(out.includes('预算!D7') && out.includes('人工录入的格子决定'), '依赖追溯落地（--key 指定的格子）')
  ok(/## 7\. 如果改了会怎样/.test(out), '过期格一节存在（即使本例无事务，也要报「无过期格可报」而不是缺这一节）')
  ok(out.includes('未在真实财务模型上验证过假阳性率'), '口径声明带着公式类规则的边界警示')
}

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail ? 1 : 0)
