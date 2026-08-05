#!/usr/bin/env node
// 统一重打分：用当前规则给所有已存结果重新计分。
//
// 为什么必需：判分规则会随实验推进而修补（新增 premature-state、修误报等）。
// 结果文件里的 w1 是**跑那一轮时**的规则算出来的，不同轮次口径可能不一致。
// 正文已存盘，重打分不需要任何 API 调用——横向比较前必须先做这一步。
//
//   node eval/rescore.mjs                       重打分并输出汇总（默认 bailian）
//   node eval/rescore.mjs --write               同时把新分数写回结果文件
//   node eval/rescore.mjs --task-m --provider hermes   重打分 M 级 deepseek 那批
//
// provider 曾被写死在 filePattern 里（只匹配 bailian），于是 hermes/deepseek 那批
// **根本进不了重打分**——跑一遍看着一切正常，实际只统一了一半数据的口径，
// 而跨模型对比恰恰需要两边同口径。与前八起同病：装置静默地只覆盖一部分，且不声张。
// 现在 provider 可选，且**未被覆盖的结果会被显式列出来**（见文末「未纳入」提示）。

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { scoreW1 } from './ced.mjs'
import { scoreW3 } from './state-diff.mjs'
import { specHash, judgeHash, armsHash } from './spec-hash.mjs'

const HERE = dirname(dirname(fileURLToPath(import.meta.url)))
const DIR = join(HERE, 'results')
const write = process.argv.includes('--write')

// --task-m 不只是换指纹，还要换**答案集**和**待重判的文件集**：M 级结果文件名带 -m 标记，
// 且 S 级与 M 级的 must_hold 不同（黑钥匙交回沈砚 vs 交给林峥）。第六起事故就是漏了这一层。
const isM = process.argv.includes('--task-m')
const taskFile = isM ? 'continuation-m.json' : 'continuation.json'
const TASK = JSON.parse(readFileSync(join(HERE, 'world', 'spec.origin', 'tasks', taskFile), 'utf8'))
const pi = process.argv.indexOf('--provider')
const provider = pi >= 0 ? process.argv[pi + 1] : 'bailian'
const filePattern = isM
  ? new RegExp(`^a\\d-m-${provider}-(rep\\d+|clean)\\.json$`)
  : new RegExp(`^a\\d-${provider}-rep\\d+\\.json$`)

const all = readdirSync(DIR)
const files = all.filter((f) => filePattern.test(f)).sort()
if (!files.length) { console.error(`✗ results/ 下没有匹配 ${filePattern} 的结果文件`); process.exit(1) }

// 不许静默截断：本轮没纳入哪些结果，必须说出来。
// 否则「重打分跑过了」会被读成「所有数据已同口径」，而实际只统一了一个 provider。
const skipped = all.filter((f) => /^a\d-.*\.json$/.test(f) && !filePattern.test(f) && !/\.(judged|triaged)\.json$/.test(f))
const skippedTag = [...new Set(skipped.map((f) => f.replace(/^a\d-/, '').replace(/-(rep\d+|clean)\.json$/, '')))]

// 口径闸门：重打分只在同一版世界规格下有意义。
// 2026-08-03 事故——M-lite 往 state-changes.jsonl 追加的 27 条里有 2 条落在 S 级评测
// 区间（ch11 黑钥匙转手、ch14 云姑获知），ground truth 变了而正文没变，重打分后
// A0 0.54→0.72、A3 0.28→0.58。纯新增无删除，看 diff 察觉不到。
// 第四起（同日）：口径的另一半是判分器本身。ced.mjs 的 custody / left-hand 补上否定与
// 转述过滤后，同一批正文、同一版规格，W1 的 findings 从 18 条降到 12 条。只盯 specHash
// 看不出这件事——规格与判分器必须一起记。
// 口径的**三半**——少记任何一半，跨批次的分数都不能并列：
//
//   specHash  「对错是什么」。2026-08-03 事故：M-lite 往 state-changes.jsonl 追加的 27 条里
//              有 2 条落在 S 级评测区间，ground truth 变了而正文没变，重打分后
//              A0 0.54→0.72、A3 0.28→0.58。纯新增无删除，看 diff 察觉不到。
//   judgeHash 「怎么判」。第四起（同日）：ced.mjs 的 custody / left-hand 补上否定与转述
//              过滤后，同一批正文、同一版规格，W1 的 findings 从 18 条降到 12 条。
//   armsHash  「怎么跑的」。第八起（2026-08-05）：探询提示词泄题、不传上下文、问的与判的
//              对不上——全都住在 arms/ 里，前两个指纹一个都看不见，而 provenance
//              依然理直气壮地显示「口径一致」。加这一半的当天，正是它该拦住的那批数据出问题。
const KINDS = [
  { key: 'specHash', label: '规格', current: specHash(HERE, taskFile) },
  { key: 'judgeHash', label: '判分器', current: judgeHash(HERE) },
  { key: 'armsHash', label: '实验臂', current: armsHash(HERE) },
]
const CURRENT = KINDS[0].current
for (const k of KINDS) { k.seen = {}; k.missing = 0 }
for (const f of files) {
  const prov = JSON.parse(readFileSync(join(DIR, f), 'utf8')).provenance
  const label = f.replace('-' + provider, '').replace('.json', '')
  for (const k of KINDS) {
    const h = prov?.[k.key]
    if (!h) k.missing++
    else (k.seen[h] ??= []).push(label)
  }
}
for (const k of KINDS) k.stale = Object.keys(k.seen).filter((h) => h !== k.current)
if (KINDS.some((k) => k.missing || k.stale.length)) {
  console.error(`⚠ 判分口径不一致——下列数字不可横向比较，须重跑后再下结论`)
  console.error('  当前指纹：' + KINDS.map((k) => `${k.label} ${k.current}`).join('　'))
  for (const k of KINDS) {
    if (k.missing) console.error(`  ${k.missing} 份结果没记${k.label}指纹（该护栏之前跑的），无法证明用哪一版跑/判的`)
    for (const h of k.stale) console.error(`  ${k.label} ${h}（已过期）：${k.seen[h].join(' ')}`)
  }
  console.error('')
}

const rows = []
for (const f of files) {
  const path = join(DIR, f)
  const d = JSON.parse(readFileSync(path, 'utf8'))
  const chapters = d.result.chapters.filter((c) => c.text)
  const w1 = scoreW1({ arm: d.result.arm, chapters })
  const w3 = scoreW3(d.result, TASK)
  if (write) writeFileSync(path, JSON.stringify({ ...d, w1, w3, rescored: true }, null, 2))
  rows.push({
    arm: f.slice(0, 2).toUpperCase(),
    rep: Number(f.match(/rep(\d+)/)?.[1] ?? 0), // 单次跑用 -clean 后缀，没有 rep 编号
    done: chapters.length,
    review: (d.result.gate?.needsReview ?? []).length,
    errOld: d.w1.errors,
    err: w1.errors,
    epc: w1.epc,
    w3: w3.stateAccuracy,
    tok: d.result.usage.inputTokens + d.result.usage.outputTokens,
    armsHash: d.provenance?.armsHash ?? null, // 分代统计用（见下方「不许跨代合并」）
  })
}

rows.sort((a, b) => a.arm.localeCompare(b.arm) || a.rep - b.rep)
console.log(`# 统一重打分（当前规则）· provider=${provider} · ${rows.length} 轮\n`)
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

// ── 按「跑法代次」分组统计，**不许跨代合并** ────────────────────────────
// 2026-08-05：闸门早就会报「口径不一致」，可报完照样把两代数据合起来算一个均值——
// 只看尾部汇总的人（包括我）会直接把它当结论。**警告完还照算，等于没警告。**
// 现在按 armsHash 分组：跑法不同的批次各出各的表，绝不出现一个混合均值。
const gen = (r) => r.armsHash ?? '（护栏前·无指纹）'
const gens = [...new Set(rows.map(gen))]
if (gens.length > 1) {
  console.log(`\n⚠ 检测到 ${gens.length} 代不同跑法，以下**分代**统计，不给混合均值：`)
  for (const g of gens) console.log(`    ${g}：${rows.filter((r) => gen(r) === g).length} 轮`)
}

for (const g of gens) {
  const sub = rows.filter((r) => gen(r) === g)
  console.log(`\n── 实验臂代次 ${g} ──`)
  const groups = {}
  for (const r of sub) (groups[r.arm] ??= []).push(r)
  for (const [arm, gg] of Object.entries(groups)) {
    const e = stat(gg.map((r) => r.epc)), w = stat(gg.map((r) => r.w3)), t = stat(gg.map((r) => r.tok))
    console.log(
      `  ${arm}（n=${e.n}）：EPC 均 ${e.mean.toFixed(2)} 中位 ${e.median.toFixed(2)} 标准差 ${e.sd.toFixed(2)} [${e.min.toFixed(2)}–${e.max.toFixed(2)}]` +
        `｜W3 ${(w.mean * 100).toFixed(1)}%｜Token 均 ${Math.round(t.mean)}`
    )
  }
}

console.log('')
const groups = {}
for (const r of rows) (groups[r.arm] ??= []).push(r)
if (gens.length > 1) console.log('（下方混合均值已作废，仅为兼容旧输出保留——请看上面的分代表）')
for (const [arm, g] of Object.entries(groups)) {
  const e = stat(g.map((r) => r.epc))
  const w = stat(g.map((r) => r.w3))
  const t = stat(g.map((r) => r.tok))
  console.log(
    `  ${arm}（n=${e.n}）：EPC 均 ${e.mean.toFixed(2)} 中位 ${e.median.toFixed(2)} 标准差 ${e.sd.toFixed(2)} [${e.min.toFixed(2)}–${e.max.toFixed(2)}]` +
      `｜W3 ${(w.mean * 100).toFixed(1)}%｜Token 均 ${Math.round(t.mean)}`
  )
}

/**
 * 置换检验：把两组标签随机打乱 N 次，看「均值差至少和实测一样大」的比例。
 * 无分布假设，小样本适用。
 *
 * 取代原先的「区间是否重叠」——那个规则太粗：两臂区间重叠可能只是因为都能打到 0，
 * 完全不代表分布相同。n=10 已足以做真检验，就不该再用代理指标搪塞。
 */
function permutationTest(a, b, iters = 20000) {
  const observed = a.reduce((x, y) => x + y, 0) / a.length - b.reduce((x, y) => x + y, 0) / b.length
  const pool = [...a, ...b]
  let extreme = 0
  for (let i = 0; i < iters; i++) {
    const s = [...pool]
    for (let j = s.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1))
      ;[s[j], s[k]] = [s[k], s[j]]
    }
    const x = s.slice(0, a.length)
    const y = s.slice(a.length)
    const d = x.reduce((p, q) => p + q, 0) / x.length - y.reduce((p, q) => p + q, 0) / y.length
    if (Math.abs(d) >= Math.abs(observed)) extreme++
  }
  return { observed, p: extreme / iters }
}

if (skippedTag.length) {
  console.log('')
  console.log(`  ⚠ 本轮未纳入（provider/级别不匹配，口径未统一）：${skippedTag.join('、')}`)
  console.log(`     跨模型或跨级别对比前，须对每一组分别跑一次 rescore，否则只统一了一半。`)
}

const a0 = groups.A0 ? stat(groups.A0.map((r) => r.epc)) : null
const a3 = groups.A3 ? stat(groups.A3.map((r) => r.epc)) : null
if (a0 && a3 && a0.n >= 3 && a3.n >= 3) {
  console.log('')
  const complete = groups.A3.every((r) => r.done === 5)
  const A0e = groups.A0.map((r) => r.epc)
  const A3e = groups.A3.map((r) => r.epc)
  const { observed, p } = permutationTest(A3e, A0e)

  console.log(`  前置（A3 每轮产出全部章节）：${complete ? '✓' : '✗'}`)
  console.log(`  EPC：A3 均 ${a3.mean.toFixed(2)} 中位 ${a3.median.toFixed(2)}  vs  A0 均 ${a0.mean.toFixed(2)} 中位 ${a0.median.toFixed(2)}`)
  console.log(`  置换检验（n=${a3.n} vs ${a0.n}，20000 次）：均值差 ${observed.toFixed(2)}，p = ${p.toFixed(4)}`)

  const better = a3.mean < a0.mean && a3.median <= a0.median
  console.log(
    `  Gate 0：${
      !complete ? '未通过 —— 任务未完成'
      : better && p < 0.05 ? `通过（p=${p.toFixed(4)} < 0.05，差异显著）`
      : better ? `倾向通过但未达显著（p=${p.toFixed(4)} ≥ 0.05）—— 需更大样本`
      : '未通过 —— 停止扩大规模，回头改架构'
    }`
  )
}
