#!/usr/bin/env node
/**
 * textbook 方言 import.mjs —— 一本「项目任务式」教材 docx → 本象包
 *
 * 零依赖：zip 解析与迷你 DOM 直接复用 office 方言（adapters/office/import.mjs 已导出），
 *         本文件只做教材特有的三件事：
 *           ① 认出 项目/任务/栏目 骨架（office 认的是 章/条，教材里一个都没有）
 *           ② 认出 图1-6 / 表2-3 的图注表注与正文引用，并把图注绑到真实图片资源
 *           ③ 量出排版事实：字号变体、行距变体、图片像素、图片显示尺寸、页数估算
 *
 * 用法：
 *   node adapters/textbook/import.mjs <书.docx> --stats
 *   node adapters/textbook/import.mjs <书.docx> --json
 *   node adapters/textbook/import.mjs <书.docx> --origin <包路径> [--decisions <决定.json>]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { unzipEntry, buildMiniDom, childrenByTag, nsName, miniParaText } from '../office/import.mjs'

// ---------- zip 目录列举（office 的 unzipEntry 只按名取，这里补一个列名） ----------
function listZipEntries(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 zip（找不到 EOCD）')
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const cdCount = buf.readUInt16LE(eocd + 10)
  const names = []
  let off = cdOffset
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    names.push({ name: buf.toString('utf8', off + 46, off + 46 + nameLen), size: buf.readUInt32LE(off + 24) })
    off += 46 + nameLen + extraLen + commentLen
  }
  return names
}

// ---------- 图片像素尺寸（纯 std 读文件头，不解码整张图） ----------
// 为什么必须读真实像素而不信 Word 里的显示尺寸：一张 284px 的图被拉到 12cm 宽，
// 屏幕上看着挺好，300dpi 印出来就是一团糊。责编看的是印出来的样子。
export function imagePixels(data) {
  try {
    if (data[0] === 0x89 && data[1] === 0x50) return { w: data.readUInt32BE(16), h: data.readUInt32BE(20) }
    if (data[0] === 0xff && data[1] === 0xd8) {
      let i = 2
      while (i < data.length - 9) {
        if (data[i] !== 0xff) { i++; continue }
        const m = data[i + 1]
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(m))
          return { h: data.readUInt16BE(i + 5), w: data.readUInt16BE(i + 7) }
        if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue }
        i += 2 + data.readUInt16BE(i + 2)
      }
    }
    if (data.slice(0, 3).toString('latin1') === 'GIF') return { w: data.readUInt16LE(6), h: data.readUInt16LE(8) }
    if (data[0] === 0x42 && data[1] === 0x4d) return { w: Math.abs(data.readInt32LE(18)), h: Math.abs(data.readInt32LE(22)) }
  } catch { /* 头部截断的图当作未知，交给 limits 说明，不猜 */ }
  return null
}

const VECTOR_EXT = new Set(['emf', 'wmf', 'svg', 'eps'])

// ---------- 遍历 body，产出带上下文的条目序列 ----------
const EMU_PER_CM = 360000

function paraFormat(p) {
  const pPr = childrenByTag(p, 'pPr')[0]
  const fmt = {}
  if (pPr) {
    const sp = childrenByTag(pPr, 'spacing')[0]
    if (sp) {
      const line = sp.attrs['w:line']
      if (line) fmt.line = `${line}/${sp.attrs['w:lineRule'] || 'auto'}`
    }
    const ind = childrenByTag(pPr, 'ind')[0]
    if (ind) fmt.ind = ind.attrs['w:firstLineChars'] || ind.attrs['w:firstLine'] || null
    const rPr = childrenByTag(pPr, 'rPr')[0]
    const sz = rPr && childrenByTag(rPr, 'sz')[0]
    if (sz) fmt.size = sz.attrs['w:val']
  }
  // 段内 run 的字号（正文字号以 run 为准，pPr 里那个是段标记的）
  const sizes = []
  const walkRuns = (n) => {
    if (!n.children) return // #text 节点没有 children
    for (const c of n.children) {
      if (nsName(c) === 'r') {
        const rPr = childrenByTag(c, 'rPr')[0]
        const sz = rPr && childrenByTag(rPr, 'sz')[0]
        if (sz) sizes.push(sz.attrs['w:val'])
      }
      walkRuns(c)
    }
  }
  walkRuns(p)
  if (sizes.length) fmt.size = sizes[0]
  fmt.sizes = sizes
  return fmt
}

/**
 * 收集段落里的图片：返回 [{rId, cx, cy}]，cx/cy 是 EMU 显示尺寸。
 *
 * **文档顺序是 `wp:extent` 在前、`a:blip` 在后**（extent 挂在 wp:inline/wp:anchor 上，
 * blip 埋在更深的 a:graphic 里）。所以要先把 extent 存成待用尺寸，等 blip 出现时认领——
 * 反过来「给上一张图补尺寸」会一张都补不上，页数估算直接塌成 1 页（实测栽过）。
 */
function paraImages(p) {
  const out = []
  let pending = null
  const walk = (n) => {
    if (!n.children) return // #text 节点没有 children
    for (const c of n.children) {
      const tag = nsName(c)
      if (tag === 'extent') {
        pending = { cx: parseInt(c.attrs.cx || '0', 10), cy: parseInt(c.attrs.cy || '0', 10) }
      } else if (tag === 'shape' || tag === 'rect') {
        // 老式 VML：尺寸写在 CSS style 里，单位 pt。**别以为 docx 里的图都是 DrawingML**——
        // 实测这本教材 719 张图走 w:pict/v:shape，只有 54 张走 wp:extent。
        // 漏掉 VML 的后果是页数估算塌掉（156 页 vs 真实 285 页），责编那条「260 页以内」就成了假绿。
        const st = c.attrs.style || ''
        const mw = st.match(/width:\s*([\d.]+)pt/)
        const mh = st.match(/height:\s*([\d.]+)pt/)
        if (mw && mh) pending = { cx: Math.round(+mw[1] * 12700), cy: Math.round(+mh[1] * 12700) }
      } else if (tag === 'blip' || tag === 'imagedata') {
        const rId = c.attrs['r:embed'] || c.attrs['r:link'] || c.attrs['r:id']
        if (rId) { out.push({ rId, cx: pending?.cx || 0, cy: pending?.cy || 0 }); pending = null }
      }
      walk(c)
    }
  }
  walk(p)
  return out
}

export function parseTextbook(buf) {
  const dom = buildMiniDom(unzipEntry(buf, 'word/document.xml').toString('utf8'))
  const docEl = childrenByTag(dom, 'document')[0] || dom
  const body = childrenByTag(docEl, 'body')[0] || docEl

  // 关系表：rId → media 文件名
  const rels = new Map()
  try {
    const relXml = unzipEntry(buf, 'word/_rels/document.xml.rels').toString('utf8')
    for (const m of relXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) rels.set(m[1], m[2].replace(/^\/?word\//, ''))
  } catch { /* 没有 rels 的 docx：图片绑定退化为按序号，limits 里已声明绑定是弱判据 */ }

  // 图片资源实测
  const media = new Map()
  for (const e of listZipEntries(buf)) {
    if (!e.name.startsWith('word/media/')) continue
    const short = e.name.replace(/^word\//, '')
    const ext = (short.split('.').pop() || '').toLowerCase()
    let px = null
    if (!VECTOR_EXT.has(ext)) {
      try { px = imagePixels(unzipEntry(buf, e.name)) } catch { px = null }
    }
    media.set(short, {
      file: short, ext, bytes: e.size, vector: VECTOR_EXT.has(ext),
      w: px?.w ?? null, h: px?.h ?? null,
      min_edge: px ? Math.min(px.w, px.h) : null,
      max_edge: px ? Math.max(px.w, px.h) : null,
      in_table: false, captioned: false, used: 0, inline: false,
    })
  }

  // 顺序遍历
  const items = []
  let tblSeq = 0
  const walk = (el, inTable) => {
    if (!el.children) return // #text 节点没有 children
    for (const c of el.children) {
      const tag = nsName(c)
      if (tag === 'tbl') { tblSeq++; items.push({ kind: 'tbl_start', seq: tblSeq }); walk(c, true); items.push({ kind: 'tbl_end', seq: tblSeq }) }
      else if (tag === 'p') {
        const text = miniParaText(c).replace(/\u00a0/g, ' ').trim()
        items.push({ kind: 'p', text, inTable, fmt: paraFormat(c), imgs: paraImages(c) })
      } else if (c.children?.length) walk(c, inTable)
    }
  }
  walk(body, false)
  return { items, media, rels, tables: tblSeq }
}

// ---------- 教材结构识别 ----------
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const cn = (s) => (/^\d+$/.test(s) ? +s : s.length === 2 && s[0] === '十' ? 10 + (CN[s[1]] || 0) : CN[s] || 0)

const RE_PROJ = /^项目\s*([一二三四五六七八九十]|\d+)\s*(.*)$/
const RE_TASK = /^任务\s*([一二三四五六七八九十]|\d+)\s*(.*)$/
// 图注/表注：一个段落里可能并排放两条（「图1-2 测绘对象   图1-3 测绘资料准备」），
// 所以按 2 个以上空白切开再逐段匹配——上一本书里这种并排图注有 6 处，
// 不切开就会被误报成「图1-3 缺图注」。
const RE_CAP = /^(图|表)\s?(\d+(?:[-—.]\d+){1,2})/          // 段首是图号 → 这段是图注
const RE_CAP_G = /(图|表)\s?(\d+(?:[-—.]\d+){1,2})/g       // 段内所有图号（并排图注靠它切）
const RE_REF = /(图|表)\s?(\d+(?:[-—.]\d+){1,2})/g
const SECTION_NAMES = ['任务目标', '知识目标', '能力目标', '技能目标', '素养目标', '任务描述', '任务导入', '情景导入', '知识链接', '任务实施', '任务评价', '任务拓展', '任务测评', '任务分析', '项目目标', '项目简介']
const RE_SECT = new RegExp(`^([【\\[])?(${SECTION_NAMES.join('|')})([】\\]])?$`)

/** 目录行：Word 的 TOC 域会把 PAGEREF/HYPERLINK 指令文本一起吐出来，靠它剔目录最稳 */
const isTocLine = (t) => /PAGEREF|HYPERLINK|TOC \\o/.test(t)

/** 图注 / 表注 / 栏目名 / (a)(b) 组图标注——都不是正文，不参与正文排版统计。 */
const isCaptionLike = (t) => {
  const s = t.trim()
  return /^[图表]\s*\d+\s*[-－—–]/.test(s)
    || /^【?[\u4e00-\u9fa5]{2,8}】$/.test(s)
    || /^[（(]\s*[a-zA-Z]\s*[）)]/.test(s)
}

/**
 * 插图 vs 行内符号的分类规则。**刻意做成数据而不是写死在判据里**，
 * 好让反向用例能换一套规则来打（book/0.1 的做法，照抄）。
 *   inline_max_px         ——  最长边小于它，才可能是行内符号
 *   inline_host_text_len  ——  且所在段落有这么多字，说明它长在正文里，不是独立插图
 */
export const DEFAULT_INLINE_RULES = { inline_max_px: 60, inline_host_text_len: 15 }

export function buildStructure(parsed, { standardSections, inlineRules = DEFAULT_INLINE_RULES }) {
  const { items, media, rels } = parsed
  const figs = new Map()
  const tbls = new Map()
  const projs = new Map()
  const tasks = new Map()
  const sects = []
  const refs = { fig: new Map(), tbl: new Map() }
  const malformed = { fig: [], tbl: [] }

  let curProj = 0
  let curTask = null
  let tableDepth = 0
  const sizeCount = new Map()
  const lineCount = new Map()
  let bodyChars = 0
  let allChars = 0
  let imageAreaCm2 = 0

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind === 'tbl_start') { tableDepth++; continue }
    if (it.kind === 'tbl_end') { tableDepth--; continue }
    const t = it.text
    const inTable = tableDepth > 0

    // 图片资源用量（不论有没有图注都要计，页数估算靠它）。
    // 顺便把「这张图片长在表格里」记到资源对象上——审稿意见⑦ 判的是**图片**在不在表格里，
    // 不是图注：埋在步骤表里的那几百张恰恰一个图注都没有，只判 fig 会全部漏掉。
    for (const im of it.imgs) {
      if (im.cy) imageAreaCm2 += (im.cy / EMU_PER_CM) * ((im.cx || 0) / EMU_PER_CM)
      const target = im.rId && rels.get(im.rId)
      const m = target && media.get(target)
      if (m) {
        m.used = (m.used || 0) + 1
        if (inTable) m.in_table = true
        else m.in_table = m.in_table || false
        // 记下宿主段落的正文长度，遍历完再统一分类（见下方 role 判定）。
        ;(m.host_text_lens ||= []).push(t.length)
        // 这张图长在哪个项目哪个任务里。**报价靠它**：软件截图（重绘即错）与制图原理图
        // （该重绘）差 5 倍工作量，而这两类的分界线基本就是任务边界——
        // 「中望3D建模」那几个任务整章都是截图。curProj/curTask 取的是**本段之前**的值，
        // 正是这张图所属的上下文（项目/任务标题在下面几行才被识别，顺序不能反）。
        if (m.proj == null) { m.proj = curProj; m.task = curTask }
      }
    }
    if (!t) continue
    if (isTocLine(t)) continue // 目录整段跳过

    // 排版事实：只统计正文段（表内文字本来就该小，不参与"正文字号是否统一"的判定）
    //
    // 图注、栏目名、(a)(b) 组图标注**也不是正文**，一并排除。
    // 这是与 108 条行内符号假警同一族的错：把不是靶子的东西拿去判靶子的判据，
    // 结果「行距不统一」永远归不了零——不是稿子没改好，是判据在数不该数的东西。
    // 判据要与施工对齐：normalize.mjs 改的是哪一批，这里就该数哪一批。
    if (!inTable && t.length > 8 && !isCaptionLike(t)) {
      for (const s of it.fmt.sizes || []) sizeCount.set(s, (sizeCount.get(s) || 0) + 1)
      if (it.fmt.line) lineCount.set(it.fmt.line, (lineCount.get(it.fmt.line) || 0) + 1)
      bodyChars += t.length
    }
    allChars += t.length // 页数估算要算全书的字，表格里的字也占版面

    // 项目 / 任务
    const pm = t.match(RE_PROJ)
    if (pm && t.length < 40 && !inTable) {
      curProj = cn(pm[1]); curTask = null
      if (!projs.has(curProj)) projs.set(curProj, { num: curProj, title: pm[2].trim(), tasks: [] })
      continue
    }
    const tm = t.match(RE_TASK)
    if (tm && t.length < 40 && !inTable && curProj) {
      const n = cn(tm[1])
      curTask = `${curProj}-${n}`
      if (!tasks.has(curTask)) {
        tasks.set(curTask, { num: curTask, proj: curProj, title: tm[2].trim(), sections: [], figs: [] })
        projs.get(curProj)?.tasks.push(curTask)
      }
      continue
    }

    // 栏目
    const sm = t.match(RE_SECT)
    if (sm && curTask) {
      sects.push({ task: curTask, kind: sm[2], bracketed: Boolean(sm[1]) })
      tasks.get(curTask)?.sections.push(sm[2])
      continue
    }

    // 图注 / 表注
    //
    // 两种排版同时存在，切法必须同时兼容，否则修好一种就弄坏另一种：
    //   ① 并排两条：「图1-2 测绘对象       图1-3测绘资料准备」
    //   ② 图号与图名之间也是两个空格：「图1-1  精密平口钳」
    // 按空白切会把 ② 的图名切没（实测造出 35 个「图名为空」的假红点）；
    // 所以要按**下一个图号的起点**切：每条图注的名字 = 本图号之后到下一个图号之前。
    let isCaption = false
    if (t.length < 80 && RE_CAP.test(t)) {
      const hits = [...t.matchAll(RE_CAP_G)]
      for (let hi = 0; hi < hits.length; hi++) {
        const cm = hits[hi]
        isCaption = true
        const kind = cm[1] === '图' ? 'fig' : 'tbl'
        const num = cm[2].replace(/[—.]/g, '-')
        const end = cm.index + cm[0].length
        const nextStart = hi + 1 < hits.length ? hits[hi + 1].index : t.length
        const name = t.slice(end, nextStart).replace(/^[\s:：.、]+/, '').trim()
        const level = num.split('-').length
        const store = kind === 'fig' ? figs : tbls
        // 图注挂到哪张图：向前后各 bindingWindow 段找带图片的段落（弱判据，limits 已声明）
        let img = null
        if (kind === 'fig') {
          for (let d = 0; d <= 4 && !img; d++) {
            for (const j of [i - d, i + d]) {
              const cand = items[j]
              if (cand?.kind === 'p' && cand.imgs.length) {
                const rId = cand.imgs[0].rId
                const target = rId && rels.get(rId)
                if (target && media.has(target)) { img = target; break }
              }
            }
          }
        }
        if (!store.has(num)) {
          store.set(num, { num, name, ref: `${cm[1]}${num}`, level, task: curTask, proj: curProj, in_table: inTable, img, dup: 0 })
          if (kind === 'fig' && curTask) tasks.get(curTask)?.figs.push(num)
          if (img && media.has(img)) media.get(img).captioned = true
        } else store.get(num).dup++
        if (level !== 2) malformed[kind].push(num)
      }
    }

    // 正文引用（图注段自身不算引用）
    if (!isCaption) {
      for (const m of t.matchAll(RE_REF)) {
        const kind = m[1] === '图' ? 'fig' : 'tbl'
        const num = m[2].replace(/[—.]/g, '-')
        refs[kind].set(num, (refs[kind].get(num) || 0) + 1)
      }
    }
  }

  // ── 图片分三类，**照抄 book/0.1 的判定，包括它的 OR 逻辑和第三类** ──
  //
  //   inline    行内符号（φ / ± / Ra）：不判分辨率、不要求图注、不算「埋在表格里」
  //   figure    插图：三条都判
  //   unplaced  找不到宿主段落：**不敢判**
  //
  // 三处细节都是上一轮用真数据换来的，别改成看起来更整齐的版本：
  // ① 条件是 OR 不是 AND —— 绝对尺寸小于 60px 就直接是行内，不必再看宿主；
  //    本方言首版写成 AND（且阈值放宽到 120/30），202 张行内符号只捞出 86 张。
  // ② 阈值 60px / 15 字是实测值，不是估计值。
  // ③ unplaced 单列一类。「找不到宿主就当插图判」= 把未知当已知去报警，
  //    是判据最常见的撒谎方式（book/0.1 decisions 原话）。
  for (const m of media.values()) {
    const hosts = m.host_text_lens || []
    if (!hosts.length) m.role = 'unplaced'
    else if (m.max_edge !== null && m.max_edge < inlineRules.inline_max_px) m.role = 'inline'
    else if (Math.min(...hosts) > inlineRules.inline_host_text_len) m.role = 'inline'
    else m.role = 'figure'
    m.inline = m.role === 'inline'
    m.host_text_len = hosts.length ? Math.min(...hosts) : null
  }

  // 引用回填 + 悬空
  for (const [num] of refs.fig) if (figs.has(num)) figs.get(num).referenced = true
  for (const [num] of refs.tbl) if (tbls.has(num)) tbls.get(num).referenced = true
  for (const f of figs.values()) f.referenced = Boolean(f.referenced)
  for (const b of tbls.values()) b.referenced = Boolean(b.referenced)
  const danglingFig = [...refs.fig.keys()].filter((n) => !figs.has(n)).sort()
  const danglingTbl = [...refs.tbl.keys()].filter((n) => !tbls.has(n)).sort()

  // 栏目齐全度
  for (const task of tasks.values()) {
    const have = new Set(task.sections.map((s) => (s === '技能目标' ? '能力目标' : s === '任务导入' ? '情景导入' : s)))
    task.sections_missing = standardSections.filter((s) => !have.has(s))
  }

  // 页数估算：正文字数按小四 2 倍行距每页 ~620 字，图按实际显示面积折算
  // （A4 版心约 15.5 × 24.5 cm = 380 cm²）。估算值，真实页数以排版后为准 —— limits 已声明。
  const PAGE_CHARS = 620
  const PAGE_AREA = 380
  const pagesText = allChars / PAGE_CHARS
  const pagesImg = imageAreaCm2 / PAGE_AREA
  const pages_content = Math.round(pagesText + pagesImg)
  // 排版损耗：图注行、栏目空行、图不跨页造成的留白、表格行高——纯内容估算一律算不到。
  // **标定样本只有 1 本**（《机械零部件测绘及成图技术》：内容估算 200 页，
  // 目录实测约 285 页 → 1.43），这里取 1.35 留一点保守余量。
  // 样本量 1 的系数不该被当成常识，limits 里已声明；再标几本书就该改这个数。
  const LAYOUT_SLACK = 1.35
  const pages_est = Math.round(pages_content * LAYOUT_SLACK)

  return {
    figs, tbls, projs, tasks, sects, media,
    stats: {
      projects: projs.size, tasks: tasks.size, sections: sects.length,
      figs: figs.size, tbls: tbls.size, images: media.size,
      fig_refs: refs.fig.size, tbl_refs: refs.tbl.size,
      dangling_fig_refs: danglingFig, dangling_tbl_refs: danglingTbl,
      malformed_fig_nums: [...new Set(malformed.fig)], malformed_tbl_nums: [...new Set(malformed.tbl)],
      body_chars: bodyChars, all_chars: allChars,
      body_size_variants: sizeCount.size, body_size_top: [...sizeCount].sort((a, b) => b[1] - a[1]).slice(0, 5),
      linespacing_variants: lineCount.size, linespacing_top: [...lineCount].sort((a, b) => b[1] - a[1]).slice(0, 5),
      pages_est, pages_content, pages_text: Math.round(pagesText), pages_img: Math.round(pagesImg),
      figs_in_table: [...figs.values()].filter((f) => f.in_table).length,
      figs_unreferenced: [...figs.values()].filter((f) => !f.referenced).length,
      // 分辨率统计**只算插图**，行内符号与矢量图排除在外——把 φ/±/Ra 算进「印刷必糊」，
      // 会把真错淹掉（book/0.1 首版 108 条假警、本方言首版 202 条假警，同一个毛病两次）
      images_below_800: [...media.values()].filter((m) => m.role === 'figure' && !m.vector && m.max_edge !== null && m.max_edge < 800).length,
      images_below_400: [...media.values()].filter((m) => m.role === 'figure' && !m.vector && m.max_edge !== null && m.max_edge < 400).length,
      illustrations: [...media.values()].filter((m) => m.role === 'figure').length,
      inline_symbols: [...media.values()].filter((m) => m.role === 'inline').length,
      unplaced_images: [...media.values()].filter((m) => m.role === 'unplaced').length,
      // 审稿意见⑦ 与 ② 真正的靶子：埋在步骤表里、且一个图号都没有的那几百张图
      images_in_table: [...media.values()].filter((m) => m.role === 'figure' && m.in_table).length,
      images_without_caption: [...media.values()].filter((m) => m.role === 'figure' && !m.captioned).length,
      images_unused: [...media.values()].filter((m) => !m.used).length,
      sections_bracketed: sects.filter((s) => s.bracketed).length,
    },
  }
}

// ---------- 建包 ----------
export function buildOrigin(st, meta, decisions = []) {
  const objects = []
  const relations = []
  const bookId = `book:${meta.id}`
  const s = st.stats

  objects.push({
    id: bookId, type: 'book', title: meta.title, source: meta.uri,
    projects: s.projects, tasks: s.tasks, figs: s.figs, tbls: s.tbls, images: s.images,
    body_chars: s.body_chars, pages_est: s.pages_est,
    body_size_variants: s.body_size_variants, linespacing_variants: s.linespacing_variants,
    dangling_fig_refs: s.dangling_fig_refs, dangling_tbl_refs: s.dangling_tbl_refs,
  })

  for (const p of st.projs.values()) {
    objects.push({ id: `proj:${p.num}`, type: 'proj', num: p.num, title: p.title, tasks: p.tasks.length, book: bookId })
    relations.push({ subject: `proj:${p.num}`, predicate: 'part_of', object: bookId })
  }
  for (const t of st.tasks.values()) {
    objects.push({ id: `task:${t.num}`, type: 'task', num: t.num, title: t.title, proj: t.proj, figs: t.figs.length, sections_missing: t.sections_missing })
    relations.push({ subject: `task:${t.num}`, predicate: 'part_of', object: `proj:${t.proj}` })
  }
  for (const sc of st.sects) {
    objects.push({ id: `sect:${sc.task}/${sc.kind}`, type: 'sect', kind: sc.kind, task: `task:${sc.task}`, bracketed: sc.bracketed })
    relations.push({ subject: `sect:${sc.task}/${sc.kind}`, predicate: 'part_of', object: `task:${sc.task}` })
  }
  for (const f of st.figs.values()) {
    const id = `fig:${f.num}`
    objects.push({ id, type: 'fig', num: f.num, ref: f.ref, name: f.name, num_level: f.level, task: f.task ? `task:${f.task}` : null, in_table: f.in_table, referenced: f.referenced, img: f.img ? `img:${f.img}` : null })
    if (f.task) relations.push({ subject: id, predicate: 'part_of', object: `task:${f.task}` })
    if (f.img) relations.push({ subject: id, predicate: 'depicts', object: `img:${f.img}` })
  }
  for (const b of st.tbls.values()) {
    const id = `tbl:${b.num}`
    objects.push({ id, type: 'tbl', num: b.num, ref: b.ref, name: b.name, num_level: b.level, task: b.task ? `task:${b.task}` : null, referenced: b.referenced })
    if (b.task) relations.push({ subject: id, predicate: 'part_of', object: `task:${b.task}` })
  }
  for (const m of st.media.values()) {
    // print_min_edge 是**参与印刷分辨率判定的那个数**：行内符号与矢量图为 null，
    // range 谓词对非数值一律不判（constraints.mjs 的既定语义），于是「不判」这件事
    // 是数据说了算，不需要在约束里写例外——约束仍然是一句话，仍然领域无关。
    // 行内符号（φ / ± / Ra）既不需要图注，也谈不上「埋在表格里」，更不该按印刷分辨率判。
    // 「不适用」用取值 n/a 显式表达，而不是让约束去写例外——约束仍是一句话，仍领域无关。
    const printable = m.role === 'figure' && !m.vector
    objects.push({
      id: `img:${m.file}`, type: 'img', file: m.file, ext: m.ext, bytes: m.bytes,
      w: m.w, h: m.h, min_edge: m.min_edge, max_edge: m.max_edge,
      print_min_edge: printable ? m.min_edge : null,
      role: m.role, vector: m.vector, used: m.used, host_text_len: m.host_text_len,
      in_table: m.in_table, captioned: m.captioned,
      proj: m.proj ?? null, task: m.task ?? null,
      caption_status: m.role !== 'figure' ? 'n/a' : m.captioned ? 'ok' : 'missing',
      table_status: m.role !== 'figure' ? 'n/a' : m.in_table ? 'in_table' : 'ok',
    })
  }
  // 责编决定 —— 本方言的重心。它管辖谁，就跟谁连一条 governs。
  for (const d of decisions) {
    const id = `decision:${d.id}`
    objects.push({ id, type: 'decision', text: d.text, source: d.source || null, status: d.status || 'pending', governs: d.governs || [] })
    for (const g of d.governs || []) relations.push({ subject: id, predicate: 'governs', object: g })
  }
  return { objects, relations }
}

async function main() {
  const args = process.argv.slice(2)
  const file = args[0]
  if (!file) {
    console.error('用法: node adapters/textbook/import.mjs <书.docx> [--stats|--json|--origin <包> [--decisions <json>]]')
    process.exit(2)
  }
  const { STANDARD_SECTIONS, textbookManifest, textbookConstraints, textbookLimits } = await import('./dialect.mjs')
  const buf = readFileSync(file)
  const parsed = parseTextbook(buf)
  const st = buildStructure(parsed, { standardSections: STANDARD_SECTIONS })
  const mode = args[1]

  if (mode === '--origin') {
    const pkgDir = args[2] || file.replace(/\.docx$/i, '.origin')
    let decisions = []
    const di = args.indexOf('--decisions')
    if (di > 0 && args[di + 1]) decisions = JSON.parse(readFileSync(args[di + 1], 'utf8'))
    const { initPackage } = await import('../../compiler/store.mjs')
    const base = basename(file).replace(/\.docx$/i, '')
    const { objects, relations } = buildOrigin(st, { id: base, title: base, uri: file }, decisions)
    initPackage(pkgDir, {
      manifest: textbookManifest({ id: base, title: base, uri: file }),
      objects, relations,
      constraints: textbookConstraints(),
      limits: textbookLimits(),
    })
    console.error(`已建本象包 ${pkgDir}（${objects.length} 对象 / ${relations.length} 关系 / ${st.stats.figs} 图 / ${st.stats.tasks} 任务 / ${decisions.length} 条决定）`)
  } else if (mode === '--json') {
    console.log(JSON.stringify({
      stats: st.stats,
      figs: [...st.figs.values()], tbls: [...st.tbls.values()],
      tasks: [...st.tasks.values()], projs: [...st.projs.values()],
    }, null, 1))
  } else {
    console.log(JSON.stringify(st.stats, null, 1))
  }
}

if (process.argv[1] && process.argv[1].endsWith('import.mjs') && process.argv[1].includes('textbook')) main()
