#!/usr/bin/env node
// 无限长小说 · 连载流水线
//
// 「直播式公开跑」的引擎：每次调用续写一章，产出四样东西：
//   ① 正文（narrative/chapters/chNN.txt）
//   ② 世界状态（graph/，事务落盘）
//   ③ 公开快照（public/state-chNN.md，人读的世界状态 + 伏笔图谱）
//   ④ 连载索引（public/index.md，目录 + 字数 + 链接）
//
// 每次运行完把 public/ 提交进 git——读者看到的就是「世界在长」。
//
//   node adapters/story/pipeline.mjs <pkg.origin> --provider hermes [--chapter 12]
//   缺省续写下一章（outline 末尾 + 1）。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadOrigin } from '../../compiler/origin.mjs'
import { projectState, submitChapter, hookGraph, seqOf } from './engine.mjs'
import { createModel } from '../../benchmark/shadowbench-w/arms/lib/model.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

const args = process.argv.slice(2)
const PKG = args[0]
if (!PKG) {
  console.error('用法：node adapters/story/pipeline.mjs <pkg.origin> --provider hermes [--chapter N] [--max-tokens N] [--title 作品名]')
  process.exit(2)
}
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt }
const provider = opt('provider', 'hermes')
const maxTokens = Number(opt('max-tokens', '20000'))
const title = opt('title', basename(PKG))

/** 下一章号：outline 末尾 + 1。 */
function nextChapter(pkg) {
  const outlinePath = join(pkg, 'narrative', 'chapters', 'outline.jsonl')
  if (!existsSync(outlinePath)) return 1
  const rows = readFileSync(outlinePath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  return (rows[rows.length - 1]?.chapter ?? 0) + 1
}

const CHAPTER = args.indexOf('--chapter') >= 0 ? Number(opt('chapter')) : nextChapter(PKG)
const PUBLIC = join(PKG, 'public')
const PREV_PATH = join(PKG, 'narrative', 'chapters', `ch${String(CHAPTER - 1).padStart(2, '0')}.txt`)

// ── 世界快照（人读）：读者能看到的「当前世界」 ──
function renderSnapshot(pkg, chapter) {
  const origin = loadOrigin(pkg)
  const lines = [`# 《${title}》第 ${chapter} 章之后的世界`, '']
  const byType = {}
  for (const [id, f] of Object.entries(origin.state)) (byType[f._type ?? 'object'] ??= []).push([id, f])
  const label = { char: '人物', loc: '地点', obj: '物品', faction: '势力', hook: '伏笔' }
  for (const [type, items] of Object.entries(byType)) {
    lines.push(`## ${label[type] ?? type}（${items.length}）`)
    for (const [id, f] of items) {
      const bits = Object.entries(f)
        .filter(([k, v]) => !['_type', 'name', 'summary'].includes(k) && v !== null && v !== undefined)
        .map(([k, v]) => Array.isArray(v) ? (v.length ? `${k}=[${v.join(', ')}]` : null) : `${k}=${v}`)
        .filter(Boolean)
      lines.push(`- ${id}${f.name ? `（${f.name}）` : ''}${f.summary ? ` ${String(f.summary).slice(0, 40)}` : ''}　${bits.join('；')}`)
    }
  }
  lines.push('', `## 伏笔图谱（seq ${seqOf(pkg)}）`)
  for (const h of hookGraph(pkg)) {
    lines.push(`- ${h.status === 'planted_unresolved' ? '⚠' : h.status === 'resolved' ? '✓' : '·'} ${h.id}　埋于 ch${h.setup_chapter ?? '-'}${h.payoff_chapter ? `，回收于 ch${h.payoff_chapter}` : ''}　${String(h.summary).slice(0, 40)}`)
  }
  lines.push('', `> 由本象协议自动生成。每个值都可追责：\`origin why <pkg> obj.field\`。`)
  return lines.join('\n')
}

// ── 连载索引 ──
function renderIndex(pkg) {
  const outlinePath = join(pkg, 'narrative', 'chapters', 'outline.jsonl')
  const rows = existsSync(outlinePath)
    ? readFileSync(outlinePath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
    : []
  const total = rows.reduce((a, r) => a + (r.chars ?? 0), 0)
  const lines = [
    `# 无限长小说 · 《${title}》`,
    '',
    `> 连载进度：${rows.length} 章 / ${total} 字（${new Date().toISOString().slice(0, 10)}）`,
    '> 世界状态由本象协议持久化：人物/物品/伏笔/时间线都是可追责的对象，不依赖任何聊天记录。',
    '',
    '## 章节',
    '',
    '| 章 | 字数 | 日期 | 正文 | 世界快照 |',
    '|---|---|---|---|---|',
  ]
  for (const r of rows) {
    const n = String(r.chapter).padStart(2, '0')
    lines.push(`| ${r.chapter} | ${r.chars} | ${(r.at ?? '').slice(0, 10)} | [ch${n}.txt](./chapters/ch${n}.txt) | [世界快照](./state-ch${n}.md) |`)
  }
  return lines.join('\n')
}

// ── 主流程 ──
console.log(`《${title}》第 ${CHAPTER} 章｜模型 ${provider}｜max_tokens ${maxTokens}`)
const model = createModel({ provider })
const prevText = (() => { try { return readFileSync(PREV_PATH, 'utf8') } catch { return '' } })()

const state = projectState(PKG, { task: `续写第 ${CHAPTER} 章` })
const prompt = `你是一个长篇小说连载引擎，正在写《${title}》。世界状态已经持久化，现在写第 ${CHAPTER} 章。

【世界状态】（字段值原样照抄，含前缀）
${state}
${prevText ? `\n【上一章结尾】…${prevText.slice(-300)}` : ''}

【写作要求】
1. 写第 ${CHAPTER} 章正文，约 2000-3000 字。承接状态，推进剧情，制造新的张力。
2. 提交本章导致的【世界状态变更】——只写实际发生的改变。
3. 严守禁区（状态里列出的）。
4. 输出单个 JSON 对象（不要其他文字）：
{"chapter":${CHAPTER},"transaction_id":"ch${CHAPTER}-auto","text":"正文","state_changes":[{"object":"obj:x","field":"y","from":"旧值","to":"新值","basis":["scene:${CHAPTER}-01"]}],"assertions":[],"hooks":[]}
state_changes 的 from 填你认为的当前值（写错只记偏差不拒绝）；ID 必须带前缀；无变化给空数组。文字用中文。`

const t0 = Date.now()
let res, ms
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    res = await model.complete({ prompt, maxTokens })
    ms = Date.now() - t0
    if ((res.raw ?? '').trim()) break
    console.error(`  ⚠ 第 ${attempt} 次调用返回空（finish=${res.finishReason ?? '?'}，usage=${JSON.stringify(res.usage ?? {})}），重试…`)
    await new Promise((r) => setTimeout(r, 15000))
  } catch (e) {
    console.error(`  ⚠ 第 ${attempt} 次调用失败：${String(e.message).slice(0, 80)}，重试…`)
    await new Promise((r) => setTimeout(r, 15000))
  }
}
const m = (res?.raw ?? '').match(/\{[\s\S]*\}/)
if (!m) { console.error(`✗ 模型输出非 JSON（${(res.raw ?? '').length} 字符）：${(res.raw ?? '').slice(0, 120)}`); process.exit(1) }
const tx = JSON.parse(m[0])
if (tx.chapter === undefined) tx.chapter = CHAPTER

const r = submitChapter(PKG, tx, { by: `${provider}:pipeline` })
if (!r.ok) {
  console.error(`✗ 门禁拒绝（${r.errors} 条错误）：`)
  for (const v of r.violations) if (v.severity !== 'warning') console.error(`  [${v.code}] ${v.msg}`)
  process.exit(1)
}

// ── 产出四样东西 ──
mkdirSync(join(PKG, 'public'), { recursive: true })
writeFileSync(join(PKG, 'public', `state-ch${String(CHAPTER).padStart(2, '0')}.md`), renderSnapshot(PKG, CHAPTER), 'utf8')
writeFileSync(join(PKG, 'public', 'index.md'), renderIndex(PKG), 'utf8')

console.log(`✓ 第 ${CHAPTER} 章落盘：seq ${r.receipt.seq_from}–${r.receipt.seq_to}，${r.receipt.chars} 字（${ms}ms）`)
for (const ref of r.receipt.changed) console.log(`  状态变更：${ref}`)
for (const w of r.receipt.warnings ?? []) console.log(`  ⚠ ${w.msg}`)
console.log(`  公开快照：public/state-ch${String(CHAPTER).padStart(2, '0')}.md`)
console.log(`  连载索引：public/index.md`)
console.log(`\n下一步：git add 并 commit（公开跑 = 每章一个 commit，历史即证据链）`)
