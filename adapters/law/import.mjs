#!/usr/bin/env node
// 裁判文书 → 本象包。
//
//   node adapters/law/import.mjs <判决书.txt> <包路径> [--lawdb 条文库.json]
//   node compiler/cli.mjs diagnose <包路径>
//
// 导入即这个世界的诞生：案件、事实、证据、情节、引用全部写进 graph/objects.jsonl，
// 此后每一次改动以事务追加，于是「这个刑期凭什么是这个刑期」永远查得出。
//
// ## 导入器只做一件事：把判定所需的分类**物化成字段**
//
// 判定本身留给核心那十个领域无关的谓词。具体来说，导入器负责：
//   ① 把每处法条引用解析出来，到条文库里查它的 kind（法律/司法解释/规章/司法文件）
//      与效力区间，物化成 cite:*.status ∈ ok | not-found | expired | not-citable
//   ② 把量刑评议表里的情节、比例、证据物化成 factor:* 对象
//   ③ 按指导意见的「同向相加、逆向相减」复算一遍，物化成 case:*.宣告刑偏离
//   ④ 把说理段与主文里的数字物化成 mention:* 对象，期望值取自认定事实
//
// 这四步之后，A 类（引用）、C 类（证据支撑）、D 类（数字可复算）全部变成
// in / range / exists / equals / unique / contains 这几条通配约束——
// **compiler/ 一行没改**。这跟 CAD 方言把图层编进 ID 是同一个手法。

import { readFileSync, existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initPackage, appendHistory } from '../../compiler/store.mjs'
import { lawConstraints, LAW_MANIFEST, adjust, KIND_CN, lawLimits } from './dialect.mjs'
import { splitSections, parseCaseNo, cnDate, extractCitations, parseWorksheet, extractAmounts, extractTerms } from './parse.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 条文库：id → { kind, title, article, effective_from, effective_to }。 */
export function loadLawDb(path = join(HERE, 'lawdb.json')) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const byId = new Map()
  const byTitle = new Map()
  for (const e of raw.entries) {
    byId.set(e.id, e)
    const key = `${e.title}|${e.article}`
    byTitle.set(key, e)
    // 判决书里几乎不写全称的简称形式也要认——「刑法」「刑事诉讼法」「民法典」。
    // 这是协议第 7 条原则（ID 必须自带归一化层）在法条上的落点：
    // 语义上毫无歧义的写法被严格匹配拒之门外，是接口刁难，不是文书缺陷。
    const short = e.title.replace(/^中华人民共和国/, '')
    if (short !== e.title) byTitle.set(`${short}|${e.article}`, e)
  }
  // closedWorld 缺省 false：**不敢自称完备的库，不许说别人伪造**。
  return { byId, byTitle, kinds: raw._kinds ?? {}, closedWorld: raw.closed_world === true }
}

const slug = (s) => String(s ?? '').replace(/[\s:/*《》（）()]+/g, '').slice(0, 24)

/**
 * 一处引用的体检结论。**一个缺陷只产生一条结论**——
 * 把「查无此条」同时报成「不可引」和「已失效」，等于把一个问题说成三个，
 * 几次之后没人会再看体检结果。
 */
export function judgeCitation(c, { db, at, whitelist, position }) {
  const hit = db.byTitle.get(`${c.title}|${c.article}`)
  // 「我们库里没有」和「这条法条不存在」是两件事，判成同一件事就是诬告。
  // 刑法第二百六十四条当然存在，只是不在这份 20 条的样本库里。
  // 只有**自称完备**的库（closed_world）才有资格把「查不到」读成「伪造」；
  // 部分覆盖的库只能如实说「没查」——同 conformance 的 unsupported、
  // 同 intake 的「解析失败不许被读成体检通过」，都是一个形状：
  // **没查 ≠ 查过没问题，也 ≠ 有问题。**
  if (!hit)
    return db.closedWorld
      ? { status: 'not-found', target: null, kind: 'unknown', note: `条文库中查无《${c.title}》第${c.article_cn}条` }
      : { status: 'uncovered', target: null, kind: 'unknown', note: `条文库未覆盖《${c.title}》第${c.article_cn}条——**未校验**，不代表它有问题` }
  const expired = hit.effective_to && at && at >= hit.effective_to
  if (expired) return { status: 'expired', target: hit.id, kind: hit.kind, note: `该文件已于 ${hit.effective_to} 失效` }
  if (hit.effective_from && at && at < hit.effective_from)
    return { status: 'expired', target: hit.id, kind: hit.kind, note: `该文件自 ${hit.effective_from} 起施行，裁判时点尚未生效` }
  // 说理位可以引规章与司法文件（法释〔2009〕14号第六条），裁判依据位不行。
  if (position === '裁判依据' && !whitelist.includes(hit.kind))
    return { status: 'not-citable', target: hit.id, kind: hit.kind, note: `${KIND_CN[hit.kind]}不得作为本案的裁判依据，只能用于说理` }
  return { status: 'ok', target: hit.id, kind: hit.kind, note: null }
}

/**
 * @param staged 生成模式：只导入事实、证据、情节、引用，**不导入量刑结果**。
 *   量刑随后由 sentence.mjs 以语义事务逐步提交，于是 `origin why` 查得出
 *   「这个刑期凭什么是这个刑期」。缺省 false = 审计模式，把既成文书整份物化后体检。
 */
export function judgmentToPackage(text, { db, name, staged = false }) {
  const sec = splitSections(text)
  const head = parseCaseNo(sec.首部 + (sec.查明 ?? '')) ?? { 案号: name, 类型: '刑事', 年份: null }
  // 裁判时点取**落款日期**：它决定所引条文当时是否有效。首部里的出生日期、案发日期
  // 都长得一样，所以先在主文段（含落款）里找，找不到再退回全文取最后一个。
  const judgedAt = cnDate(sec.主文 ?? '') ?? cnDate(text)
  const caseId = `case:${head.案号.replace(/[（）()]/g, '')}`
  const caseType = head.类型
  const whitelist = { 刑事: ['law', 'interp'], 民事: ['law', 'interp', 'adminreg', 'localreg'], 行政: ['law', 'interp', 'adminreg', 'localreg', 'adminrule'] }[caseType]

  const objects = []
  const relations = []
  const notes = []

  // ── 证据：按文书里的列举顺序编号，与卷内顺序一致 ──
  const evidence = []
  for (const line of (sec.证据 ?? '').split('\n')) {
    const m = line.trim().match(/^([0-9０-９一二三四五六七八九十]+)\s*[.．、]\s*(.+?)[；;。]?$/)
    if (!m) continue
    const id = `evidence:E-${String(evidence.length + 1).padStart(2, '0')}`
    evidence.push(id)
    objects.push({ id, type: 'evidence', ordinal: evidence.length, content: m[2].trim(), case: caseId })
  }

  // ── 认定事实：金额是最常被两处记账的那个数 ──
  const factAmounts = extractAmounts(sec.查明 ?? '')
  const 认定金额 = factAmounts[0]?.value ?? null
  objects.push({
    id: 'fact:F-01', type: 'fact', case: caseId,
    statement: (sec.查明 ?? '').replace(/\s+/g, '').slice(0, 80),
    ...(认定金额 !== null ? { amount: 认定金额 } : {}),
    evidence, // 「每条事实必须附证据引用」——核心约束里本来就有的那条
  })

  // ── 引用：裁判依据位与说理位分开，因为可引范围不同 ──
  const cites = []
  const citedAsBasis = []
  for (const [position, src] of [['说理', sec.说理], ['裁判依据', sec.依据]]) {
    for (const c of extractCitations(src ?? '')) {
      const v = judgeCitation(c, { db, at: judgedAt, whitelist, position })
      // ID 里带上被引文件与条号——违规消息才能自解释（CAD 把图层编进 ID 是同一个理由）
      const id = `cite:${position}/${slug(c.title.replace(/^(中华人民共和国|最高人民法院、最高人民检察院|最高人民法院)/, ''))}-${c.article}`
      cites.push(id)
      objects.push({
        id, type: 'cite', case: caseId, position,
        raw: c.raw, target: v.target, target_kind: v.kind, status: v.status,
        ...(c.clause ? { clause: c.clause } : {}),
        ...(v.note ? { note: v.note } : {}),
      })
      if (v.target) relations.push({ subject: caseId, predicate: 'cites', object: v.target })
      if (position === '裁判依据' && v.target) citedAsBasis.push(v.target)
    }
  }

  // 被引条文本身也进包——**原文是本源，AI 对法条的转述是投影**（docs/03 原则三）。
  // 包里带着自己依据的那几条，才能在任何时候复核「判决说的和条文写的是不是一回事」；
  // 只留一个 ID 指向外部库，等于把证据链的最后一段交给了别人。
  const norms = new Set(objects.filter((o) => o.type === 'cite').map((o) => o.target).filter(Boolean))
  for (const id of norms) {
    const e = db.byId.get(id)
    if (e) objects.push({ id, type: 'norm', kind: e.kind, title: e.title, article: e.article, brief: e.brief ?? null, effective_from: e.effective_from ?? null, effective_to: e.effective_to ?? null })
  }

  // ── 量刑：判决书里没有，来自办案系统的量刑评议表 ──
  const ws = parseWorksheet(sec.评议)
  const factorNames = []
  let 调节后 = null, 偏离 = null, 合计 = null
  if (ws) {
    const used = new Map()
    for (const f of ws.factors) {
      const n = (used.get(f.name) ?? 0) + 1
      used.set(f.name, n)
      // 重复评价不合并、不丢弃——合并就看不见重复了，而重复评价本身正是要查的缺陷
      const id = `factor:${f.name}${n > 1 ? `-${n}` : ''}`
      factorNames.push(f.name)
      objects.push({
        id, type: 'factor', case: caseId, name: f.name, ratio: f.ratio,
        ...(f.basis ? { basis: f.basis } : {}),
        ...(f.law_text ? { law_text: f.law_text } : {}),
      })
      for (const e of f.basis ?? []) relations.push({ subject: id, predicate: 'based_on', object: e })
    }
    if (Number.isFinite(ws.基准刑) && ws.基准刑 > 0) {
      const r = adjust(ws.基准刑, ws.factors.map((f) => f.ratio))
      合计 = Math.round(r.total * 10000) / 10000
      调节后 = Math.round(r.adjusted * 100) / 100
      if (Number.isFinite(ws.拟宣告刑) && 调节后 > 0)
        偏离 = Math.round((Math.abs(ws.拟宣告刑 - 调节后) / 调节后) * 10000) / 10000
    }
  } else {
    notes.push('未提供【量刑评议表】——量刑起点、基准刑、各情节调节比例不在判决书正文里，故 D 类（数字可复算）约束因字段缺失而未校验。这不是体检通过。')
  }

  objects.unshift({
    id: caseId, type: 'case', 案号: head.案号, 案件类型: caseType, 裁判日期: judgedAt,
    cited_as_basis: citedAsBasis,
    ...(认定金额 !== null ? { 认定金额 } : {}),
    ...(ws?.法定刑幅度 ? { 法定刑幅度: ws.法定刑幅度 } : {}),
    ...(Number.isFinite(ws?.起点) ? { 量刑起点月: ws.起点 } : {}),
    ...(Number.isFinite(ws?.基准刑) ? { 基准刑月: ws.基准刑 } : {}),
    // 生成模式下这四个值不进出生状态——它们是**推演结果**，必须由事务带着依据产生，
    // 否则「宣告刑凭什么是七个月」在包里永远只有一个答案：凭导入。
    ...(staged ? {} : {
      ...(合计 !== null ? { 调节比例合计: 合计 } : {}),
      ...(调节后 !== null ? { 调节后月: 调节后 } : {}),
      ...(Number.isFinite(ws?.拟宣告刑) ? { 宣告刑月: ws.拟宣告刑 } : {}),
      ...(偏离 !== null ? { 宣告刑偏离: 偏离 } : {}),
    }),
  })

  // ── 正文对照状态：说理段的金额、判决主文的刑期，各自必须等于状态里那一份 ──
  // 只在审计模式下生成：生成模式还没有正文可对照，正文是最后才投影出来的。
  const mentions = []
  if (!staged && 认定金额 !== null)
    for (const [i, a] of extractAmounts(sec.说理 ?? '').entries()) {
      const id = `M-说理金额-${i + 1}`
      mentions.push({ id, expect: 认定金额, where: '本院认为段', label: '涉案金额' })
      objects.push({ id: `mention:${id}`, type: 'mention', case: caseId, where: '说理', label: '涉案金额', value: a.value, raw: a.raw })
    }
  if (!staged && Number.isFinite(ws?.拟宣告刑))
    for (const [i, t] of extractTerms(sec.主文 ?? '').entries()) {
      const id = `M-主文刑期-${i + 1}`
      mentions.push({ id, expect: ws.拟宣告刑, where: '判决主文', label: '刑期（月）' })
      objects.push({ id: `mention:${id}`, type: 'mention', case: caseId, where: '主文', label: '刑期', value: t.value, raw: t.raw })
    }

  const constraints = lawConstraints({ caseId, caseType, mentions, factors: [...new Set(factorNames)] })
  return { objects, relations, constraints, caseId, head, judgedAt, evidence, cites, factorNames, notes, ws }
}

// ── CLI ─────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith('import.mjs') && process.argv[1]?.includes('law')) {
  const [src, dir] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  if (!src || !dir) {
    process.stderr.write('用法：import.mjs <判决书.txt> <包路径> [--lawdb 条文库.json]\n')
    process.exit(2)
  }
  if (!existsSync(src)) { process.stderr.write(`无法导入：${src} 不存在\n`); process.exit(2) }

  const i = process.argv.indexOf('--lawdb')
  const db = loadLawDb(i >= 0 ? process.argv[i + 1] : undefined)
  const text = readFileSync(src, 'utf8')
  const name = basename(src).replace(/\.(txt|md)$/i, '')
  const staged = process.argv.includes('--staged')
  const r = judgmentToPackage(text, { db, name, staged })

  initPackage(dir, { manifest: LAW_MANIFEST(r.caseId, r.head.案号, src), objects: r.objects, relations: r.relations, constraints: r.constraints,
    // 第七要素：这个域里边界声明分量最重——说不清边界的法律工具会被当成「AI 审过了」
    limits: lawLimits({ closedWorld: db.closedWorld, dbSize: db.byId.size,
      uncovered: r.objects.filter((o) => o.citation_status === 'uncovered').length }) })
  appendHistory(dir, [{ event: 'imported', source: src, 案号: r.head.案号, 裁判日期: r.judgedAt, at: new Date().toISOString(), by: 'law-import' }])

  const n = (t) => r.objects.filter((o) => o.type === t).length
  process.stderr.write(
    `导入 ${r.head.案号}（${r.head.类型}，裁判日期 ${r.judgedAt ?? '未识别'}）：` +
    `${n('fact')} 项认定事实、${r.evidence.length} 份证据、${n('factor')} 个量刑情节、${n('cite')} 处法条引用\n`)
  for (const note of r.notes) process.stderr.write('⚠ ' + note + '\n')
  process.stdout.write(dir + '\n')
}
