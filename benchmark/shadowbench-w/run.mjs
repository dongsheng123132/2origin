#!/usr/bin/env node
// ShadowBench-W 编排器：跑实验臂 → 判分 → 出报告。
//
//   node run.mjs --provider stub                      零成本跑通全流程
//   node run.mjs --provider stub --scenario violating 验证校验器能拦住违规
//   node run.mjs --provider anthropic --model claude-sonnet-5   真实实验
//
// 选项：--arm a0|a3|all（默认 all）  --budget <字符数>  --out <目录>

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadSpec, replay } from './eval/replay.mjs'
import { scoreW1 } from './eval/ced.mjs'
import { scoreW3 } from './eval/state-diff.mjs'
import { createModel } from './arms/lib/model.mjs'
import * as A0 from './arms/a0-naive/index.mjs'
import * as A3 from './arms/a3-benxiang/index.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}

const provider = arg('provider', 'stub')
const scenario = arg('scenario', 'clean')
const modelName = arg('model')
const which = arg('arm', 'all')
const budget = Number(arg('budget', 6000))
const outDir = arg('out', join(HERE, 'results'))

const spec = loadSpec()
const task = JSON.parse(readFileSync(join(HERE, 'world/spec.origin/tasks/continuation.json'), 'utf8'))
const { state: state0, problems } = replay(spec, 10)
if (problems.length) {
  console.error('✗ 世界规格重放有问题，先修规格再跑实验：\n' + problems.map((p) => '  - ' + p).join('\n'))
  process.exit(1)
}

// A0 需要「最近正文」。基线语料尚未生成时用大纲摘要顶替，并在报告中标注。
let corpusTail = ''
let corpusIsReal = false
try {
  corpusTail = readFileSync(join(HERE, 'corpus', 'ch01-10.txt'), 'utf8')
  corpusIsReal = true
} catch {
  corpusTail = spec.outline.map((c) => `第${c.chapter}章 ${c.title}：${c.summary}`).join('\n')
}

const arms = { a0: A0, a3: A3 }
const selected = which === 'all' ? ['a0', 'a3'] : [which]
const chapters = task.chapters

const repeat = Number(arg('repeat', 1))
const report = []
mkdirSync(outDir, { recursive: true })

for (const key of selected) {
  const mod = arms[key]
  if (!mod) throw new Error(`未知实验臂 ${key}`)
  for (let rep = 1; rep <= repeat; rep++) {
    // 多次重复取分布：Run #2/#3 已证实单次运行的方差大到能翻转结论
    const model = createModel({ provider, model: modelName, scenario })
    const result = await mod.run({ spec, task, state0, chapters, model, budget, corpusTail })

    const w1 = scoreW1({ arm: result.arm, chapters: result.chapters.filter((c) => c.text) })
    const w3 = scoreW3(result)
    report.push({ meta: mod.meta, result, w1, w3, rep })

    const suffix = repeat > 1 ? `-rep${rep}` : `-${scenario}`
    writeFileSync(join(outDir, `${key}-${provider}${suffix}.json`), JSON.stringify({ result, w1, w3 }, null, 2))
    if (repeat > 1) console.error(`  [${key} 第 ${rep}/${repeat} 次] 错误 ${w1.errors} 处，W3 ${(w3.stateAccuracy * 100).toFixed(0)}%`)
  }
}

// ── 报告 ──
const stub = provider === 'stub'
console.log('\n' + '='.repeat(64))
console.log(` ShadowBench-W · S 级 · 第 ${chapters[0]}-${chapters.at(-1)} 章`)
console.log('='.repeat(64))
if (stub) {
  console.log('\n  ⚠⚠ STUB 模式：模型输出是固定剧本，下列数字仅验证流程连通，')
  console.log('     不是实验结果，不得引用。真实实验需 --provider anthropic。')
}
if (!corpusIsReal) console.log('  ⚠ 基线语料未生成，A0 的「最近正文」暂用大纲摘要顶替。')

for (const { meta, result, w1, w3, rep } of report) {
  console.log(`\n── ${meta.name}${repeat > 1 ? ` · 第 ${rep} 次` : ''} ──`)
  console.log(
    `  错误 ${w1.errors} 处 / ${w1.chapters} 章 → EPC ${w1.epc.toFixed(2)}（主指标）` +
      `｜正文 ${w1.words} 字，均 ${w1.avgChapterLen} 字/章（目标比 ${w1.lengthRatio}×）｜CED ${w1.ced.toFixed(3)}（次要）`
  )
  if (w1.lengthRatio > 1.3) console.log(`     ⚠ 章均长度超目标 ${w1.lengthRatio}×，CED 会被稀释，以 EPC 为准`)
  if (w1.findings.length) for (const f of w1.findings) console.log(`     ✗ ch${f.chapter} [${f.rule}] ${f.why}`)
  console.log(`  W3 状态准确率 ${(w3.stateAccuracy * 100).toFixed(1)}%  (${w3.passed}/${w3.checked}，未上报 ${w3.missing})`)
  for (const r of w3.rows.filter((r) => !r.pass)) console.log(`     ✗ ${r.key} — ${r.detail}`)
  if (w3.evidenceTraceability !== null) console.log(`  证据可追溯率 ${(w3.evidenceTraceability * 100).toFixed(1)}%`)
  if (result.gate) {
    console.log(
      `  门禁：${result.gate.attempts} 次提交，拦下 ${result.gate.rejections} 次` +
        (Object.keys(result.gate.byCode).length ? `（${Object.entries(result.gate.byCode).map(([k, v]) => `${k}×${v}`).join('，')}）` : '')
    )
    const w = Object.entries(result.gate.warnings ?? {})
    if (w.length) console.log(`  记忆偏差（放行但计数）：${w.map(([k, v]) => `${k}×${v}`).join('，')}`)
  }
  const u = result.usage
  console.log(`  用量：输入 ${u.inputTokens} tok，输出 ${u.outputTokens} tok，${u.calls} 次调用，${u.ms}ms`)
}

// ── Gate 0 判定 ──
const agg = (id, f) => report.filter((r) => r.meta.id === id).map(f)
const stat = (xs) =>
  xs.length ? { mean: xs.reduce((a, b) => a + b, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs), n: xs.length } : null
const a0 = stat(agg('a0-naive', (r) => r.w1.epc))
const a3 = stat(agg('a3-benxiang', (r) => r.w1.epc))

if (a0 && a3) {
  console.log('\n' + '─'.repeat(64))
  const a3w3 = stat(agg('a3-benxiang', (r) => r.w3.stateAccuracy))
  const a0w3 = stat(agg('a0-naive', (r) => r.w3.stateAccuracy))
  const completed = agg('a3-benxiang', (r) => r.result.chapters.filter((c) => c.text).length === r.result.chapters.length).every(Boolean)

  const fmt = (s) => `${s.mean.toFixed(2)}${s.n > 1 ? ` [${s.min.toFixed(2)}–${s.max.toFixed(2)}]` : ''}`
  console.log(` 前置：A3 每次均产出全部章节 ${completed ? '✓' : '✗（未完成任务，无可比性）'}`)
  console.log(` W1 主指标 EPC（每章错误数，越低越好）：A3 ${fmt(a3)}  vs  A0 ${fmt(a0)}`)
  console.log(` W3 状态准确率：A3 ${(a3w3.mean * 100).toFixed(1)}%  vs  A0 ${(a0w3.mean * 100).toFixed(1)}%`)

  // 区间重叠即判为「不可区分」——Run #2/#3 的教训：单次差异会被方差淹没
  const overlap = a3.n > 1 && a0.n > 1 && a3.min <= a0.max && a0.min <= a3.max
  const verdict = !completed
    ? '未通过 —— 任务未完成'
    : overlap
      ? '判定条件尚不具备 —— 两臂 EPC 区间重叠，样本量不足以区分'
      : a3.mean <= a0.mean
        ? '通过'
        : '未通过 —— 停止扩大规模，回头改架构'
  console.log(` Gate 0：${verdict}`)
  if (a3.n === 1) console.log('   （单次运行无统计效力，请用 --repeat 3 以上）')
  if (stub) console.log('   （stub 模式下此判定无意义）')
}
console.log(`\n结果已写入 ${outDir}\n`)
