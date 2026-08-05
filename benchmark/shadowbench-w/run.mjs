#!/usr/bin/env node
// ShadowBench-W 编排器：跑实验臂 → 判分 → 出报告。
//
//   node run.mjs --provider stub                      零成本跑通全流程
//   node run.mjs --provider stub --scenario violating 验证校验器能拦住违规
//   node run.mjs --provider anthropic --model claude-sonnet-5   真实实验
//
// 选项：--arm a0|a1|a3|all（可逗号分隔，默认 all）  --budget <字符数>  --out <目录>
//       --repeat <次数>  --rep-offset <起始编号偏移，用于续跑不覆盖已有数据>

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadSpec, replay } from './eval/replay.mjs'
import { scoreW1 } from './eval/ced.mjs'
import { scoreW3 } from './eval/state-diff.mjs'
import { specHash, judgeHash, judgeHashW1, judgeHashW3, armsHash } from './eval/spec-hash.mjs'
import { createModel } from './arms/lib/model.mjs'
import * as A0 from './arms/a0-naive/index.mjs'
import * as A1 from './arms/a1-rag/index.mjs'
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
// 任务文件可切换：S 级 continuation.json，M-lite continuation-m.json（--task 指定）
const taskFile = arg('task', 'continuation.json')
// 结果文件名必须带任务级别，否则不同级别的同名结果会互相覆盖（第五起事故）。
// S 级不加标记，保持与历史结果文件名兼容；其余级别取任务文件名里的后缀（-m → "-m"）。
const levelTag = taskFile === 'continuation.json' ? '' : '-' + taskFile.replace(/^continuation-?/, '').replace(/\.json$/, '')
const task = JSON.parse(readFileSync(join(HERE, 'world/spec.origin/tasks', taskFile), 'utf8'))
// 基线长度由任务文件声明，不再写死
const baselineThrough = task.baseline_through ?? 10
const { state: state0, problems } = replay(spec, baselineThrough)
if (problems.length) {
  console.error('✗ 世界规格重放有问题，先修规格再跑实验：\n' + problems.map((p) => '  - ' + p).join('\n'))
  process.exit(1)
}

// A0 需要「最近正文」。基线语料尚未生成时用大纲摘要顶替，并在报告中标注。
const corpusFile = `ch01-${String(baselineThrough).padStart(2, '0')}.txt`
let corpusTail = ''
let corpusIsReal = false
try {
  corpusTail = readFileSync(join(HERE, 'corpus', corpusFile), 'utf8')
  corpusIsReal = true
} catch {
  corpusTail = spec.outline.map((c) => `第${c.chapter}章 ${c.title}：${c.summary}`).join('\n')
}

// ── 答案泄漏闸门（2026-08-03 第三起事故后加）──────────────────────────────
// 事故：tools/gen-corpus.mjs 把合并结果写死到 `ch01-10.txt`，不管实际合了多少章。
// M-lite 生成 47 章后，S 级的基线语料文件里装的是 47 章、27.7 万字——而文件名没变。
// 后果：S 级考的是 ch11-15，模型却会拿到 ch11-15 的标准答案原文当「最近正文」，
// A0 照抄即满分。文件名完全看不出来，判分器也发现不了。
//
// 光改命名不够——命名可以再错一次。这里直接校验内容：基线语料不得含考题章节。
if (corpusIsReal) {
  const present = [...corpusTail.matchAll(/^第(\d+)章/gm)].map((m) => Number(m[1]))
  const leaked = present.filter((n) => n > baselineThrough)
  if (leaked.length) {
    console.error(`✗ 基线语料 corpus/${corpusFile} 含第 ${Math.min(...leaked)}-${Math.max(...leaked)} 章，超出基线范围（应 ≤ ${baselineThrough}）`)
    console.error(`  这会把考题答案直接喂给模型。先修复语料再跑——不修就跑出来的分数没有意义。`)
    console.error(`  修法：git checkout -- corpus/${corpusFile}，或用 tools/gen-corpus.mjs 重新生成到正确文件名。`)
    process.exit(1)
  }
}

const arms = { a0: A0, a1: A1, a3: A3 }
const selected = which === 'all' ? ['a0', 'a1', 'a3'] : which.split(',')
const chapters = task.chapters

const repeat = Number(arg('repeat', 1))
const repOffset = Number(arg('rep-offset', 0)) // 续跑时接着编号，不覆盖已有数据
const report = []
mkdirSync(outDir, { recursive: true })

// ── 运行护栏（2026-08-03 事故后加）────────────────────────────────────────
// 事故：两个 a3 实验并发跑，各自按同样规则命名，后者静默覆盖了前者的 rep9/rep10。
// 被覆盖的两轮拒绝数 10、11，而另外八轮最高只有 6——数据被换掉了，而且没有任何痕迹，
// 已发表的结论（EPC 0.16、p=0.0121）无法从磁盘上的文件复现。
//
// 三条防护：① 同一 results/ 下不允许并发写（并发还会让带门禁的臂被系统性惩罚：
// 争用导致的超时会触发重试与复核，而无门禁的臂照单全收，偏差只打一边）
// ② 不许静默覆盖已存在的 rep 文件 ③ 每份结果盖上出处（时刻、commit、命令行）
const LOCK = join(outDir, '.run.lock')
const allowConcurrent = process.argv.includes('--allow-concurrent')
const force = process.argv.includes('--force')

if (existsSync(LOCK) && !allowConcurrent) {
  const held = JSON.parse(readFileSync(LOCK, 'utf8'))
  let alive = true
  try { process.kill(held.pid, 0) } catch { alive = false }
  if (alive) {
    console.error(`✗ 已有实验在跑（pid ${held.pid}，${held.startedAt}）：\n    ${held.argv}`)
    console.error('  并发会静默覆盖同名 rep 文件，且只惩罚带门禁的臂。等它跑完，或换 --out 目录。')
    console.error('  确知无害可加 --allow-concurrent。')
    process.exit(1)
  }
  console.error(`  ⚠ 发现残留锁（pid ${held.pid} 已不存在），清理后继续`)
}

const gitCommit = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: HERE, encoding: 'utf8' }).trim()
  } catch { return null }
})()
const provenance = {
  startedAt: new Date().toISOString(),
  pid: process.pid,
  argv: process.argv.slice(2).join(' '),
  gitCommit,
  // 规格指纹：ground truth 变了就必须重跑，不能拿旧正文对新标准答案打分
  specHash: specHash(HERE, taskFile),
  // 判分器指纹：规格没变、判分逻辑变了，分数一样会动（ced.mjs 修否定误报后 findings 18→12）
  judgeHash: judgeHash(HERE),
  // 分维度指纹：ced.mjs 只判 W1，它一改不该把 W3 的历史数据一并作废（见 spec-hash.mjs）
  judgeHashW1: judgeHashW1(HERE),
  judgeHashW3: judgeHashW3(HERE),
  // 实验臂指纹：规格与判分器都没变、**跑法**变了，分数照样会动。
  // 第八起就住在这个盲区里——探询提示词泄题、不传上下文，两个旧指纹一个都察觉不到。
  armsHash: armsHash(HERE),
  taskFile,
  provider,
  model: modelName ?? '(默认)',
  budget,
  concurrentAllowed: allowConcurrent,
}
writeFileSync(LOCK, JSON.stringify(provenance, null, 2))
const releaseLock = () => { try { unlinkSync(LOCK) } catch {} }
process.on('exit', releaseLock)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { releaseLock(); process.exit(130) })

for (const key of selected) {
  const mod = arms[key]
  if (!mod) throw new Error(`未知实验臂 ${key}`)
  for (let rep = 1; rep <= repeat; rep++) {
    // 多次重复取分布：Run #2/#3 已证实单次运行的方差大到能翻转结论
    const model = createModel({ provider, model: modelName, scenario })
    const result = await mod.run({ spec, task, state0, chapters, model, budget, corpusTail })

    const w1 = scoreW1({ arm: result.arm, chapters: result.chapters.filter((c) => c.text) })
    // 答案集显式传入——判分器不会自己知道这轮跑的是哪一级考题（第六起事故）
    const w3 = scoreW3(result, task)
    report.push({ meta: mod.meta, result, w1, w3, rep })

    const n = rep + repOffset
    const suffix = repeat > 1 || repOffset ? `-rep${n}` : `-${scenario}`
    const path = join(outDir, `${key}${levelTag}-${provider}${suffix}.json`)
    // 不静默覆盖：已有同名结果就报错退出，要么换 --rep-offset，要么明确 --force。
    // 第五起同类事故（2026-08-03）：原先这里限定 suffix.startsWith('-rep')，于是 --repeat 1
    // 走的 `-clean` 后缀完全不受保护；又因文件名不含任务级别，M-lite 单次跑把 S 级的
    // a0/a1/a3-bailian-clean.json 静默覆盖，results/ 不在 git 里，覆盖即不可恢复。
    // 两处都堵：文件名带级别（见 levelTag），且任何后缀都不许静默覆盖。
    if (existsSync(path) && !force) {
      console.error(`✗ ${path} 已存在，拒绝覆盖。改 --rep-offset 续编号，或确认要重跑再加 --force。`)
      process.exit(1)
    }
    writeFileSync(path, JSON.stringify({ result, w1, w3, provenance: { ...provenance, rep: n, finishedAt: new Date().toISOString() } }, null, 2))
    if (repeat > 1 || repOffset)
      console.error(
        `  [${key} 第 ${n} 次] 完成 ${result.chapters.filter((c) => c.text).length}/5，错误 ${w1.errors} 处，W3 ${(w3.stateAccuracy * 100).toFixed(0)}%`
      )
  }
}

// ── 报告 ──
const stub = provider === 'stub'
console.log('\n' + '='.repeat(64))
// 级别取自任务文件，不写死——报告标题上印着「S 级」而实际跑的是 M 级，
// 正是第五起事故（文件名不反映内容）的同型：人眼看到的标签与实际内容脱钩。
console.log(` ShadowBench-W · ${task.level ?? taskFile} · 第 ${chapters[0]}-${chapters.at(-1)} 章`)
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
    const nr = result.gate.needsReview ?? []
    if (nr.length)
      console.log(`  待人工复核：${nr.length} 章（重试耗尽后收下最优稿）→ ${nr.map((r) => `ch${r.chapter}(残留${r.remainingErrors})`).join('，')}`)
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
