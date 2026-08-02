#!/usr/bin/env node
// 统一重打分：用当前规则给所有已存结果重新计分。
//
// 为什么必需：判分规则会随实验推进而修补（新增 premature-state、修误报等）。
// 结果文件里的 w1 是**跑那一轮时**的规则算出来的，不同轮次口径可能不一致。
// 正文已存盘，重打分不需要任何 API 调用——横向比较前必须先做这一步。
//
//   node eval/rescore.mjs            重打分并输出汇总
//   node eval/rescore.mjs --write    同时把新分数写回结果文件

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { scoreW1 } from './ced.mjs'
import { scoreW3 } from './state-diff.mjs'

const HERE = dirname(dirname(fileURLToPath(import.meta.url)))
const DIR = join(HERE, 'results')
const write = process.argv.includes('--write')

const files = readdirSync(DIR).filter((f) => /^a[03]-bailian-rep\d+\.json$/.test(f)).sort()
if (!files.length) { console.error('✗ results/ 下没有 rep 结果文件'); process.exit(1) }

const rows = []
for (const f of files) {
  const path = join(DIR, f)
  const d = JSON.parse(readFileSync(path, 'utf8'))
  const chapters = d.result.chapters.filter((c) => c.text)
  const w1 = scoreW1({ arm: d.result.arm, chapters })
  const w3 = scoreW3(d.result)
  if (write) writeFileSync(path, JSON.stringify({ ...d, w1, w3, rescored: true }, null, 2))
  rows.push({
    arm: f.startsWith('a0') ? 'A0' : 'A3',
    rep: Number(f.match(/rep(\d+)/)[1]),
    done: chapters.length,
    review: (d.result.gate?.needsReview ?? []).length,
    errOld: d.w1.errors,
    err: w1.errors,
    epc: w1.epc,
    w3: w3.stateAccuracy,
    tok: d.result.usage.inputTokens + d.result.usage.outputTokens,
  })
}

rows.sort((a, b) => a.arm.localeCompare(b.arm) || a.rep - b.rep)
console.log(`# 统一重打分（当前规则）· ${rows.length} 轮\n`)
console.log('  臂   次  完成  待复核  原错误→新  EPC    W3     Token')
for (const r of rows)
  console.log(
    `  ${r.arm}  ${String(r.rep).padStart(2)}   ${r.done}/5     ${r.review}      ${String(r.errOld).padStart(2)}→${String(r.err).padStart(2)}   ` +
      `${r.epc.toFixed(2)}  ${(r.w3 * 100).toFixed(0).padStart(3)}%  ${r.tok}`
  )

const stat = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const mean = s.reduce((a, b) => a + b, 0) / s.length
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length)
  return { mean, sd, min: s[0], max: s.at(-1), median: s[Math.floor(s.length / 2)], n: s.length }
}

console.log('')
const groups = {}
for (const r of rows) (groups[r.arm] ??= []).push(r)
for (const [arm, g] of Object.entries(groups)) {
  const e = stat(g.map((r) => r.epc))
  const w = stat(g.map((r) => r.w3))
  const t = stat(g.map((r) => r.tok))
  console.log(
    `  ${arm}（n=${e.n}）：EPC 均 ${e.mean.toFixed(2)} 中位 ${e.median.toFixed(2)} 标准差 ${e.sd.toFixed(2)} [${e.min.toFixed(2)}–${e.max.toFixed(2)}]` +
      `｜W3 ${(w.mean * 100).toFixed(1)}%｜Token 均 ${Math.round(t.mean)}`
  )
}

// 判定：区间重叠即视为不可区分；同时看均值与中位数是否一致地指向同一方
const a0 = groups.A0 ? stat(groups.A0.map((r) => r.epc)) : null
const a3 = groups.A3 ? stat(groups.A3.map((r) => r.epc)) : null
if (a0 && a3 && a0.n >= 3 && a3.n >= 3) {
  console.log('')
  const complete = groups.A3.every((r) => r.done === 5)
  const overlap = a3.min <= a0.max && a0.min <= a3.max
  const meanBetter = a3.mean < a0.mean
  const medianBetter = a3.median < a0.median
  console.log(`  前置（A3 每轮产出全部章节）：${complete ? '✓' : '✗'}`)
  console.log(`  EPC：A3 均 ${a3.mean.toFixed(2)} vs A0 均 ${a0.mean.toFixed(2)}；中位 ${a3.median.toFixed(2)} vs ${a0.median.toFixed(2)}`)
  console.log(`  区间：${overlap ? '重叠' : '不重叠'}（A3 [${a3.min.toFixed(2)}–${a3.max.toFixed(2)}]，A0 [${a0.min.toFixed(2)}–${a0.max.toFixed(2)}]）`)
  console.log(
    `  Gate 0：${
      !complete ? '未通过 —— 任务未完成'
      : meanBetter && medianBetter && !overlap ? '通过'
      : meanBetter && medianBetter ? '倾向通过，但区间重叠 —— 需更大样本或更强判分通道方可断言'
      : '未通过 —— 停止扩大规模，回头改架构'
    }`
  )
}
