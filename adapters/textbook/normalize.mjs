#!/usr/bin/env node
// normalize.mjs —— 教材 docx 的批量规范化改稿器（textbook 方言）
//
// import.mjs 只观察不改稿：它把书变成对象包、把责编意见变成红点。
// 但红点要归零总得有人去改，而「132 处栏目名去括号」这种活，人工逐处改一定会漏。
// 这个文件是方言的另一半：**把无歧义的责编意见批量执行掉**，改完重跑 diagnose 验收。
//
// 四条设计约束，都是踩出来的：
//
// 1) **一次正则遍历，每个匹配只经手一次。**
//    稿子里编号写法不统一（「表 4 - 1 - 1」与「表4-1-1」混用），
//    用替换对做顺移会双重替换——4-1-1→4-2 之后，另一条规则又把新生成的 4-2 当原始的再改一次。
//    这类错不能靠「小心排序」绕开，要从机制上消灭。
//
// 2) **只重写被编辑区间覆盖到的 run。**
//    Word 把一段话切成多个 w:t，编号常常跨 run。把整段塞回第一个 run 会把段内混排格式抹平。
//
// 3) **段落扫描必须认嵌套。**
//    文本框（w:txbxContent）里还有 w:p，非贪婪正则会在内层的 </w:p> 提前收尾，
//    于是外层段落被截断、pPr 插到错误的位置。这里用深度扫描，不用正则切段。
//
// 4) **import 本文件不许有副作用。**
//    office 方言栽过：入口守卫写成「文件名叫 import.mjs 就跑 main()」，
//    别的方言一 import 它就把整本书打到 stdout。这里主流程是纯函数，CLI 关在守卫里。
//
// 用法：
//   node adapters/textbook/normalize.mjs <in.docx> <out.docx> [动作...] [--dry] [--json]
//
// 动作：
//   --debracket              栏目名去【】，并置为黑体、无首行缩进（审稿意见①）
//                            只认白名单栏目名、且整段就是栏目名——正文里的【定位】那种
//                            软件按钮名一个都不许碰
//   --tbl-flatten <项目号>    该项目的三级表号压成两级，按文档顺序重排，正文引用同步
//   --fig-flatten <项目号>    同上，图号
//   --line <值>              正文行距归一（480 = 2 倍行距）（审稿意见④）
//   --size <值>              正文字号归一（24 = 小四，半角磅×2）（审稿意见④）
//   --indent                 正文首行缩进归一为 2 字（只归一「杂牌绝对缩进」，不给无缩进的段落硬加）
//   --set "旧=>新"            定点替换（可多次）
//
// 退出码：0 = 已写出（或 --dry 正常）　1 = 用法错/一处都没命中　2 = 读写失败

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { unzip, zip } from '../xlsx/zip.mjs'
import { BRACKETABLE_SECTIONS } from './dialect.mjs'

// ── XML 文本层 ────────────────────────────────────────────────────────
const ENT = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" }
const dec = s => s.replace(/&(lt|gt|amp|quot|apos);/g, m => ENT[m])
const enc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 深度扫描出**最外层**的 w:p 区间。文本框里的内层 w:p 归属外层，不单独成段。 */
export function scanParagraphs(xml) {
  const out = []
  const tag = /<w:p(?:\s[^>]*?)?(\/?)>|<\/w:p>/g
  let m, depth = 0, start = -1
  while ((m = tag.exec(xml)) !== null) {
    if (m[0].startsWith('</')) {
      if (depth > 0 && --depth === 0) out.push({ s: start, e: m.index + m[0].length })
    } else if (m[1] === '/') {
      continue                                   // <w:p/> 空段，无内容可改
    } else {
      if (depth++ === 0) start = m.index
    }
  }
  return out
}

/** 表格区间——表内段落不参与「正文」类的格式归一（责编说的是正文）。 */
function scanTables(xml) {
  const out = []
  const tag = /<w:tbl(?:\s[^>]*?)?>|<\/w:tbl>/g
  let m, depth = 0, start = -1
  while ((m = tag.exec(xml)) !== null) {
    if (m[0].startsWith('</')) { if (depth > 0 && --depth === 0) out.push([start, m.index]) }
    else { if (depth++ === 0) start = m.index }
  }
  return out
}

const runsOf = para => {
  const runs = []
  const re = /(<w:t(?:\s[^>]*?)?>)([\s\S]*?)(<\/w:t>)/g
  let m
  while ((m = re.exec(para)) !== null) runs.push({ open: m[1], raw: m[2], close: m[3], at: m.index, text: dec(m[2]) })
  return runs
}

// ── 编号重排 ──────────────────────────────────────────────────────────
const NUM_RE = kind => new RegExp(`${kind}\\s*(\\d+)\\s*[-－—–]\\s*(\\d+)(?:\\s*[-－—–]\\s*(\\d+))?`, 'g')

/**
 * 按文档顺序给某个项目的图注/表注重排两级号，返回 旧号→新号。
 * 已经是两级的也参与定序——否则新号会和它撞车。
 */
export function planFlatten(paraTexts, kind, proj) {
  // 图注/表注常常**不空格**就接图名（实测「表4-1-4常用铸铁的名称」），所以不能要求后面是空白；
  // 但也不能什么都放行——「表4-1的技术要求…」那是正文在提这张表，不是表注。
  // 判据：段首是编号，且紧跟的不是把它接成句子的那些虚词。
  const capRe = new RegExp(`^\\s*${kind}\\s*(\\d+)\\s*[-－—–]\\s*(\\d+)(?:\\s*[-－—–]\\s*(\\d+))?(?![的所中内里上下与和及等为是如])`)
  const plan = new Map()
  let seq = 0
  for (const t of paraTexts) {
    const m = capRe.exec(t)
    if (!m || +m[1] !== proj) continue
    const old = m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`
    if (plan.has(old)) continue   // 同号图注重复出现（重号）——保持第一次的映射，重号由 diagnose 单管
    plan.set(old, `${proj}-${++seq}`)
  }
  return plan
}

/** 算出一段里的编辑区间（按起点升序、互不重叠）。刻意返回区间而不是新字符串——见文件头第 2 条。 */
function computeEdits(t, plans, stats, ops) {
  const edits = []
  for (const s of ops.sets || []) {
    let i = 0
    while ((i = t.indexOf(s.find, i)) >= 0) { edits.push({ s: i, e: i + s.find.length, rep: s.replace, kind: 'set' }); i += s.find.length }
  }
  for (const [kind, { proj, plan }] of plans) {
    const re = NUM_RE(kind)
    let m
    while ((m = re.exec(t)) !== null) {
      if (+m[1] !== proj) continue
      const old = m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`
      const nu = plan.get(old)
      if (!nu) { stats.unmapped.push(kind + old); continue }   // 正文引用了不存在的号——不猜，记账
      const rep = `${kind}${nu}`
      if (rep !== m[0]) edits.push({ s: m.index, e: m.index + m[0].length, rep, kind: m[3] ? 'flatten' : 'renum' })
    }
  }
  edits.sort((a, b) => a.s - b.s)
  const out = []
  let last = -1
  for (const ed of edits) { if (ed.s < last) continue; out.push(ed); last = ed.e; stats[ed.kind]++ }
  return out
}

/** 把编辑区间写回 para：只碰被覆盖到的 run。 */
function applyEdits(para, runs, joined, edits) {
  let cursor = 0
  const newText = runs.map(r => {
    const rs = cursor, re = cursor + r.text.length
    cursor = re
    let s = ''
    for (let i = rs; i < re;) {
      const ed = edits.find(x => x.s <= i && i < x.e)
      if (!ed) { s += joined[i]; i++; continue }
      if (ed.s === i) s += ed.rep
      i = Math.min(ed.e, re)
    }
    return s
  })
  let out = para, delta = 0, touched = 0
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]
    if (newText[i] === r.text) continue
    touched++
    const s = r.at + delta + r.open.length
    const e = s + r.raw.length
    const raw = enc(newText[i])
    out = out.slice(0, s) + raw + out.slice(e)
    delta += raw.length - r.raw.length
  }
  return { xml: out, touched }
}

// ── pPr / rPr 改写 ────────────────────────────────────────────────────
/** 取出（或建出）段首的 <w:pPr>…</w:pPr>，回调改完写回。 */
function editPPr(para, fn) {
  const m = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(para)
  if (m) {
    const inner = fn(m[1])
    if (inner === m[1]) return para
    return para.slice(0, m.index) + `<w:pPr>${inner}</w:pPr>` + para.slice(m.index + m[0].length)
  }
  const inner = fn('')
  if (!inner) return para
  const open = /<w:p(?:\s[^>]*?)?>/.exec(para)
  if (!open) return para
  const at = open.index + open[0].length
  return para.slice(0, at) + `<w:pPr>${inner}</w:pPr>` + para.slice(at)
}

/**
 * pPr / rPr 的子元素**有 schema 规定的顺序**，插错位置就是一份不合规的 docx。
 * Word 多半容忍，但那是在赌客户那台机器上的 Word 宽容——交出去的稿子不赌这个。
 */
const PPR_ORDER = ['w:pStyle', 'w:keepNext', 'w:keepLines', 'w:pageBreakBefore', 'w:numPr', 'w:pBdr', 'w:shd', 'w:tabs', 'w:spacing', 'w:ind', 'w:jc', 'w:rPr']
const RPR_ORDER = ['w:rStyle', 'w:rFonts', 'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:caps', 'w:smallCaps', 'w:strike', 'w:color', 'w:spacing', 'w:sz', 'w:szCs', 'w:highlight', 'w:u', 'w:vertAlign', 'w:lang']

/** 在有序容器里插入（或替换）一个子元素。 */
function upsertOrdered(inner, tag, xml, order) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*?)?(?:/>|>[\\s\\S]*?</${tag}>)`)
  if (re.test(inner)) return inner.replace(re, xml)
  for (let i = order.indexOf(tag) + 1; i < order.length; i++) {
    const m = new RegExp(`<${order[i]}(?:\\s|/|>)`).exec(inner)
    if (m) return inner.slice(0, m.index) + xml + inner.slice(m.index)
  }
  return inner + xml
}
const upsertPPrChild = (inner, tag, xml) => upsertOrdered(inner, tag, xml, PPR_ORDER)

/** 给段内所有带文字的 run 套黑体（栏目名）。 */
export function boldRuns(para) {
  return para.replace(/<w:r(?:\s[^>]*?)?>[\s\S]*?<\/w:r>/g, run => {
    if (!/<w:t[\s>]/.test(run)) return run
    if (/<w:b\/>|<w:b\s/.test(run)) return run
    const m = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run)
    if (m) {
      const inner = upsertOrdered(upsertOrdered(m[1], 'w:b', '<w:b/>', RPR_ORDER), 'w:bCs', '<w:bCs/>', RPR_ORDER)
      return run.slice(0, m.index) + `<w:rPr>${inner}</w:rPr>` + run.slice(m.index + m[0].length)
    }
    const open = /<w:r(?:\s[^>]*?)?>/.exec(run)
    const at = open.index + open[0].length
    return run.slice(0, at) + `<w:rPr><w:b/><w:bCs/></w:rPr>` + run.slice(at)
  })
}

// ── 主流程（纯函数：不碰文件系统，自检可以直接喂一段 XML）───────────────
export function normalizeDocumentXml(xml0, opts = {}) {
  const ops = { sets: [], ...opts }
  const paraSpans = scanParagraphs(xml0)
  const tblSpans = scanTables(xml0)
  const inTbl = at => tblSpans.some(([s, e]) => at >= s && at < e)

  const paras = paraSpans.map(sp => ({ ...sp, xml: xml0.slice(sp.s, sp.e) }))
  const texts = paras.map(p => runsOf(p.xml).map(r => r.text).join(''))

  const plans = new Map()
  if (ops.tblFlatten) plans.set('表', { proj: ops.tblFlatten, plan: planFlatten(texts, '表', ops.tblFlatten) })
  if (ops.figFlatten) plans.set('图', { proj: ops.figFlatten, plan: planFlatten(texts, '图', ops.figFlatten) })

  const stats = { set: 0, flatten: 0, renum: 0, debracket: 0, bolded: 0, line: 0, size: 0, indent: 0, paras: 0, unmapped: [] }
  const samples = { debracket: [], flatten: [], line: [], size: [], indent: [] }

  const SECT = new Set(BRACKETABLE_SECTIONS)
  /** 栏目名：**整段就是**一个白名单里的名字。两个条件缺一不可——
   *  实测「单击【定位】搜索」那是软件按钮名，去掉括号就改错了书。 */
  const isSectionName = t => { const m = /^\s*【([^】]+)】\s*$/.exec(t); return m && SECT.has(m[1]) ? m[1] : null }

  /**
   * 「正文段落」：不在表格里、不是图注表注、不是栏目名、不是 (a) 那种组图标注、够长。
   *
   * 门槛（>8 字）与判据侧 import.mjs 的 isCaptionLike / 正文统计**必须一致**。
   * 不一致的后果实测过：施工只改 ≥15 字的段，判据却把 9~14 字的也算进「行距变体数」，
   * 于是改完红点不降，看上去像没改到位——其实是两边在数不同的东西。
   */
  const isBody = (t, at) => {
    const s = t.trim()
    if (!s || inTbl(at)) return false
    if (/^[图表]\s*\d+\s*[-－—–]/.test(s)) return false
    if (/^【[^】]{2,8}】$/.test(s)) return false
    if (/^[（(]\s*[a-zA-Z]\s*[）)]/.test(s)) return false
    return s.length > 8
  }

  const outParas = paras.map((p, i) => {
    let x = p.xml
    const t = texts[i]

    // ① 文本层：编号重排 + 定点替换
    if (plans.size || ops.sets.length) {
      const runs = runsOf(x)
      if (runs.length) {
        const joined = runs.map(r => r.text).join('')
        const edits = computeEdits(joined, plans, stats, ops)
        if (edits.length) {
          const r = applyEdits(x, runs, joined, edits)
          x = r.xml
          if (r.touched) stats.paras++
          if (samples.flatten.length < 8) samples.flatten.push(`${joined.trim().slice(0, 44)} → ${edits.map(e => e.rep).join(',')}`)
        }
      }
    }

    // ② 栏目名去【】+ 黑体 + 无首行缩进
    const sect = isSectionName(t)
    if (ops.debracket && sect) {
      const runs = runsOf(x)
      const joined = runs.map(r => r.text).join('')
      const s0 = joined.indexOf('【'), e0 = joined.indexOf('】')
      if (s0 >= 0 && e0 > s0) {
        const r = applyEdits(x, runs, joined, [{ s: s0, e: e0 + 1, rep: joined.slice(s0 + 1, e0), kind: 'debracket' }])
        x = r.xml
        stats.debracket++
        if (samples.debracket.length < 8) samples.debracket.push(sect)
        x = editPPr(x, inner => upsertPPrChild(inner, 'w:ind', '<w:ind w:firstLine="0" w:firstLineChars="0"/>'))
        const b = boldRuns(x)
        if (b !== x) { x = b; stats.bolded++ }
      }
    }

    // ③ 正文行距归一
    if (ops.line && isBody(t, p.s)) {
      const cur = /<w:spacing[^>]*w:line="(\d+)"/.exec(x)
      if (cur && +cur[1] !== ops.line) {
        const old = cur[1]
        x = editPPr(x, inner => inner.replace(/<w:spacing([^>]*?)w:line="\d+"([^>]*?)w:lineRule="\w+"/, `<w:spacing$1w:line="${ops.line}"$2w:lineRule="auto"`))
        stats.line++
        if (samples.line.length < 8) samples.line.push(`${old}→${ops.line}  ${t.trim().slice(0, 34)}`)
      }
    }

    // ③b 正文字号归一（w:sz 与 w:szCs 一起改，只改带文字的 run）
    if (ops.size && isBody(t, p.s)) {
      let n = 0
      x = x.replace(/<w:r(?:\s[^>]*?)?>[\s\S]*?<\/w:r>/g, run => {
        if (!/<w:t[\s>]/.test(run)) return run
        return run.replace(/<w:sz(Cs)? w:val="(\d+)"\/>/g, (mm, cs, v) => {
          if (+v === ops.size) return mm
          n++
          return `<w:sz${cs || ''} w:val="${ops.size}"/>`
        })
      })
      if (n) {
        stats.size++
        if (samples.size.length < 8) samples.size.push(t.trim().slice(0, 34))
      }
    }

    // ④ 首行缩进归一：只收拾「杂牌绝对缩进」（tw403/442/482…看着像两字其实不是）。
    //    对本来就没有缩进的段落**不硬加**——那里面混着居中标题、目标条目、图内标注，
    //    机器分不清，硬加会把不该缩的也缩了。
    if (ops.indent && isBody(t, p.s)) {
      const m = /<w:ind([^>]*)\/>/.exec(x)
      if (m && /w:firstLine="(\d+)"/.test(m[1]) && !/w:firstLineChars="200"/.test(m[1])) {
        const tw = /w:firstLine="(\d+)"/.exec(m[1])[1]
        if (+tw > 0) {
          x = editPPr(x, inner => upsertPPrChild(inner, 'w:ind', '<w:ind w:firstLine="480" w:firstLineChars="200"/>'))
          stats.indent++
          if (samples.indent.length < 8) samples.indent.push(`${tw}→480(2字)  ${t.trim().slice(0, 34)}`)
        }
      }
    }
    return x
  })

  // 拼回：段落之间的原始字节一个都不动
  let out = '', prev = 0
  paras.forEach((p, i) => { out += xml0.slice(prev, p.s) + outParas[i]; prev = p.e })
  out += xml0.slice(prev)

  stats.total = stats.set + stats.flatten + stats.renum + stats.debracket + stats.line + stats.size + stats.indent
  return { xml: out, stats, samples, paraCount: paras.length }
}

// ── CLI ───────────────────────────────────────────────────────────────
function main(argv) {
  const die = (msg, code) => { console.error(msg); process.exit(code) }
  const files = argv.filter(a => !a.startsWith('--') && /\.docx$/i.test(a))
  const DRY = argv.includes('--dry')
  const JSONOUT = argv.includes('--json')
  const has = f => argv.includes(f)
  const val = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null }

  const sets = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--set') {
      const s = argv[i + 1] || ''
      const k = s.indexOf('=>')
      if (k < 0) die(`--set 要写成 旧=>新：${s}`, 1)
      sets.push({ find: s.slice(0, k), replace: s.slice(k + 2) })
    }
  }
  const ops = {
    debracket: has('--debracket'),
    tblFlatten: val('--tbl-flatten') ? +val('--tbl-flatten') : null,
    figFlatten: val('--fig-flatten') ? +val('--fig-flatten') : null,
    line: val('--line') ? +val('--line') : null,
    size: val('--size') ? +val('--size') : null,
    indent: has('--indent'),
    sets,
  }
  if (files.length !== 2 || !Object.values(ops).some(v => v && (!Array.isArray(v) || v.length))) {
    die('用法: node adapters/textbook/normalize.mjs <in.docx> <out.docx> --debracket [--tbl-flatten 4] [--line 480] [--size 24] [--indent] [--set "旧=>新"] [--dry]', 1)
  }
  const [IN, OUT] = files

  let entries
  try { entries = unzip(readFileSync(IN)) } catch (e) { die(`读不了 ${IN}：${e.message}`, 2) }
  const DOC = 'word/document.xml'
  if (!entries.has(DOC)) die('缺少 word/document.xml——这不是一份 Word 文档', 2)

  const { xml, stats, samples, paraCount } = normalizeDocumentXml(entries.get(DOC).toString('utf8'), ops)

  const report = {
    in: IN, out: OUT, dry: DRY,
    段落总数: paraCount,
    栏目名去括号: stats.debracket, 栏目名加黑体: stats.bolded,
    编号压两级: stats.flatten, 编号顺移: stats.renum, 定点替换: stats.set,
    行距归一: stats.line, 字号归一: stats.size, 首行缩进归一: stats.indent,
    涉及段落: stats.paras,
    正文引用了不存在的号: [...new Set(stats.unmapped)],
    合计改动: stats.total,
  }
  if (JSONOUT) console.log(JSON.stringify(report, null, 1))
  else {
    console.error(`栏目名去括号 ${stats.debracket} · 加黑体 ${stats.bolded} · 编号压两级 ${stats.flatten} · 编号顺移 ${stats.renum} · 定点替换 ${stats.set} · 行距归一 ${stats.line} · 字号归一 ${stats.size} · 首行缩进归一 ${stats.indent}`)
    for (const k of Object.keys(samples)) if (samples[k].length) console.error(`  [${k}] ` + samples[k].join(' | '))
    if (report.正文引用了不存在的号.length) console.error(`  ⚠ 正文引用了不存在的号（不猜、不改）：${report.正文引用了不存在的号.join(' ')}`)
  }

  if (!stats.total) { console.error('一处都没命中——不写文件，免得你以为改好了'); process.exit(1) }
  if (DRY) { console.error('--dry：未写出'); process.exit(0) }

  entries.set(DOC, Buffer.from(xml, 'utf8'))
  try { writeFileSync(OUT, zip(entries)) } catch (e) { die(`写不了 ${OUT}：${e.message}`, 2) }
  console.error(`已写出 ${OUT}`)
  process.exit(0)
}

// 入口守卫：只有**直接跑这个文件**才执行 CLI。
// 不能按文件名判断——office 方言就是这么栽的（别的方言一 import 就把整本书打到 stdout）。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2))
