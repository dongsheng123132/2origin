#!/usr/bin/env node
// 显著性检验：把 Gate 0 的判据从「极差是否重叠」升级为真正的统计检验。
//
// 为什么必须换：极差不是推断工具。A0 十轮里只要有一轮离群高值，它的区间就能
// 把 A3 整个吞掉，于是无论差异多大都判「不可区分」。n=1~3 时用极差是合理的
// 保守占位（那时确实什么都断言不了），n=10 时它变成了纯粹的迟钝。
//
// 换判据的风险要摆在明处：趋势对本项目有利时改判据，本身就是可疑动作。
// 三条约束：① 用常规 α=0.05，不事后挑阈值 ② 新旧判据并列输出，不藏旧的
// ③ 主检验用**轮次**作独立单元（最保守），章级检验只作参考。
//
//   node eval/significance.mjs           比 A0 与 A3
//   node eval/significance.mjs a1 a3     比任意两臂

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { scoreW1 } from './ced.mjs'
import { scoreW3 } from './state-diff.mjs'

const HERE = dirname(dirname(fileURLToPath(import.meta.url)))
const DIR = join(HERE, 'results')
const [armA = 'a0', armB = 'a3'] = process.argv.slice(2).filter((s) => !s.startsWith('--'))

// 级别隔离：S 与 M 考题与答案集都不同，不可跨级并列。
//   node eval/significance.mjs a0 a3            S 级
//   node eval/significance.mjs a0 a3 --task-m   M 级
const isM = process.argv.includes('--task-m')
const TASK = JSON.parse(readFileSync(join(HERE, 'world', 'spec.origin', 'tasks', isM ? 'continuation-m.json' : 'continuation.json'), 'utf8'))

function load(arm) {
  const tag = isM ? '-m' : ''
  const files = readdirSync(DIR).filter((f) => new RegExp(`^${arm}${tag}-bailian-(?:rep\\d+|clean)\\.json$`).test(f))
  return files.map((f) => {
    const d = JSON.parse(readFileSync(join(DIR, f), 'utf8'))
    const chapters = d.result.chapters.filter((c) => c.text)
    return { epc: scoreW1({ arm, chapters }).errors / chapters.length, errors: scoreW1({ arm, chapters }).errors, chapters: chapters.length, w3: scoreW3(d.result, TASK).stateAccuracy }
  })
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

/**
 * 精确置换检验（单侧：B < A）。
 * C(20,10)=184756 种分法可以穷举，不必抽样近似——所以这里给的是精确 p 值。
 * 零假设：臂标签与结果无关，观测到的差距只是把 20 个数随机分成两堆的结果。
 */
function permutationTest(a, b) {
  const all = [...a, ...b]
  const n = all.length
  const k = a.length
  const observed = mean(a) - mean(b)
  let total = 0
  let atLeast = 0
  const idx = []
  const recurse = (start, chosen) => {
    if (chosen.length === k) {
      const pick = chosen.map((i) => all[i])
      const rest = all.filter((_, i) => !chosen.includes(i))
      total++
      if (mean(pick) - mean(rest) >= observed - 1e-12) atLeast++
      return
    }
    for (let i = start; i < n; i++) {
      chosen.push(i)
      recurse(i + 1, chosen)
      chosen.pop()
    }
  }
  recurse(0, idx)
  return { observed, p: atLeast / total, permutations: total }
}

/** Mann-Whitney U（单侧 B<A），对离群值不敏感，与置换检验互为交叉验证 */
function mannWhitney(a, b) {
  const all = [...a.map((v) => ({ v, g: 'a' })), ...b.map((v) => ({ v, g: 'b' }))].sort((x, y) => x.v - y.v)
  let i = 0
  const ranks = new Array(all.length)
  while (i < all.length) {
    let j = i
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++
    const r = (i + j) / 2 + 1 // 并列取平均秩
    for (let t = i; t <= j; t++) ranks[t] = r
    i = j + 1
  }
  const rankA = all.reduce((s, it, t) => s + (it.g === 'a' ? ranks[t] : 0), 0)
  const uA = rankA - (a.length * (a.length + 1)) / 2
  const uB = a.length * b.length - uA
  return { uA, uB, separated: Math.max(...b) < Math.min(...a) || Math.max(...a) < Math.min(...b) }
}

/** 章级二项检验：总错误数在两臂间的分配是否偏离 50/50（章数相等时成立） */
function binomialTail(k, n, p = 0.5) {
  const logC = (n, k) => {
    let s = 0
    for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i)
    return s
  }
  let sum = 0
  for (let i = k; i <= n; i++) sum += Math.exp(logC(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p))
  return sum
}

const A = load(armA)
const B = load(armB)
if (A.length < 3 || B.length < 3) {
  console.error(`✗ 样本不足：${armA} n=${A.length}，${armB} n=${B.length}（各需 ≥3）`)
  process.exit(1)
}

const ae = A.map((r) => r.epc)
const be = B.map((r) => r.epc)
const aw = A.map((r) => r.w3)
const bw = B.map((r) => r.w3)

console.log(`# 显著性检验 · ${armA.toUpperCase()}(n=${A.length}) vs ${armB.toUpperCase()}(n=${B.length}) · α=0.05 单侧\n`)

console.log(`## W1 · EPC（每章错误数，越低越好）`)
console.log(`  ${armA.toUpperCase()} 均 ${mean(ae).toFixed(3)}  ${armB.toUpperCase()} 均 ${mean(be).toFixed(3)}  差 ${(mean(ae) - mean(be)).toFixed(3)}`)
const pe = permutationTest(ae, be)
console.log(`  精确置换检验：p = ${pe.p.toFixed(5)}（穷举 ${pe.permutations} 种分法）→ ${pe.p < 0.05 ? '✓ 显著' : '✗ 不显著'}`)
const mwe = mannWhitney(ae, be)
console.log(`  Mann-Whitney：U(${armA})=${mwe.uA}  U(${armB})=${mwe.uB}`)
const totA = A.reduce((s, r) => s + r.errors, 0)
const totB = B.reduce((s, r) => s + r.errors, 0)
const chA = A.reduce((s, r) => s + r.chapters, 0)
const chB = B.reduce((s, r) => s + r.chapters, 0)
if (chA === chB) {
  const pb = binomialTail(Math.max(totA, totB), totA + totB)
  console.log(`  章级二项检验（参考）：错误 ${totA} : ${totB} / 各 ${chA} 章，p = ${pb.toExponential(2)}`)
}
console.log(`  旧判据（极差重叠）：${Math.min(...be) <= Math.max(...ae) && Math.min(...ae) <= Math.max(...be) ? '重叠 → 不可区分' : '不重叠 → 可区分'}`)

console.log(`\n## W3 · 状态回写准确率（越高越好）`)
console.log(`  ${armA.toUpperCase()} 均 ${(mean(aw) * 100).toFixed(1)}%  ${armB.toUpperCase()} 均 ${(mean(bw) * 100).toFixed(1)}%`)
const pw = permutationTest(bw, aw)
console.log(`  精确置换检验：p = ${pw.p.toFixed(6)} → ${pw.p < 0.05 ? '✓ 显著' : '✗ 不显著'}`)
const mww = mannWhitney(aw, bw)
if (mww.separated) console.log(`  两臂取值完全不重叠（${armB.toUpperCase()} 每一轮都优于 ${armA.toUpperCase()} 的每一轮）`)

console.log(`\n## 结论`)
const w1sig = pe.p < 0.05 && mean(be) < mean(ae)
const w3sig = pw.p < 0.05 && mean(bw) > mean(aw)
console.log(`  W1：${w1sig ? `${armB.toUpperCase()} 显著优于 ${armA.toUpperCase()}` : '无显著差异'}`)
console.log(`  W3：${w3sig ? `${armB.toUpperCase()} 显著优于 ${armA.toUpperCase()}` : '无显著差异'}`)
