#!/usr/bin/env node
// xlsx → 本象包。
//
//   node adapters/xlsx/import.mjs <表.xlsx> <包路径> [--name 预算表] [--max-cells 20000]
//
// 导入即这个世界的诞生：每一格写进 graph/objects.jsonl（出生证明），
// 公式依赖写进 graph/relations.jsonl，此后每次改动以事务追加——
// 于是「这个数凭什么是这个数」永远查得出，而 Excel 本身答不了这个问题。
//
// ## 电子表格比图纸难在哪
//
// CAD 图纸是**静态**的：一根梁画在那里就是那里。电子表格是**算出来**的：
// D5 的 50 不是谁填的，是 B5-A5 的结果，而 B5 又可能是别处算来的。
// 所以这里除了对象，还必须建依赖图——这正好是协议六要素里的 relations
// （谁引用/依赖谁），不需要给核心加任何东西。
//
// ## 稳定 ID 的现实问题（必须说清楚）
//
// 单元格地址 `D5` **不是稳定 ID**：在上面插一行，原来的 D5 就变成了 D6。
// 也就是说 xlsx 在「同一个东西改了值」和「东西还在原地但地址变了」之间
// 无法区分——这是格式本身的性质，不是导入器的缺陷。
// 后果：跨版本对比会把「插了一行」看成「从插入点往下每一格都变了」。
// 这个退化写进包里（book 的 id_basis=address），diagnose 看得见，不藏。

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { parseXlsx, toR1C1, numToCol, colToNum } from './xlsx.mjs'
import { initPackage, appendHistory } from '../../compiler/store.mjs'
import { xlsxConstraints, xlsxLimits, XLSX_MANIFEST } from './dialect.mjs'

/** 表名进 ID：去掉会破坏引用语法的字符，保留中文。与 CAD 方言的 slug 同规矩。 */
const slug = (s) => String(s ?? 'Sheet1').replace(/[\s:/*!]+/g, '_')

const AGGREGATES = /\b(SUM|AVERAGE|AVERAGEA|COUNT|COUNTA|MAX|MIN|PRODUCT|SUBTOTAL|MEDIAN)\s*\(/i
/** 看起来像数字的文本："1,234"、" 56.7 "、"-89"。这是导出件最典型的坑。 */
const LOOKS_NUMERIC = /^[\s]*[-+]?[\d,]+(\.\d+)?[\s]*$/

/**
 * 列画像：这一列到底是公式列、数值列，还是别的。
 *
 * **按列实际用法选规则集**，与 CAD 方言的 numbering 探测同理——
 * 对一列纯文本硬套「必须全是公式」会得到满屏假警报，比不查更糟。
 * 门槛定在 3：两格相同还可能是巧合，三格才算一个模式。
 */
export function profileColumns(sheet) {
  const byCol = new Map()
  for (const c of sheet.cells) {
    if (!byCol.has(c.colName)) byCol.set(c.colName, [])
    byCol.get(c.colName).push(c)
  }

  const out = []
  for (const [col, cells] of byCol) {
    // 表头行不参与画像：第一行几乎总是标题，算进去会把公式列的比例压下去
    const body = cells.filter((c) => c.row > 1)
    const nonEmpty = body.filter((c) => c.kind !== 'empty')
    if (nonEmpty.length < 3) continue

    const formulas = body.filter((c) => c.kind === 'formula')
    const numbers = body.filter((c) => c.kind === 'input')

    if (formulas.length >= 3 && formulas.length > nonEmpty.length / 2) {
      // **合计行必须单独放行。** `=SUM(D2:D5)` 与上面四格的 `=B6-C6` 形状天然不同，
      // 一视同仁地要求「同列公式形状一致」，会对着一张完全正常的表报错——
      // 这正是 CAD 方言吃过的亏（decision:rules-by-usage）：假警报比不查更糟。
      // 判据是结构性的，不靠猜：对本列上方做纵向聚合的格子，就是小计格。
      const isTotal = (c) => AGGREGATES.test(c.formula) &&
        [...c.formula.matchAll(/\$?([A-Z]{1,3})\$?\d{1,7}:\$?([A-Z]{1,3})\$?\d{1,7}/g)]
          .some((m) => m[1] === m[2] && m[1] === col)

      const totals = formulas.filter(isTotal)
      const body = formulas.filter((c) => !isTotal(c))

      const tally = new Map()
      for (const c of body) {
        const s = toR1C1(c.formula, c.row, c.col)
        tally.set(s, (tally.get(s) ?? 0) + 1)
      }
      const top = [...tally].sort((a, b) => b[1] - a[1])[0]
      // 形状五花八门时不立这条约束——那说明这列本来就不是一个公式拖下来的
      const dominant = top && top[1] > body.length / 2 ? top[0] : null
      const shapes = dominant
        ? [...new Set([dominant, ...totals.map((c) => toR1C1(c.formula, c.row, c.col))])]
        : null
      out.push({ sheet: sheet.name, col, kind: 'formula', shapes })
    } else if (numbers.length >= 3 && numbers.length > nonEmpty.length / 2) {
      out.push({ sheet: sheet.name, col, kind: 'number' })
    }
  }
  return out
}

/**
 * 这张表有没有表头行。
 *
 * 表头**不是数据**，它是这一列的含义，所以它在包里是另一类对象（`header:`）而不是 `cell:`。
 * 分不开的后果是实打实的：「D 列每格都必须是公式」会连标题「利润」一起判成缺陷——
 * 一张完全正常的表当场报两条错。这不是约束写错了，是建模粒度错了。
 *
 * 判据写成三条可复核的条件，而不是「第一行就是表头」这种默认：
 * 第一行至少两格、其中六成以上是文字、且第二行至少有一格不是文字
 * （整张纯文本表没有「表头」可言，硬认会把第一条数据吃掉）。
 * 认没认出来写进 sheet 对象的 header_row 字段，看得见，不是悄悄干的。
 */
export function detectHeaderRow(sheet) {
  const r1 = sheet.cells.filter((c) => c.row === 1 && c.kind !== 'empty')
  if (r1.length < 2) return false
  if (r1.filter((c) => c.kind === 'text').length < r1.length * 0.6) return false
  const r2 = sheet.cells.filter((c) => c.row === 2 && c.kind !== 'empty')
  return r2.some((c) => c.kind !== 'text')
}

/**
 * 把诊断结论**物化成字段**，让领域无关的谓词判得动。
 *
 * 这是 CAD 方言就立下的做法（属性摊平成 attr_NUMBER）：谓词判的是
 * 「一个稳定 ID 上的一个具名字段」，判不了「请顺着依赖图看看下面还有没有数据」。
 * 所以「看看」这一步在导入时做完，只把结论写成字段。
 * 领域知识因此留在**数据**里，没有渗进校验器。
 */
export function materialize(wb) {
  const sheetNames = new Set(wb.sheets.map((s) => s.name))
  const index = new Map() // "Sheet!REF" → cell
  for (const s of wb.sheets) for (const c of s.cells) index.set(`${s.name}!${c.ref}`, c)

  const profiles = wb.sheets.flatMap(profileColumns)
  const numberCols = new Set(profiles.filter((p) => p.kind === 'number').map((p) => `${p.sheet}!${p.col}`))

  // 哪些格子真的被某个 SUM/AVERAGE/… 圈进去了。
  //
  // 文本型数字的**危害**是：聚合会静静地把它当 0 跳过。没人对这列求和，就没有危害。
  // 51 份真表实测：不加这个限定，报价单里「标签 + 数字」混排的列会刷出几百条，
  // 每一条在事实上都成立（它确实是文本型数字），但没有一条会造成后果。
  // 事实成立不等于值得报——报了没后果的事，等于把真有后果的那条淹掉。
  const aggregated = new Set()
  for (const s of wb.sheets) {
    for (const c of s.cells) {
      if (c.kind !== 'formula' || !AGGREGATES.test(c.formula)) continue
      for (const m of c.formula.matchAll(/\$?([A-Z]{1,3})\$?(\d{1,7}):\$?([A-Z]{1,3})\$?(\d{1,7})/g)) {
        const [c1, c2] = [colToNum(m[1]), colToNum(m[3])].sort((a, b) => a - b)
        const [r1, r2] = [+m[2], +m[4]].sort((a, b) => a - b)
        if ((c2 - c1 + 1) * (r2 - r1 + 1) > 20000) continue // 整列引用不逐格展开
        for (let cc = c1; cc <= c2; cc++) for (let rr = r1; rr <= r2; rr++) aggregated.add(`${s.name}!${numToCol(cc)}${rr}`)
      }
    }
  }

  for (const s of wb.sheets) {
    for (const c of s.cells) {
      if (c.kind === 'formula') {
        c.formula_shape = toR1C1(c.formula, c.row, c.col)
        c.in_formula_block = true

        // 引用了不存在的表
        const missing = [...new Set((c.deps ?? []).map((d) => d.sheet).filter((n) => !sheetNames.has(n)))]
        if (missing.length) c.bad_ref = `引用了不存在的工作表：${missing.join('、')}`

        // 求和漏行：范围下沿的紧邻一行还有数据
        if (AGGREGATES.test(c.formula)) {
          const gaps = []
          for (const m of c.formula.matchAll(/\$?([A-Z]{1,3})\$?(\d{1,7}):\$?([A-Z]{1,3})\$?(\d{1,7})/g)) {
            if (m[1] !== m[3]) continue // 只看竖向范围
            const endRow = Math.max(+m[2], +m[4])
            const next = index.get(`${s.name}!${m[1]}${endRow + 1}`)
            if (!next || next.kind === 'empty' || next.kind === 'text') continue
            // 合计格自己几乎总是紧贴范围下沿（D7=SUM(D2:D6)），那不是漏行
            if (next.ref === c.ref && s.name === c.sheet) continue
            // 下面那格是另一个小计（多级汇总），也不是漏行
            if (next.kind === 'formula' && AGGREGATES.test(next.formula)) continue
            gaps.push(`${m[1]}${endRow + 1} 有数据却不在 ${m[1]}${m[2]}:${m[3]}${m[4]} 内`)
          }
          if (gaps.length) c.range_gap = gaps.join('；')
        }
      } else if (c.kind === 'text' && numberCols.has(`${s.name}!${c.colName}`) && LOOKS_NUMERIC.test(String(c.value))
                 && aggregated.has(`${s.name}!${c.ref}`)) {
        c.text_number = true
      }
    }
  }

  // ── 把「公式列」收窄成「公式块」 ─────────────────────────────
  //
  // 真表实测（51 份含公式列的表）打掉了原先的写法：一列的**整列**都被要求是公式。
  // 反例长这样——「目录」表 D 列：
  //     D2 = "生效时间"   ← 表头，但在第 2 行（第 1 行是合并的大标题）
  //     D3 = 45833        ← 被下面引用的源值
  //     D4..D13 = =D3 / =D4 / …
  // 于是 D2、D3 各被报了一条「公式列混入硬编码常量」。两条都是假警报：
  // 一条是表头，一条是这一列的**输入**，都不是「有人把公式删了填死值」。
  //
  // 收窄的判据是结构性的：公式块 = [本列第一个公式所在行, 本列最后一个非空行]。
  // 块**之上**的常量是标签和输入，块**之内**的常量才是嫌疑。
  // 这样做也顺手覆盖了「表头不在第 1 行」这种极常见的排版。
  const blockOf = new Map()
  for (const p of profiles) {
    if (p.kind !== 'formula') continue
    const sheet = wb.sheets.find((s) => s.name === p.sheet)
    const col = sheet.cells.filter((c) => c.colName === p.col)
    const first = col.filter((c) => c.kind === 'formula').reduce((m, c) => Math.min(m, c.row), Infinity)
    const last = col.filter((c) => c.kind !== 'empty').reduce((m, c) => Math.max(m, c.row), 0)
    blockOf.set(`${p.sheet}!${p.col}`, [first, last])
    for (const c of col) {
      if (c.row < first || c.row > last) continue
      c.in_formula_block = true
      // **只报数字，不报文字。** 51 份真表实测打掉了「块内非公式格都算嫌疑」这个写法：
      // 真实价格表大量使用**分段小表**——一列里「51KG+」当段标题，下面跟三行公式，
      // 如此重复十几段。那些段标题全被报成了「有人填死了公式」。
      //
      // 判据：公式被人手工填死时，填进去的几乎总是**数字**（他要的就是那个算出来的数）；
      // 公式区里的**文字**基本都是段标题或备注。因此只判 input，不判 text。
      // 代价写进 DEFECTS 目录：把文本粘贴到公式格上这一类，本方言查不到。
      if (c.kind === 'input') c.hardcoded_in_block = true
    }
  }
  return profiles
}

/** 单元格 → 对象。空格子不入库：它们不携带信息，只会把包撑大。 */
export function toObjects(wb, { name, source, maxCells }) {
  const objects = [{
    id: `book:${slug(name)}`, type: 'book', title: name, source,
    sheets: wb.sheets.length, id_basis: 'address',
  }]
  const headers = new Map(wb.sheets.map((s) => [s.name, detectHeaderRow(s)]))
  for (const s of wb.sheets) {
    objects.push({
      id: `sheet:${slug(s.name)}`, type: 'sheet', name: s.name, book: `book:${slug(name)}`,
      cells: s.cells.filter((c) => c.kind !== 'empty').length,
      header_row: headers.get(s.name) ? 1 : null,
    })
  }

  const relations = []
  let written = 0
  let truncated = 0
  for (const s of wb.sheets) {
    const sh = slug(s.name)
    for (const c of s.cells) {
      if (c.kind === 'empty') continue
      if (written >= maxCells) { truncated++; continue }
      written++
      // 表头是列的含义，不是列里的一个数据点——另立一类，否则列级约束会连标题一起判
      const isHeader = headers.get(s.name) && c.row === 1
      const id = `${isHeader ? 'header' : 'cell'}:${sh}!${c.colName}/${c.row}`
      const o = isHeader
        ? { id, type: 'header', sheet: s.name, ref: c.ref, col: c.colName, label: c.value }
        : { id, type: 'cell', sheet: s.name, ref: c.ref, row: c.row, col: c.colName, kind: c.kind, value: c.value }
      if (isHeader) { objects.push(o); continue }
      if (c.formula) { o.formula = c.formula; o.formula_shape = c.formula_shape }
      if (c.error) o.error = c.error
      if (c.bad_ref) o.bad_ref = c.bad_ref
      if (c.range_gap) o.range_gap = c.range_gap
      if (c.text_number) o.text_number = true
      if (c.hardcoded_in_block) o.hardcoded_in_block = true
      objects.push(o)

      // 依赖图：协议六要素里的 relations，不是为 Excel 新造的东西
      for (const d of c.deps ?? []) {
        if (d.ref.includes(':')) continue // 大范围未展开，跳过（下面在 book 上记总数）
        relations.push({ subject: id, predicate: 'depends_on', object: `cell:${slug(d.sheet)}!${d.ref.replace(/^([A-Z]+)(\d+)$/, '$1/$2')}` })
      }
    }
  }
  return { objects, relations, truncated }
}

// ── 认一下这个文件到底是什么 ────────────────────────────────────
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

/**
 * 读不了的时候，**原因不同建议就不同**——一句笼统的「不支持」会让人去试错误的方向。
 * 这两种伪装都是实测遇到的，不是假想：
 * D:/Downloads 里 22 份 .xlsx，6 份根本不是 xlsx，全是 HTML 改的扩展名。
 */
export function sniff(head) {
  if (head.subarray(0, 8).equals(OLE2))
    return {
      kind: 'xls', readable: false,
      why: '这是 .xls（OLE2 复合文档，Excel 2003 及更早的二进制格式），不是 xlsx。两者只是扩展名像，内部结构毫无关系。',
      how: '在 Excel/WPS 里「另存为 → Excel 工作簿(.xlsx)」，再导入一次。',
    }
  const text = head.toString('latin1').trim().toLowerCase()
  if (text.startsWith('<html') || text.startsWith('<!doctype') || text.startsWith('<?xml') || text.startsWith('<table'))
    return {
      kind: 'html', readable: false,
      why: '这是一份 HTML 表格，只是扩展名被改成了 .xlsx。很多业务系统的「导出 Excel」就是这么做的——Excel 能打开，所以没人发现。',
      how: [
        '后果不只是导入失败：这种文件里没有单元格类型，数字全是字符串，',
        '公式一条都没有——它是表格的**投影**，不是表格本身。',
        '→ 用 Excel/WPS 打开后「另存为 .xlsx」可以拿到真格式，但公式救不回来（源头就没有）。',
        '→ 更好的办法是让出数据的系统直接给 xlsx 或 CSV。',
      ].join('\n'),
    }
  if (head.subarray(0, 2).toString('latin1') !== 'PK')
    return { kind: 'unknown', readable: false, why: '既不是 ZIP（xlsx 的外壳），也不是已知的伪装格式。', how: '确认这个文件到底是什么再说。' }
  return { kind: 'xlsx', readable: true }
}

// ── CLI ─────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith('import.mjs') && process.argv[1]?.includes('xlsx')) {
  const [src, dir] = process.argv.slice(2)
  if (!src || !dir) {
    process.stderr.write('用法：import.mjs <表.xlsx> <包路径> [--name 预算表] [--max-cells 20000]\n')
    process.exit(2)
  }
  const opt = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d }
  const name = opt('--name', basename(src).replace(/\.xlsx$/i, ''))
  const maxCells = Number(opt('--max-cells', '20000'))

  const buf = readFileSync(src)
  const probe = sniff(buf.subarray(0, 512))
  if (!probe.readable) {
    process.stderr.write(`无法导入：${src}\n\n${probe.why}\n\n${probe.how}\n`)
    process.exit(2)
  }

  const wb = parseXlsx(buf)
  const profiles = materialize(wb)
  const { objects, relations, truncated } = toObjects(wb, { name, source: src, maxCells })
  const constraints = xlsxConstraints(profiles)

  initPackage(dir, { manifest: XLSX_MANIFEST(slug(name), name, src), objects, relations, constraints,
    // 第七要素：这个包保证不了什么。截断只要发生就必然出现在这里。
    limits: xlsxLimits({ truncated }) })
  appendHistory(dir, [{
    event: 'imported', source: src, sheets: wb.sheets.length,
    cells: objects.filter((o) => o.type === 'cell').length,
    formula_columns: profiles.filter((p) => p.kind === 'formula').length,
    truncated_cells: truncated,
    at: new Date().toISOString(), by: 'xlsx-import',
  }])

  const cells = objects.filter((o) => o.type === 'cell').length
  const fcols = profiles.filter((p) => p.kind === 'formula')
  process.stderr.write(`导入 ${name}：${wb.sheets.length} 表、${cells} 格、${relations.length} 条依赖；识别出 ${fcols.length} 个公式列、${profiles.length - fcols.length} 个数值列\n`)
  // 截断必须说出来——悄悄少算等于假装全查了
  if (truncated) process.stderr.write(`⚠ 超出 --max-cells ${maxCells}，有 ${truncated} 格未入库，体检结果只覆盖前 ${maxCells} 格。\n`)
  process.stderr.write('⚠ 单元格地址不是稳定 ID：在上面插一行，D5 就变成 D6。跨版本对比会把「插了一行」看成「往下每一格都改了」。\n')
  process.stdout.write(dir + '\n')
}
