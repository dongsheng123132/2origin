#!/usr/bin/env node
// 接触度校正：EPC 的分母是章数，但错误只能在正文**真的碰了可判事件**的地方产生。
//
// 起因：A1（向量 RAG）前三轮 EPC 0.07，低于 A3 的 0.16。查触发词分布发现
// A0/A1 的正文里「月台/空间门」出现次数为 0——`rule:gate-time` 在它们身上
// 永远不可能发火；「铜铃」「白遥左手」的接触率也只有 A3 的 1/4 ~ 1/7。
//
// 这是 Run #4「多写字刷低 CED」的同型问题，只是更隐蔽：
//   Run #4 是把分母做大，这里是把**分子的机会**做小。
//   一个从不提钥匙、从不写开门、从不让白遥动手的续写，确定性通道判它零错误。
//
// 所以除 EPC 外必须同时报「每百次接触的错误数」。两个指标一起看才有意义：
//   接触少而错误少 → 回避，不是正确
//   接触多而错误少 → 真正的一致性
//
//   node eval/engagement.mjs

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { scoreW1 } from './ced.mjs'

const HERE = dirname(dirname(fileURLToPath(import.meta.url)))
const DIR = join(HERE, 'results')

// 每条触发词对应一条确定性规则能否发火。刻意用宽松匹配：
// 宁可高估接触度（对 A3 不利），也不要造出「A3 接触多」的假象。
const TRIGGERS = {
  'rule:key-once': /黑钥|钥匙/g,
  'rule:bell-birds': /铜铃|铃(?:响|声|鸣)/g,
  'rule:left-hand': /白遥|左手/g,
  'rule:zhao-qi-alive': /赵七/g,
  'rule:gate-time': /月台|空间门|正午|午时|晌午|月落/g,
}

// 级别隔离：S 与 M 的考题、答案集、语料都不同，接触度不可跨级并列。
//   node eval/engagement.mjs           S 级
//   node eval/engagement.mjs --task-m  M 级
const isM = process.argv.includes('--task-m')
const PATTERN = isM ? /^a\d-m-bailian-(?:rep\d+|clean)\.json$/ : /^a\d-bailian-rep\d+\.json$/

const rows = {}
for (const f of readdirSync(DIR).filter((f) => PATTERN.test(f))) {
  const arm = f.slice(0, 2).toUpperCase()
  const d = JSON.parse(readFileSync(join(DIR, f), 'utf8'))
  const chapters = d.result.chapters.filter((c) => c.text)
  const text = chapters.map((c) => c.text).join('\n')
  const w1 = scoreW1({ arm, chapters })

  const r = (rows[arm] ??= { n: 0, chars: 0, chapters: 0, errors: 0, contacts: 0, perRule: {} })
  r.n++
  r.chars += text.length
  r.chapters += chapters.length
  r.errors += w1.errors
  for (const [rule, re] of Object.entries(TRIGGERS)) {
    const hits = text.match(re)?.length ?? 0
    r.contacts += hits
    r.perRule[rule] = (r.perRule[rule] ?? 0) + hits
  }
}

console.log(`# 接触度校正 · EPC 与「每百次接触错误数」并列 · ${isM ? 'M 级（第 51-55 章）' : 'S 级（第 11-15 章）'}\n`)
console.log('  臂   轮  均字数   EPC    接触/万字   每百接触错误   规则覆盖')
for (const [arm, r] of Object.entries(rows).sort()) {
  const epc = r.errors / r.chapters
  const per10k = (r.contacts / r.chars) * 10000
  const per100 = r.contacts ? (r.errors / r.contacts) * 100 : NaN
  // 该臂正文里从未出现的触发词 = 这条规则对它是死条款
  const dead = Object.entries(r.perRule).filter(([, v]) => v === 0).map(([k]) => k.replace('rule:', ''))
  console.log(
    `  ${arm}  ${String(r.n).padStart(3)}  ${String(Math.round(r.chars / r.n)).padStart(6)}  ` +
      `${epc.toFixed(2).padStart(5)}  ${per10k.toFixed(1).padStart(8)}  ${per100.toFixed(2).padStart(11)}   ` +
      `${5 - dead.length}/5${dead.length ? `（死条款：${dead.join('、')}）` : ''}`
  )
}

console.log('\n## 分规则接触次数（每万字）')
const arms = Object.keys(rows).sort()
console.log('  规则'.padEnd(22) + arms.map((a) => a.padStart(8)).join(''))
for (const rule of Object.keys(TRIGGERS)) {
  const cells = arms.map((a) => ((rows[a].perRule[rule] / rows[a].chars) * 10000).toFixed(1).padStart(8))
  console.log('  ' + rule.replace('rule:', '').padEnd(20) + cells.join(''))
}

console.log('\n> 接触少而错误少不是正确，是回避。两个指标必须一起读。')
