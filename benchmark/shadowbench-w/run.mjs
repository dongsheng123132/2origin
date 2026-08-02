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

const report = []
for (const key of selected) {
  const mod = arms[key]
  if (!mod) throw new Error(`未知实验臂 ${key}`)
  const model = createModel({ provider, model: modelName, scenario })
  const result = await mod.run({ spec, task, state0, chapters, model, budget, corpusTail })

  const w1 = scoreW1({ arm: result.arm, chapters: result.chapters.filter((c) => c.text) })
  const w3 = scoreW3(result)
  report.push({ meta: mod.meta, result, w1, w3 })

  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, `${key}-${provider}-${scenario}.json`), JSON.stringify({ result, w1, w3 }, null, 2))
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

for (const { meta, result, w1, w3 } of report) {
  console.log(`\n── ${meta.name} ──`)
  console.log(`  正文 ${w1.words} 字   CED ${w1.ced.toFixed(3)}/万字（仅确定性通道，语义通道未接入）`)
  if (w1.findings.length) for (const f of w1.findings) console.log(`     ✗ ch${f.chapter} [${f.rule}] ${f.why}`)
  console.log(`  W3 状态准确率 ${(w3.stateAccuracy * 100).toFixed(1)}%  (${w3.passed}/${w3.checked}，未上报 ${w3.missing})`)
  for (const r of w3.rows.filter((r) => !r.pass)) console.log(`     ✗ ${r.key} — ${r.detail}`)
  if (w3.evidenceTraceability !== null) console.log(`  证据可追溯率 ${(w3.evidenceTraceability * 100).toFixed(1)}%`)
  if (result.gate)
    console.log(
      `  门禁：${result.gate.attempts} 次提交，拦下 ${result.gate.rejections} 次` +
        (Object.keys(result.gate.byCode).length ? `（${Object.entries(result.gate.byCode).map(([k, v]) => `${k}×${v}`).join('，')}）` : '')
    )
  const u = result.usage
  console.log(`  用量：输入 ${u.inputTokens} tok，输出 ${u.outputTokens} tok，${u.calls} 次调用，${u.ms}ms`)
}

// ── Gate 0 判定 ──
const a0 = report.find((r) => r.meta.id === 'a0-naive')
const a3 = report.find((r) => r.meta.id === 'a3-benxiang')
if (a0 && a3) {
  console.log('\n' + '─'.repeat(64))
  const pass = a3.w1.ced <= a0.w1.ced
  console.log(` Gate 0：A3 的 CED ${a3.w1.ced.toFixed(3)} ${pass ? '≤' : '>'} A0 的 ${a0.w1.ced.toFixed(3)} → ${pass ? '通过' : '未通过，停止扩大规模，回头改架构'}`)
  if (stub) console.log(' （stub 模式下此判定无意义）')
}
console.log(`\n结果已写入 ${outDir}\n`)
