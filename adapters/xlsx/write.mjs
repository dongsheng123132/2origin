// 写 xlsx —— 投影侧要用，夹具生成也要用，所以独立成一层。
//
// 只写必需的五份 XML：内容类型、包关系、工作簿、工作表、共享字符串。
// 样式、图表、透视表一概不写——那些是**给人看的装饰**，本象里根本没存，
// 硬造一份出来等于凭空发明信息。投影可以有损，但不能无中生有。

import { zip } from './zip.mjs'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const numToCol = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26 } return s }

/**
 * 单元格描述 → XML。
 *   数字        123
 *   文本        's:文字'
 *   公式        { f: 'B2-C2', v: 40 }
 *   共享公式主  { f: 'B2-C2', v: 40, si: 0, ref: 'D2:D6' }
 *   共享公式随  { si: 0, v: 50 }
 *   错误值      { f: 'D7/B7', v: '#DIV/0!', e: true }
 */
export function cellXml(ref, cell, strings) {
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

/** rows 为二维数组时按 A1 起排；也接受 { [A1地址]: cell } 的稀疏写法 */
export function sheetXml(rows, strings) {
  let body = ''
  if (Array.isArray(rows)) {
    body = rows.map((row, ri) => {
      const cells = row.map((c, ci) => cellXml(`${COLS[ci]}${ri + 1}`, c, strings)).join('')
      return cells ? `<row r="${ri + 1}">${cells}</row>` : ''
    }).join('')
  } else {
    // 稀疏：按行分组，行内按列号排序——OOXML 要求 row/c 都升序，乱序 Excel 会报修复
    const byRow = new Map()
    for (const [addr, cell] of Object.entries(rows)) {
      const m = /^([A-Z]+)(\d+)$/.exec(addr)
      if (!m) continue
      const r = +m[2]
      if (!byRow.has(r)) byRow.set(r, [])
      byRow.get(r).push([m[1], addr, cell])
    }
    const colNum = (s) => [...s].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)
    body = [...byRow.keys()].sort((a, b) => a - b).map((r) => {
      const cells = byRow.get(r).sort((a, b) => colNum(a[0]) - colNum(b[0]))
        .map(([, addr, cell]) => cellXml(addr, cell, strings)).join('')
      return cells ? `<row r="${r}">${cells}</row>` : ''
    }).join('')
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
}

/** @param sheets [{ name, rows }]，rows 为二维数组或 { A1: cell } 稀疏表 */
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
