#!/usr/bin/env node
// 词表补丁的影响面评估——**打补丁之前**先量出来它会动多少东西。
//
//   node eval/patch-impact.mjs
//
// 回答两个必须先回答的问题：
//
//   ① A0/A1/A3 的 W1 分数会往哪边动、动多少？（rescore 能零成本纠正）
//   ② **A3 的门禁行为会不会变？**（rescore 纠正不了，只能重跑）
//
// ② 是关键：`arms/a3-benxiang/commit-compiler.mjs:19` 直接 import 了 `eval/ced.mjs` 的 RULES，
// 所以词表一变，A3 的正文门禁跟着变严。判据很直接——把 A3 **已被门禁放行**的正文
// 喂给补丁版规则：
//
//   - 抓到新违规 → 补丁版门禁当初会退回重写 → A3 的跑法会变 → **必须重跑**
//   - 一条都抓不到 → 补丁对 A3 运行时无影响 → 只需 rescore

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { RULES } from './ced.mjs'
import { loadSpec, replay } from './replay.mjs'
import { PROPOSED } from './vocab-patch-check.mjs'

const HERE = dirname(dirname(fileURLToPath(import.meta.url)))
const DIR = join(HERE, 'results')
const spec = loadSpec()
const { state } = replay(spec, 50)

const provider = process.argv.includes('--provider') ? process.argv[process.argv.indexOf('--provider') + 1] : 'bailian'
const batch = process.argv.includes('--batch') ? process.argv[process.argv.indexOf('--batch') + 1] : 'rep10'

const files = readdirSync(DIR)
  .filter((f) => new RegExp(`^a\\d-m-${provider}-${batch}\\d\\.json$`).test(f))
  .sort()

if (!files.length) {
  console.error(`✗ 没有匹配 a?-m-${provider}-${batch}?.json 的结果`)
  process.exit(1)
}

const curHits = (text) => RULES.flatMap((r) => r.check({ text, state, stateAfter: state, spec, chapter: null }))
const proHits = (text) =>
  Object.entries(PROPOSED)
    .filter(([, fn]) => fn(text, state))
    .map(([id]) => id)

const byArm = {}
for (const f of files) {
  const d = JSON.parse(readFileSync(join(DIR, f), 'utf8'))
  const arm = f.slice(0, 2).toUpperCase()
  ;(byArm[arm] ??= []).push({ f, d })
}

console.log(`# 词表补丁影响面 · provider=${provider} · ${files.length} 份结果\n`)

for (const [arm, rows] of Object.entries(byArm)) {
  let curTotal = 0, proTotal = 0, newlyCaught = []
  for (const { f, d } of rows) {
    for (const ch of d.result.chapters) {
      if (!ch.text) continue
      const c = curHits(ch.text).length
      // 逐规则判，能指出「新抓到的是哪一条」
      const pro = proHits(ch.text)
      curTotal += c
      proTotal += pro.length
      const curIds = new Set(RULES.filter((r) => r.check({ text: ch.text, state, stateAfter: state, spec, chapter: null }).length).map((r) => r.id))
      for (const id of pro) if (!curIds.has(id)) newlyCaught.push({ f: f.match(/rep\d+/)?.[0] ?? f, ch: ch.chapter, id })
    }
  }
  console.log(`## ${arm}（${rows.length} 轮）`)
  console.log(`   现行规则命中章次：${curTotal}　→　补丁版：${proTotal}`)
  console.log(`   **新抓到 ${newlyCaught.length} 处**`)
  const byRule = {}
  for (const n of newlyCaught) (byRule[n.id] ??= []).push(`${n.f}/ch${n.ch}`)
  for (const [id, list] of Object.entries(byRule)) console.log(`     ${id.padEnd(22)} ${list.length} 处  ${list.slice(0, 6).join(' ')}${list.length > 6 ? ' …' : ''}`)
  console.log('')
}

// ── 关键判据 ──
const a3 = byArm.A3 ?? []
let a3New = 0
for (const { d } of a3)
  for (const ch of d.result.chapters) {
    if (!ch.text) continue
    const curIds = new Set(RULES.filter((r) => r.check({ text: ch.text, state, stateAfter: state, spec, chapter: null }).length).map((r) => r.id))
    a3New += proHits(ch.text).filter((id) => !curIds.has(id)).length
  }

console.log('─'.repeat(66))
console.log('判据：A3 **已被门禁放行**的正文里，补丁版规则新抓到几处？')
console.log(`  → ${a3New} 处`)
console.log(
  a3New === 0
    ? '  ✅ 补丁不改变 A3 的门禁行为——只需 rescore，**不必重跑 A3**。'
    : `  ⚠ 补丁版门禁当初会退回重写这 ${a3New} 处 → A3 的跑法会变 → **A3 必须重跑**，rescore 修不掉。`
)
