// xlsx 解析——从 OOXML 里读出「每一格是什么」。
//
// 只读需要的四份 XML：workbook（有哪些表）、rels（表在哪个文件）、
// sharedStrings（文本池）、worksheets/*（格子本身）。样式、图表、透视表一概不读——
// 那些是**投影**，不是本源。
//
// ## 必须处理共享公式，否则会造假警报
//
// Excel 存一列相同公式时不会写十遍，而是第一格写全文并标 t="shared" si="0" ref="D2:D11"，
// 后面九格只写 `<f t="shared" si="0"/>`。天真的解析器会认为后九格「没有公式」，
// 于是「公式列里混进了硬编码常量」这条体检当场对着一份完全正常的表报九条错。
//
// 假警报比不查更糟——几次误报之后没人会再看体检结果（decision:rules-by-usage）。
// 所以这里把主公式按行列偏移翻译给每个跟随格，相对引用平移、绝对引用（带 $）不动。

import { unzip } from './zip.mjs'

// ── A1 地址 ─────────────────────────────────────────────────────
export const colToNum = (s) => [...s].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)
export const numToCol = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26 } return s }
export const parseRef = (ref) => { const m = /^([A-Z]+)(\d+)$/.exec(ref); return m ? { col: colToNum(m[1]), row: +m[2], colName: m[1] } : null }

// ── 极简 XML 扫描 ───────────────────────────────────────────────
// 只够读 OOXML 这几份文件：取标签、取属性、取文本。不是通用 XML 解析器，不假装是。
const attr = (tag, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag); return m ? m[1] : null }
const unescapeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&')  // 必须最后——否则 &amp;lt; 会被两次解码成 <

/** 取出所有 <name ...>...</name> 或 <name .../>，返回 [{ tag, inner }] */
function* elements(xml, name) {
  const re = new RegExp(`<${name}(\\s[^>]*?)?(/)?>`, 'g')
  let m
  while ((m = re.exec(xml))) {
    const openTag = m[0]
    if (m[2]) { yield { tag: openTag, inner: '' }; continue }
    const close = xml.indexOf(`</${name}>`, re.lastIndex)
    if (close < 0) { yield { tag: openTag, inner: '' }; continue }
    yield { tag: openTag, inner: xml.slice(re.lastIndex, close) }
    re.lastIndex = close + name.length + 3
  }
}

const textOf = (xml) => {
  let out = ''
  for (const { inner } of elements(xml, 't')) out += unescapeXml(inner)
  return out
}

// ── 共享公式翻译 ────────────────────────────────────────────────
// 把主公式里的相对引用按 (行偏移, 列偏移) 平移。带 $ 的绝对引用原样保留，
// 这正是 Excel 自己的语义——弄反了会把好表判成坏表。
const REF_RE = /(\$?)([A-Z]{1,3})(\$?)(\d{1,7})/g

export function translateFormula(formula, dRow, dCol) {
  return formula.replace(REF_RE, (whole, cAbs, colName, rAbs, rowNum) => {
    // 避免把函数名后紧跟的东西或字符串里的内容当引用：只在前后不是字母数字时才算
    const col = cAbs ? colName : numToCol(Math.max(1, colToNum(colName) + dCol))
    const row = rAbs ? rowNum : String(Math.max(1, +rowNum + dRow))
    return `${cAbs}${col}${rAbs}${row}`
  })
}

/**
 * 公式归一成 R1C1 相对形式——用来判断「同一列的公式是不是同一个公式」。
 *
 * D5 的 `=B5-A5` 与 D6 的 `=B6-A6` 字面不同，形状相同（都是 `RC[-2]-RC[-3]`）。
 * 只有归一之后，「这一列有一格的公式和邻居不一样」才是一句可机器判定的话——
 * 而那一格恰恰是电子表格最常见、最难靠肉眼发现的错。
 */
export function toR1C1(formula, row, col) {
  return formula.replace(/"(?:[^"]|"")*"/g, '""').replace(REF_RE, (whole, cAbs, colName, rAbs, rowNum, offset, str) => {
    if (offset > 0 && /[A-Za-z0-9_]/.test(str[offset - 1])) return whole // 函数名的一部分
    const c = cAbs ? `C${colToNum(colName)}` : `C[${colToNum(colName) - col}]`
    const r = rAbs ? `R${rowNum}` : `R[${+rowNum - row}]`
    return `${r}${c}`.replace(/\[0\]/g, '')
  })
}

/** 公式里引用到的单元格。范围展开成逐格，超过上限则只记范围本身（不让一条 SUM(A:A) 撑爆图）。 */
export function refsOf(formula, { sheet, maxExpand = 512 } = {}) {
  const out = []
  const seen = new Set()
  const push = (sh, ref) => { const k = `${sh}!${ref}`; if (!seen.has(k)) { seen.add(k); out.push({ sheet: sh, ref }) } }

  // 先吃掉字符串字面量，免得 "A1" 这种文本被当成引用
  const body = formula.replace(/"(?:[^"]|"")*"/g, '""')
  // 范围： [Sheet!]A1:B9
  const rangeRe = /(?:'([^']+)'|([A-Za-z_一-龥][\w一-龥.]*))?!?\$?([A-Z]{1,3})\$?(\d{1,7}):\$?([A-Z]{1,3})\$?(\d{1,7})/g
  const consumed = []
  let m
  while ((m = rangeRe.exec(body))) {
    const sh = m[1] ?? m[2] ?? sheet
    const c1 = colToNum(m[3]), r1 = +m[4], c2 = colToNum(m[5]), r2 = +m[6]
    const [cLo, cHi] = c1 <= c2 ? [c1, c2] : [c2, c1]
    const [rLo, rHi] = r1 <= r2 ? [r1, r2] : [r2, r1]
    const size = (cHi - cLo + 1) * (rHi - rLo + 1)
    if (size <= maxExpand) {
      for (let c = cLo; c <= cHi; c++) for (let r = rLo; r <= rHi; r++) push(sh, `${numToCol(c)}${r}`)
    } else {
      push(sh, `${numToCol(cLo)}${rLo}:${numToCol(cHi)}${rHi}`)
    }
    consumed.push([m.index, m.index + m[0].length])
  }
  // 单格引用：跳过已被范围吃掉的区段
  const single = /(?:'([^']+)'|([A-Za-z_一-龥][\w一-龥.]*))?(!)?\$?([A-Z]{1,3})\$?(\d{1,7})/g
  while ((m = single.exec(body))) {
    if (consumed.some(([a, b]) => m.index >= a && m.index < b)) continue
    // 裸名字后面直接跟地址、中间没有 `!`，那不是跨表引用，是函数名被切开了：
    // LOG10(B2) 会被切成表名 "LO" + 地址 "G10"，凭空造出一条对 G10 的依赖。
    // 依赖图里多一条假边，追链就会给出一个根本不存在的来源。
    if (m[2] && !m[3]) continue
    // 前面紧跟字母数字的，同样是名字的一部分
    if (m.index > 0 && /[A-Za-z0-9_]/.test(body[m.index - 1]) && !m[3]) continue
    push(m[1] ?? m[2] ?? sheet, `${m[4]}${m[5]}`)
  }
  return out
}

// ── 主解析 ──────────────────────────────────────────────────────

const ERROR_VALUES = new Set(['#REF!', '#DIV/0!', '#VALUE!', '#N/A', '#NAME?', '#NULL!', '#NUM!', '#GETTING_DATA'])

/**
 * @returns { sheets: [{ name, cells: [{ ref, row, col, kind, value, formula, error }] }], sharedStrings }
 *   kind: 'formula' | 'input'（人手录入的常量）| 'text' | 'empty'
 */
export function parseXlsx(buf) {
  const files = unzip(buf)
  const get = (p) => { const b = files.get(p); return b ? b.toString('utf8') : null }

  const wb = get('xl/workbook.xml')
  if (!wb) throw new Error('缺少 xl/workbook.xml——这不是 xlsx（.xls 是完全不同的二进制格式，需先另存为 xlsx）')

  // rId → 实际路径
  const rels = new Map()
  for (const { tag } of elements(get('xl/_rels/workbook.xml.rels') ?? '', 'Relationship')) {
    const t = attr(tag, 'Target')
    rels.set(attr(tag, 'Id'), t?.startsWith('/') ? t.slice(1) : `xl/${t?.replace(/^\.\//, '')}`)
  }

  // 共享字符串池
  const shared = []
  const ss = get('xl/sharedStrings.xml')
  if (ss) for (const { inner } of elements(ss, 'si')) shared.push(textOf(inner))

  const sheets = []
  let idx = 0
  for (const { tag } of elements(wb, 'sheet')) {
    idx++
    const name = unescapeXml(attr(tag, 'name') ?? `Sheet${idx}`)
    const rid = attr(tag, 'r:id') ?? attr(tag, 'id')
    const path = rels.get(rid) ?? `xl/worksheets/sheet${idx}.xml`
    const xml = get(path)
    if (xml === null) { sheets.push({ name, cells: [], missing: path }); continue }
    sheets.push({ name, cells: parseSheet(xml, shared, name) })
  }
  return { sheets }
}

function parseSheet(xml, shared, sheetName) {
  const cells = []
  const sharedMasters = new Map() // si → { formula, row, col }

  for (const { tag, inner } of elements(xml, 'c')) {
    const ref = attr(tag, 'r')
    const at = ref && parseRef(ref)
    if (!at) continue
    const t = attr(tag, 't')

    // 公式
    let formula = null
    for (const f of elements(inner, 'f')) {
      const si = attr(f.tag, 'si')
      const ftype = attr(f.tag, 't')
      if (ftype === 'shared' && si !== null) {
        if (f.inner) {
          sharedMasters.set(si, { formula: unescapeXml(f.inner), row: at.row, col: at.col })
          formula = unescapeXml(f.inner)
        } else {
          const m = sharedMasters.get(si)
          // 主公式在跟随格之前出现是 OOXML 的规定；万一没有，如实留空而不是猜
          formula = m ? translateFormula(m.formula, at.row - m.row, at.col - m.col) : null
        }
      } else if (f.inner) {
        formula = unescapeXml(f.inner)
      }
      break
    }

    // 值
    let raw = null
    for (const v of elements(inner, 'v')) { raw = unescapeXml(v.inner); break }
    let value = raw
    if (t === 's' && raw !== null) value = shared[+raw] ?? ''
    else if (t === 'inlineStr') value = textOf(inner)
    else if (t === 'b') value = raw === '1'
    else if (t !== 'str' && t !== 'e' && raw !== null && raw !== '' && !isNaN(Number(raw))) value = Number(raw)

    const error = typeof value === 'string' && ERROR_VALUES.has(value) ? value : null

    const kind = formula ? 'formula'
      : value === null || value === '' ? 'empty'
      : typeof value === 'number' ? 'input'
      : 'text'

    cells.push({
      ref, row: at.row, col: at.col, colName: at.colName, sheet: sheetName,
      kind, value, formula, error,
      ...(formula ? { deps: refsOf(formula, { sheet: sheetName }) } : {}),
    })
  }
  return cells
}
