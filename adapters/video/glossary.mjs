#!/usr/bin/env node
// 术语库 —— 字幕工具里唯一会随时间增值的东西
//
// ## 为什么它是本境，不是影核
//
// 按 RFC-0000 的分层：
//   本象  世界表示（这条视频里说了什么）—— 每条素材各一份，用完就是历史
//   影核  改变世界（生成 srt 文件）—— 一次性动作
//   本境  这台机器学会的一切 —— **跨素材、跨会话、越用越多**
//
// 「Hermes 被听成欧莫斯」这件事，改一次不该只对这一条视频有效。
// 它是这台机器关于"这个人讲话时会提到哪些词"的**学历**，属于本境。
//
// 一次性转写谁都能做，剪映免费还内置。会积累的术语库不能——
// 它跟着**具体的人、具体的公司、具体的行业**长，别人复制不走。
//
// 用法:
//   node glossary.mjs learn <diff.json>          # 从人工确认过的改动里学
//   node glossary.mjs add "欧莫斯" "Hermes"        # 手工加一条
//   node glossary.mjs apply <x.srt> [--write]    # 确定性替换（不经模型）
//   node glossary.mjs hint                        # 导出给 ASR/omni 用的提示串
//   node glossary.mjs list

import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const GF = process.env.ORIGIN_GLOSSARY ?? 'glossary.json'
const load = () => existsSync(GF) ? JSON.parse(readFileSync(GF, 'utf8')) : {
  $schema: 'origin/dialect-video/glossary/v0.1',
  note: '本境层：跨素材累积的术语表。每条都记来源与确认状态——未确认的不参与自动替换。',
  terms: [],
}
const save = d => writeFileSync(GF, JSON.stringify(d, null, 2))

const [cmd, ...rest] = process.argv.slice(2)
const g = load()
const key = t => `${t.wrong}→${t.right}`

if (cmd === 'add') {
  const [wrong, right] = rest
  if (!wrong || !right) { console.error('用法: glossary.mjs add <错的> <对的>'); process.exit(2) }
  const ex = g.terms.find(t => t.wrong === wrong && t.right === right)
  if (ex) { ex.hits = (ex.hits ?? 0) + 1; ex.confirmed = true }
  else g.terms.push({ wrong, right, hits: 1, confirmed: true, source: '人工录入', as_of: rest[2] ?? null })
  save(g)
  console.log(`已记住：${wrong} → ${right}（共 ${g.terms.length} 条）`)

} else if (cmd === 'learn') {
  // 从 srt.mjs 的改动清单里挖候选。**只挖候选，不自动确认**——
  // 两条通道都可能错（实测过：字幕「海报」vs ASR「还是」，无法判定谁对）。
  const d = JSON.parse(readFileSync(rest[0], 'utf8'))
  let found = 0
  for (const c of d.changes ?? []) {
    // 只取"含拉丁字母的词被改出来"这类高置信信号：中文同音字→英文原名
    const latin = [...(c.refined.match(/[A-Za-z][A-Za-z0-9.\-]{2,}/g) ?? [])]
    for (const w of latin) {
      if (c.asr.includes(w)) continue                       // ASR 本来就对，不算学到
      const t = g.terms.find(x => x.right === w)
      if (t) { t.hits++; continue }
      g.terms.push({
        wrong: null, right: w, hits: 1, confirmed: false,
        source: `${rest[0]} @ ${c.t[0]}s`, context: c.refined.slice(0, 40),
      })
      found++
    }
  }
  save(g)
  console.log(`从 ${d.changes?.length ?? 0} 条改动里挖出 ${found} 个新候选（confirmed=false，需人工确认后才参与替换）`)
  console.log(`确认命令：node glossary.mjs add "<ASR听成的>" "<正确的>"`)

} else if (cmd === 'apply') {
  const f = rest[0]
  if (!f || !existsSync(f)) { console.error('用法: glossary.mjs apply <x.srt> [--write]'); process.exit(2) }
  let s = readFileSync(f, 'utf8')
  const use = g.terms.filter(t => t.confirmed && t.wrong)
  let n = 0
  for (const t of use) {
    const re = new RegExp(t.wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
    const c = (s.match(re) ?? []).length
    if (c) { s = s.replace(re, t.right); n += c }
  }
  console.log(`${use.length} 条已确认术语，命中替换 ${n} 处`)
  if (rest.includes('--write')) { writeFileSync(f, s); console.log(`已写回 ${f}`) }
  else console.log('加 --write 写回。')

} else if (cmd === 'hint') {
  // 给 ASR 热词表 / omni 提示词用。已确认的排前面。
  const names = [...new Set(g.terms.filter(t => t.confirmed).map(t => t.right)
    .concat(g.terms.filter(t => !t.confirmed).map(t => t.right)))]
  console.log(names.join(', '))

} else if (cmd === 'list' || !cmd) {
  const c = g.terms.filter(t => t.confirmed).length
  console.log(`${GF}：${g.terms.length} 条（已确认 ${c}，待确认 ${g.terms.length - c}）\n`)
  for (const t of g.terms.sort((a, b) => (b.hits ?? 0) - (a.hits ?? 0))) {
    console.log(`  ${t.confirmed ? '✓' : '?'} ${(t.wrong ?? '（未知误听）').padEnd(12)} → ${String(t.right).padEnd(16)} ×${t.hits ?? 1}  ${t.context ?? t.source ?? ''}`)
  }
  console.log('')
  console.log('? = 只知道正确写法、还不知道 ASR 会把它听成什么，暂不参与自动替换')
  console.log('  见到误听后用 add 补上，那一条才开始产生复利')

} else {
  console.error('用法: glossary.mjs [learn <diff.json> | add <错> <对> | apply <srt> [--write] | hint | list]')
  process.exit(2)
}
