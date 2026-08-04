#!/usr/bin/env node
// 生成测试夹具：A-合规.xlsx（应零 error）与 B-缺陷.xlsx（种入 6 个缺陷）。
//
//   node adapters/xlsx/fixtures/make-fixture.mjs
//
// ## 诚实的边界（与 CAD / 法律方言同一条红线）
//
// **这两份夹具是自己造的，自己出的卷子考满分不算能力证据。**
// 它们保证的是「改代码不会让检出变差」，不保证真实业务表格上的表现。
// 真实表格的验证见 README「在真文件上跑过什么」一节。
//
// 夹具刻意包含两样最容易把检查器坑掉的东西：
//   ① **共享公式**：Excel 存一列相同公式时只写第一格全文，后面只写 si 编号。
//      不翻译就会把整列判成「没有公式」，对一张好表报一列的错。
//   ② **合计行**：=SUM(D2:D6) 与上面的 =B6-C6 形状天然不同，
//      不放行就会把每张带小计的表都判成缺陷。
// 两者都是「假警报比不查更糟」的典型来源，所以必须进合规卷。

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zip } from '../zip.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * 单元格描述 → XML。
 *   数字        123
 *   文本        's:文字'
 *   公式        { f: 'B2-C2', v: 40 }
 *   共享公式主  { f: 'B2-C2', v: 40, si: 0, ref: 'D2:D6' }
 *   共享公式随  { si: 0, v: 50 }
 *   错误值      { f: 'D7/B7', v: '#DIV/0!', e: true }
 */
function cellXml(ref, cell, strings) {
  if (cell === null || cell === undefined) return ''
  if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`
  if (typeof cell === 'string' && cell.startsWith('s:')) {
    const text = cell.slice(2)
    let i = strings.indexOf(text)
    if (i < 0) { i = strings.length; strings.push(text) }
    return `<c r="${ref}" t="s"><v>${i}</v></c>`
  }
  const { f, v, si, ref: sref, e } = cell
  const t = e ? ' t="e"' : ''
  let fx = ''
  if (f !== undefined && si !== undefined) fx = `<f t="shared" si="${si}" ref="${sref}">${esc(f)}</f>`
  else if (f !== undefined) fx = `<f>${esc(f)}</f>`
  else if (si !== undefined) fx = `<f t="shared" si="${si}"/>`
  return `<c r="${ref}"${t}>${fx}${v === undefined ? '' : `<v>${esc(v)}</v>`}</c>`
}

const COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function sheetXml(rows, strings) {
  const body = rows.map((row, ri) => {
    const cells = row.map((c, ci) => cellXml(`${COLS[ci]}${ri + 1}`, c, strings)).join('')
    return cells ? `<row r="${ri + 1}">${cells}</row>` : ''
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
}

/** @param sheets [{ name, rows }] */
export function buildXlsx(sheets) {
  const strings = []
  const sheetXmls = sheets.map((s) => sheetXml(s.rows, strings))

  const entries = new Map()
  entries.set('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`)

  entries.set('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)

  entries.set('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`)

  entries.set('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`)

  sheetXmls.forEach((x, i) => entries.set(`xl/worksheets/sheet${i + 1}.xml`, x))

  entries.set('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`)

  return zip(entries)
}

// ── A-合规：一张正常的月度预算表 ────────────────────────────────
// D 列用**共享公式**（主格 D2 带全文，D3-D6 只有 si），E 列用普通公式。
// 第 7 行是合计行——三个 SUM 的形状与上方正文不同，但它们是合法的小计。
const 合规 = [
  ['s:月份', 's:收入', 's:成本', 's:利润', 's:利润率'],
  ['s:1月', 100, 60, { f: 'B2-C2', v: 40, si: 0, ref: 'D2:D6' }, { f: 'D2/B2', v: 0.4 }],
  ['s:2月', 120, 70, { si: 0, v: 50 }, { f: 'D3/B3', v: 0.4167 }],
  ['s:3月', 150, 80, { si: 0, v: 70 }, { f: 'D4/B4', v: 0.4667 }],
  ['s:4月', 130, 75, { si: 0, v: 55 }, { f: 'D5/B5', v: 0.4231 }],
  ['s:5月', 140, 85, { si: 0, v: 55 }, { f: 'D6/B6', v: 0.3929 }],
  ['s:合计', { f: 'SUM(B2:B6)', v: 640 }, { f: 'SUM(C2:C6)', v: 370 }, { f: 'SUM(D2:D6)', v: 270 }],
]

const 参数 = [
  ['s:项', 's:值'],
  ['s:税率', 0.06],
  ['s:折扣', 0.95],
]

// ── B-缺陷：同一张表，种入 6 个缺陷 ─────────────────────────────
const 缺陷 = [
  ['s:月份', 's:收入', 's:成本', 's:利润', 's:利润率', 's:备注'],
  ['s:1月', 100, 60, { f: 'B2-C2', v: 40 }, { f: 'D2/B2', v: 0.4 }, { f: '汇总!A1', v: 0 }], // D5 引用不存在的表
  ['s:2月', 120, 70, { f: 'B3-C3', v: 50 }, { f: 'D3/B3', v: 0.4167 }],
  ['s:3月', 's:1,234', 80, { f: 'B4-C4', v: 0 }, { f: 'D4/B4', v: 0 }],                      // D6 文本型数字
  ['s:4月', 130, 75, 999, { f: 'D5/B5', v: 7.68 }],                                          // D1 公式列混入常量
  ['s:5月', 140, 85, { f: 'B6-C5', v: 65 }, { f: 'D6/B6', v: 0.4643 }],                      // D2 形状不一致
  ['s:6月', 160, 90, { f: 'B7-C7', v: 70 }, { f: 'D7/B7', v: '#DIV/0!', e: true }],           // D4 错误值残留
  ['s:合计', { f: 'SUM(B2:B7)', v: 650 }, { f: 'SUM(C2:C7)', v: 460 }, { f: 'SUM(D2:D6)', v: 154 }], // D3 求和漏掉第 7 行
]

if (process.argv[1]?.includes('make-fixture')) {
  mkdirSync(HERE, { recursive: true })
  writeFileSync(join(HERE, 'A-合规.xlsx'), buildXlsx([{ name: '预算', rows: 合规 }, { name: '参数', rows: 参数 }]))
  writeFileSync(join(HERE, 'B-缺陷.xlsx'), buildXlsx([{ name: '预算', rows: 缺陷 }, { name: '参数', rows: 参数 }]))
  process.stderr.write(`已生成 ${join(HERE, 'A-合规.xlsx')}\n已生成 ${join(HERE, 'B-缺陷.xlsx')}\n`)
}
