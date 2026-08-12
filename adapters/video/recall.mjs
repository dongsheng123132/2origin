#!/usr/bin/env node
// 粗筛召回测量 —— 兑现 triage.json 里的 T-RECALL-UNKNOWN
//
// 拿 timeline.origin.json 当参照，量 triage 的候选窗口保住了多少价值。
//
// ⚠ 诚实边界（bugscope A2）：参照本身是 basis=asserted，是同一个模型早先打的分。
//    这是「用自己的判断检验自己的筛子」，**不是外部判据**。
//    它能发现的是"筛子和我自己的判断不一致"，发现不了"我们俩一起错了"。

import { readFileSync } from 'node:fs'

const tl = JSON.parse(readFileSync(process.argv[2] ?? 'timeline.origin.json', 'utf8'))
const tr = JSON.parse(readFileSync(process.argv[3] ?? 'triage.json', 'utf8'))

if (tl.source.sha256 !== tr.source.sha256) {
  console.error(`✗ 两份表示描述的不是同一条素材：${tl.source.sha256.slice(0, 8)} vs ${tr.source.sha256.slice(0, 8)}`)
  process.exit(1)
}

const ov = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1))
const cand = tr.candidates.map(w => w.t)
const keptS = cand.reduce((a, [s, e]) => a + (e - s), 0)

console.log(`参照: ${tl.events.length} 个事件 / 粗筛: ${cand.length} 个候选窗口 (${keptS.toFixed(0)}s, ${(keptS / tr.source.duration_s * 100).toFixed(0)}% 素材)`)
console.log(`⚠ 参照 basis=asserted，非外部判据。见本文件头部。`)
console.log('')
console.log('事件            价值   被覆盖   状态')
console.log('─'.repeat(56))

let wSum = 0, wCov = 0
const missed = []
for (const e of tl.events) {
  const [s, x] = e.t, span = x - s
  const cov = cand.reduce((a, [cs, ce]) => a + ov(s, x, cs, ce), 0)
  const ratio = cov / span
  wSum += e.value * span
  wCov += e.value * cov
  const flag = ratio >= 0.6 ? '✓ 保住' : ratio > 0 ? '~ 只剩一角' : '✗ 全丢'
  if (e.value >= 0.7 && ratio < 0.6) missed.push({ e, ratio })
  console.log(
    `${e.id} ${String(e.t[0]).padStart(4)}–${String(e.t[1]).padEnd(4)}  ` +
    `${e.value.toFixed(2)}  ${(ratio * 100).toFixed(0).padStart(4)}%   ${flag}  ${e.role}`)
}

console.log('─'.repeat(56))
console.log(`价值加权召回: ${(wCov / wSum * 100).toFixed(1)}%   （随机抽同样时长的期望值 ≈ ${(keptS / tr.source.duration_s * 100).toFixed(1)}%）`)

// 精确率：留下来的秒数里，有多少落在高价值事件上；有多少落在必须剔除的负面素材上
let good = 0, bad = 0
for (const [cs, ce] of cand) {
  for (const e of tl.events) {
    const o = ov(cs, ce, e.t[0], e.t[1])
    if (e.value >= 0.7) good += o
    if (e.value <= 0.3) bad += o
  }
}
console.log(`候选精确率:   ${(good / keptS * 100).toFixed(1)}% 的候选秒数落在高价值事件(≥0.7)上`)
console.log(`误纳负面素材: ${(bad / keptS * 100).toFixed(1)}% 的候选秒数落在必须剔除的低价值事件(≤0.3)上`)

if (missed.length) {
  console.log('')
  console.log('✗ 高价值事件被漏掉：')
  for (const { e, ratio } of missed) {
    console.log(`  ${e.id} ${e.t[0]}–${e.t[1]}s value=${e.value} 覆盖 ${(ratio * 100).toFixed(0)}% —— ${e.reason}`)
  }
}

const wr = wCov / wSum, base = keptS / tr.source.duration_s
console.log('')
if (wr < base * 1.15) {
  console.log(`判定：粗筛无效。加权召回 ${(wr * 100).toFixed(1)}% 相对随机基线 ${(base * 100).toFixed(1)}% 没有实质增益。`)
  process.exit(1)
} else {
  console.log(`判定：粗筛有效，相对随机基线增益 ${((wr / base - 1) * 100).toFixed(0)}%。`)
}
