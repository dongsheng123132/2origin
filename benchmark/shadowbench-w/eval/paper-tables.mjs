#!/usr/bin/env node
// 论文表格重算器：把 §5.1 / §5.2 / §5.2.1 / §5.3 / §5.4 的每一个数字，
// 从落盘的 per-round JSON 现算一遍。
//
// 为什么要有这个脚本：论文承诺「每一格都可从原始数据重算」。
// 但 2026-08-13 之前，那些 p 值是临时用 `node -e` 的蒙特卡洛置换算的 ——
// **无种子**，别人重跑第三位小数就不一样，论文里却写着 p = 0.4774 这种四位数。
// 一个复现不出来的数字，和一个没给出的数字，对读者是一回事。
//
// 本脚本改用 significance.mjs 的口径：**穷举精确置换检验**（C(20,10)=184,756 种分法），
// 确定性、无随机数、任何人任何时候跑都是同一个值。
//
//   node eval/paper-tables.mjs           # 打印全部表格
//   node eval/paper-tables.mjs --json    # 机器可读
//
// 退出码 0。这是报告工具，不是判据 —— 它不该有「通过/失败」。

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { scoreW3 } from './state-diff.mjs'

const HERE = dirname(dirname(fileURLToPath(import.meta.url)))
const TASK = JSON.parse(readFileSync(join(HERE, 'world', 'spec.origin', 'tasks', 'continuation-m.json'), 'utf8'))

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length
const sd = (a) => Math.sqrt(a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / a.length)

/**
 * 精确置换检验：穷举把 a∪b 重新分成 |a| 与 |b| 两组的全部方式，
 * 数有多少种分法的均值差绝对值 ≥ 实测值。双侧。
 *
 * n=10+10 时是 184,756 种，毫秒级。**不用随机抽样** —— 抽样会让 p 值不可复现，
 * 而不可复现的 p 值在一篇讲可核验的论文里是自相矛盾的。
 */
function exactPermutation(a, b) {
  const all = [...a, ...b]
  const k = a.length
  const observed = Math.abs(mean(a) - mean(b))
  const sumAll = all.reduce((s, x) => s + x, 0)
  let total = 0
  let atLeast = 0
  const idx = new Array(k)
  const walk = (start, depth, sum) => {
    if (depth === k) {
      total++
      // 均值差 = sum/k − (sumAll−sum)/(n−k)
      const diff = Math.abs(sum / k - (sumAll - sum) / (all.length - k))
      if (diff >= observed - 1e-12) atLeast++
      return
    }
    for (let i = start; i <= all.length - (k - depth); i++) {
      idx[depth] = i
      walk(i + 1, depth + 1, sum + all[i])
    }
  }
  walk(0, 0, 0)
  return { p: atLeast / total, permutations: total, observed }
}

const load = (dir, prefix) =>
  readdirSync(join(HERE, dir))
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(HERE, dir, f), 'utf8')))

/** 一个臂的全部指标。证据覆盖率现算（不用落盘时的旧口径）。 */
function armStats(dir, prefix) {
  const rows = load(dir, prefix)
  if (!rows.length) return null
  const w3 = rows.map((r) => r.w3.stateAccuracy)
  const epc = rows.map((r) => r.w1.epc)
  const tok = rows.map((r) => (r.result.usage?.inputTokens ?? 0) + (r.result.usage?.outputTokens ?? 0))
  const cov = rows.map((r) => scoreW3(r.result, TASK).evidenceCoverage ?? 0)
  return {
    n: rows.length,
    w3: { mean: mean(w3), sd: sd(w3), raw: w3 },
    epc: { mean: mean(epc), sd: sd(epc), raw: epc },
    tokens: Math.round(mean(tok)),
    coverage: mean(cov),
  }
}

const MODELS = [
  { label: 'deepseek-v4-flash', tag: 'hermes' },
  { label: 'qwen-plus', tag: 'bailian' },
]
const ARMS = [
  { key: 'A0', name: 'bare (tail truncation)', dir: 'results-v3-m', pre: 'a0-m-' },
  { key: 'A1', name: 'vector RAG', dir: 'results-v3-m', pre: 'a1-m-' },
  { key: 'A2', name: 'prompt-only state', dir: 'results-v3-m-ablation', pre: 'a2-m-' },
  { key: 'A3', name: 'Origin IR state layer', dir: 'results-v3-m', pre: 'a3-m-' },
]

const out = { models: {}, frontier: null }

for (const m of MODELS) {
  const arms = {}
  for (const a of ARMS) arms[a.key] = armStats(a.dir, a.pre + m.tag)
  const base = arms.A0.tokens
  const pv = (x, y) => exactPermutation(arms[x].w3.raw, arms[y].w3.raw)
  const pe = (x, y) => exactPermutation(arms[x].epc.raw, arms[y].epc.raw)
  out.models[m.label] = {
    arms: Object.fromEntries(
      Object.entries(arms).map(([k, v]) => [
        k,
        {
          n: v.n,
          w3: `${(v.w3.mean * 100).toFixed(1)}% ± ${(v.w3.sd * 100).toFixed(1)}`,
          epc: `${v.epc.mean.toFixed(2)} ± ${v.epc.sd.toFixed(2)}`,
          coverage: `${(v.coverage * 100).toFixed(1)}%`,
          tokens: v.tokens,
          deltaTokens: `${(((v.tokens - base) / base) * 100).toFixed(1)}%`,
        },
      ]),
    ),
    tests: {
      'W3 A2 vs A0': pv('A2', 'A0'),
      'W3 A3 vs A0': pv('A3', 'A0'),
      'W3 A3 vs A2': pv('A3', 'A2'),
      'W3 A1 vs A0': pv('A1', 'A0'),
      'EPC A3 vs A2': pe('A3', 'A2'),
    },
    machineryPremiumOverA2: `${((arms.A3.tokens / arms.A2.tokens - 1) * 100).toFixed(1)}%`,
  }
}

const fr = armStats('results-v3-m-frontier-qwen37', 'a0-m-bailian')
if (fr)
  out.frontier = {
    model: 'qwen3.7-max-2026-06-08',
    arm: 'A0',
    n: fr.n,
    w3: `${(fr.w3.mean * 100).toFixed(1)}% ± ${(fr.w3.sd * 100).toFixed(1)}`,
    epc: fr.epc.mean.toFixed(2),
    maxRound: `${(Math.max(...fr.w3.raw) * 100).toFixed(0)}%`,
  }

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out, null, 2))
} else {
  for (const [model, d] of Object.entries(out.models)) {
    console.log(`\n══ ${model} ══`)
    console.log('  arm  n   W3 state accuracy   EPC            evidence cov   tokens (Δ vs A0)')
    for (const [k, v] of Object.entries(d.arms))
      console.log(
        `  ${k}   ${v.n}  ${v.w3.padEnd(18)} ${v.epc.padEnd(14)} ${v.coverage.padEnd(14)} ${v.tokens} (${v.deltaTokens})`,
      )
    console.log('  精确置换检验（穷举，无随机）：')
    for (const [name, t] of Object.entries(d.tests))
      console.log(`    ${name.padEnd(14)} p = ${t.p.toFixed(4)}  (${t.permutations} 种分法)  ${t.p < 0.05 ? '显著' : 'n.s.'}`)
    console.log(`  机制相对 A2 的 token 溢价：${d.machineryPremiumOverA2}`)
  }
  if (out.frontier)
    console.log(
      `\n══ 旗舰对照 ══\n  ${out.frontier.model}  A0  n=${out.frontier.n}  W3 ${out.frontier.w3}  EPC ${out.frontier.epc}  十轮最高 ${out.frontier.maxRound}`,
    )
}
