#!/usr/bin/env node
// pptx → AI 友好的结构化对象（零依赖）。
//
// pptx 就是装着 XML 的 zip：ppt/slides/slideN.xml 是每一页的形状，
// ppt/slides/_rels/slideN.xml.rels 把形状 id 映射到「形状名」（如「标题 1」），
// ppt/presentation.xml 是页序。这里只还原**可验证的结构**：
//   每页 = 形状序列（含占位符类型/文本层级），表格 = 行列网格（合并展开）。
// 不做版式推断、不做视觉还原——那是「把纸猜成字」，本象做「把字变成对象」。
//
// 用法（库）：import { convertPptx } from './pptx.mjs'
// 用法（CLI）：node adapters/office/pptx.mjs <file.pptx> [--json|--stats]

import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

// ── zip 解析（与 import.mjs 同一套最小实现，独立成文件避免循环依赖）──
export function unzipEntry(buf, targetName) {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 zip（找不到 EOCD）')
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const cdCount = buf.readUInt16LE(eocd + 10)
  let off = cdOffset
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('central directory 损坏')
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    if (name === targetName) {
      const dataStart = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28)
      const data = buf.subarray(dataStart, dataStart + compSize)
      return method === 0 ? data : inflateRawSync(data)
    }
    off += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`zip 里没有 ${targetName}`)
}

/** 罗列 zip 里所有 entry 名（用于发现 slideN.xml）。 */
export function zipEntries(buf) {
  const out = []
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 zip')
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const cdCount = buf.readUInt16LE(eocd + 10)
  let off = cdOffset
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('central directory 损坏')
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    out.push(buf.toString('utf8', off + 46, off + 46 + nameLen))
    off += 46 + nameLen + extraLen + commentLen
  }
  return out
}

// ── 迷你 DOM（OOXML 是带命名空间的 XML，够用即可）──
function buildMiniDom(xml) {
  const tagRe = /<(\/?)([a-zA-Z0-9_:]+)((?:\s[a-zA-Z0-9_:]+="[^"]*")*)(\/?)>/g
  const root = { tag: '#root', attrs: {}, children: [] }
  const stack = [root]
  let lastIdx = 0
  let m2
  while ((m2 = tagRe.exec(xml)) !== null) {
    const [full, close, tag, attrStr, selfClose] = m2
    if (m2.index > lastIdx) {
      const txt = xml.slice(lastIdx, m2.index)
      if (txt && stack.length) stack[stack.length - 1].children.push({ tag: '#text', text: txt })
    }
    lastIdx = tagRe.lastIndex
    if (close) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break }
      }
      continue
    }
    const attrs = {}
    const attrRe = /([a-zA-Z0-9_:]+)="([^"]*)"/g
    let am
    while ((am = attrRe.exec(attrStr)) !== null) attrs[am[1]] = am[2]
    const node = { tag, attrs, children: [] }
    if (stack.length) stack[stack.length - 1].children.push(node)
    if (!selfClose && tag !== 'a:br') stack.push(node)
    else if (selfClose) node.selfClose = true
  }
  return root
}

const nsName = (node) => {
  const i = node.tag.indexOf(':')
  return i >= 0 ? node.tag.slice(i + 1) : node.tag
}
const childrenByTag = (node, localName) => node.children.filter((c) => nsName(c) === localName)

/** 形状内全部文本（含嵌套层级；占位符/文本主体的文本都在 a:p > a:r > a:t）。 */
function shapeText(shape) {
  const parts = []
  const walk = (el) => {
    if (!el.children) return
    for (const c of el.children) {
      if (c.tag === '#text') continue
      if (nsName(c) === 't') {
        // 迷你 DOM：a:t 的子节点是 { tag:'#text', text }，文本在这里
        const t = c.children?.find((x) => x.tag === '#text')?.text ?? c.text ?? ''
        parts.push(t)
      }
      else if (nsName(c) === 'br') parts.push('\n')
      else walk(c)
    }
  }
  walk(shape)
  return parts.join('').replace(/\s+/g, ' ').trim()
}

/** 占位符类型（a:ph type 属性）：标题/副标题/正文/图表/表格…缺省 body。
 *  ph 在 sp > nvSpPr > nvPr 深层，递归找。 */
function placeholderType(shape) {
  const found = []
  const find = (el) => {
    if (!el.children) return
    for (const c of el.children) {
      if (nsName(c) === 'ph') found.push(c)
      else find(c)
    }
  }
  find(shape)
  const ph = found[0]
  if (!ph) return 'body'
  return ph.attrs['type'] || (ph.attrs['idx'] !== undefined ? 'body' : 'title')
}

/** 表格：a:tbl > a:tr > a:tc，gridCol 决定列数，gridSpan 展开合并。
 *  tbl 在 graphicFrame > a:graphic > a:graphicData 深层，递归找。 */
function shapeTable(tbl) {
  const found = []
  const find = (el) => {
    if (!el.children) return
    for (const c of el.children) {
      if (nsName(c) === 'tbl') found.push(c)
      else find(c)
    }
  }
  find(tbl)
  const rows = []
  for (const tr of childrenByTag(found[0], 'tr')) {
    const cells = []
    for (const tc of childrenByTag(tr, 'tc')) {
      const tcPr = childrenByTag(tc, 'tcPr')[0]
      let span = 1
      if (tcPr) {
        const gs = childrenByTag(tcPr, 'gridSpan')[0]
        if (gs) span = parseInt(gs.attrs['val'] || '1', 10) || 1
      }
      cells.push(shapeText(tc))
      for (let i = 1; i < span; i++) cells.push('')
    }
    rows.push(cells)
  }
  return rows
}

/** 单张幻灯片的形状序列（文本形状 + 表格形状）。 */
function parseSlide(slideXml) {
  const dom = buildMiniDom(slideXml)
  const out = []
  const walk = (el) => {
    if (!el.children) return
    for (const c of el.children) {
      if (nsName(c) === 'sp') {
        const txt = shapeText(c)
        const type = placeholderType(c)
        out.push({ kind: 'text', type, text: txt })
      } else if (nsName(c) === 'graphicFrame') {
        out.push({ kind: 'table', rows: shapeTable(c) })
      }
      walk(c)
    }
  }
  walk(dom)
  return out
}

/**
 * 解析 pptx → 可验证的结构对象。
 * @returns { slides: [{no, shapes: [{kind, type?, text?|rows?}]}], stats }
 */
export function convertPptx(buf) {
  const names = zipEntries(buf)
  const slideNames = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/slide(\d+)/)[1], 10) - parseInt(b.match(/slide(\d+)/)[1], 10))
  if (!slideNames.length) throw new Error('没有找到 ppt/slides/slideN.xml——不是有效的 pptx')

  const slides = slideNames.map((n, i) => {
    const xml = unzipEntry(buf, n).toString('utf8')
    const shapes = parseSlide(xml)
    const texts = shapes.filter((s) => s.kind === 'text')
    return {
      no: i + 1,
      shapes,
      text_count: texts.length,
      table_count: shapes.filter((s) => s.kind === 'table').length,
    }
  })

  const stats = {
    slides: slides.length,
    shapes: slides.reduce((a, s) => a + s.shapes.length, 0),
    tables: slides.reduce((a, s) => a + s.table_count, 0),
    textShapes: slides.reduce((a, s) => a + s.text_count, 0),
    chars: slides.reduce((a, s) => a + s.shapes.filter((x) => x.kind === 'text').reduce((b, x) => b + x.text.length, 0), 0),
  }
  return { slides, stats }
}

// ── CLI ──
function main() {
  const [file, arg2] = process.argv.slice(2)
  if (!file) {
    console.error('用法: node adapters/office/pptx.mjs <file.pptx> [--json|--stats]')
    process.exit(2)
  }
  const { slides, stats } = convertPptx(readFileSync(file))
  if (arg2 === '--stats') console.log(JSON.stringify(stats, null, 2))
  else if (arg2 === '--json') console.log(JSON.stringify({ stats, slides }, null, 2))
  else {
    for (const s of slides) {
      console.log(`\n## 第 ${s.no} 页（${s.shapes.length} 个形状）`)
      for (const sh of s.shapes) {
        if (sh.kind === 'text' && sh.text) console.log(`[${sh.type}] ${sh.text.slice(0, 120)}`)
        else if (sh.kind === 'table') console.log(`[表格 ${sh.rows.length}×${Math.max(...sh.rows.map((r) => r.length))}] ${JSON.stringify(sh.rows.slice(0, 2), null, 1).slice(0, 200)}`)
      }
    }
    console.error(`\n${stats.slides} 页 / ${stats.shapes} 形状 / ${stats.tables} 表 / ${stats.chars} 字`)
  }
}

if (process.argv[1] && (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('pptx.mjs'))) {
  main()
}
