#!/usr/bin/env node
// 状态召回基准：**同一预算下，三种投影方式各让模型答对多少、编造多少。**
//
//   node benchmark/context-lod/state-recall/bench.mjs --provider stub          # 免费连通性检查
//   node benchmark/context-lod/state-recall/bench.mjs --provider hermes --repeat 3
//
// 为什么能在这个世界上测、而 ShadowBench-W 不能：
//   engagement-probe 测出 ShadowBench-W 的满档投影只要 1527 字符、预算 6000，
//   斜坡恒不触发，跑了也是测噪声。project.origin 满档 37998 字符、预算 6000，
//   **每一档都触发**。要测一个机制，先得让它有事可做。
//
// 标准答案哪来的：**世界状态自己就是标准答案**。这是状态型基准相对文本型基准的便宜之处——
// `origin.state` 是 objects.jsonl 重放 628 条 provenance 得到的，逐字段可查来源，
// 不需要任何人工标注，也不存在「标注者理解不同」的争议。
//
// ── 三个臂（同一预算 6000）──────────────────────────────────────
//   B0 · 兜底倾倒   renderAll 全量 + 按预算硬截（MCP 修复前的实际行为）
//   B1 · v0.1 二值  相关性选取，命中即全字段、未命中即不存在
//   B2 · v0.2 斜坡  相机 + 三档 LOD + 升降档
//
// ── 待检验的假设（先写下来）────────────────────────────────────
// LOD **不一定**提高正确率——它给远处对象的是 `id（名）` 一行，字段本来就没给。
// 真正该动的是另一个量：**把「编造」换成「诚实弃权」**。
//   B0/B1 里没进上下文的对象，模型连它存在都不知道 → 只能瞎猜或拒答
//   B2 里对象至少有一行 ID → 模型能说「我看到这个对象，但没给我这个字段」
// 所以主指标是**幻觉率**（答了但答错），不是正确率。若正确率也涨，是额外收获；
// 若正确率不动而幻觉率降，假设一样成立。**先写死判据，免得事后挑好看的解释。**

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { loadOrigin } from '../../../compiler/index.mjs'
import { compileContext as v2 } from '../../../compiler/context-compiler.mjs'
import { compileContext as v1 } from '../baseline-v0.1.mjs'
import { createModel } from '../../shadowbench-w/arms/lib/model.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..')
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }

const provider = arg('provider', 'stub')
const repeat = Number(arg('repeat', 1))
const BUDGET = Number(arg('budget', 6000))
const NQ = Number(arg('questions', 24))

const origin = loadOrigin(join(ROOT, 'project.origin'))
const TASK = { goal: '恢复项目当前状态并回答关于世界状态的问题' }

// ── 出题：短标量字段，值可逐字比对 ──────────────────────────────
// 长文本（summary / rationale）不出题：它们无法精确判分，且一律在 key 档被丢弃，
// 出了等于只在考「有没有进 full 档」，把三个臂的差异夸大成必然。
const SHORT = 24
const candidates = []
for (const [id, s] of Object.entries(origin.state)) {
  for (const [k, v] of Object.entries(s)) {
    if (k === '_type' || v === null || v === undefined) continue
    if (typeof v === 'object') continue
    if (String(v).length > SHORT) continue
    candidates.push({ id, field: k, answer: String(v) })
  }
}

// 分层抽样：按「最近被事务改动」的次序均匀取，而不是随机取。
// 这一条是**公平性要害**——B2 的背景层按 provenance 逆序排，只考最近改动的对象
// 等于给它送分，只考最老的等于坑它。均匀铺开，并按新/旧两层分别报数。
const touchedAt = new Map()
origin.history.forEach((h, i) => { if (h.object) touchedAt.set(h.object, i) })
candidates.sort((a, b) => (touchedAt.get(b.id) ?? -1) - (touchedAt.get(a.id) ?? -1))
const step = Math.max(1, Math.floor(candidates.length / NQ))
const questions = []
for (let i = 0; i < candidates.length && questions.length < NQ; i += step) questions.push(candidates[i])
const half = Math.ceil(questions.length / 2)
questions.forEach((q, i) => { q.stratum = i < half ? '近期改动' : '早期/未动' })

// ── 三个臂的上下文 ───────────────────────────────────────────────
function renderAll(o) {
  const lines = ['【项目世界状态】']
  const byType = {}
  for (const [id, f] of Object.entries(o.state)) (byType[f._type ?? 'object'] ??= []).push([id, f])
  for (const [type, items] of Object.entries(byType)) {
    lines.push(`\n· ${type}`)
    for (const [id, f] of items) {
      const bits = Object.entries(f)
        .filter(([k, v]) => k !== '_type' && v !== null && v !== undefined && typeof v !== 'object')
        .map(([k, v]) => `${k}=${v}`)
      const arrs = Object.entries(f).filter(([k, v]) => k !== '_type' && Array.isArray(v) && v.length).map(([k, v]) => `${k}=[${v.join(', ')}]`)
      lines.push(`  ${id}　${[...bits, ...arrs].join('；')}`)
    }
  }
  const en = (o.constraints ?? []).filter((c) => c.check)
  if (en.length) { lines.push('\n【约束·违反即拒绝提交】'); for (const c of en) lines.push(`  - ${c.rule ?? c.id}`) }
  return lines.join('\n')
}

const ARMS = [
  { id: 'B0·兜底倾倒', ctx: () => { const t = renderAll(origin); return t.length > BUDGET ? t.slice(0, BUDGET) : t } },
  { id: 'B1·v0.1二值', ctx: () => { const c = v1({ origin, task: TASK, budget: BUDGET }); return c.estChars > BUDGET ? c.text.slice(0, BUDGET) : c.text } },
  { id: 'B2·v0.2斜坡', ctx: () => v2({ origin, task: TASK, budget: BUDGET }).text },
]

const QUESTION_BLOCK = questions.map((q, i) => `  ${i + 1}. ${q.id} 的 ${q.field} 是什么？`).join('\n')

function buildPrompt(ctx) {
  return `${ctx}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
以上是你能看到的全部项目世界状态。请仅依据上文回答下列问题。

${QUESTION_BLOCK}

【回答规则·重要】
- 上文明确给出了该字段的值 → 原样照抄那个值。
- 上文没有给出该字段的值 → 必须回答 "UNKNOWN"。**不要根据对象名或常理推测。**
  答错的代价高于答 UNKNOWN；这一项专门用来衡量编造。

【输出格式】只输出一个 JSON 对象，不要有其他文字：
{"answers": ["第1题的答案", "第2题的答案", ...]}
数组长度必须等于 ${questions.length}。`
}

/**
 * 该题的答案是否真的出现在上下文里——**必须落到那个对象自己那一行上**。
 *
 * 初版写的是 `ctx.includes(field + '=' + answer)`，是错的：129 个对象里
 * `status=done`、`status=active` 这类值到处都是，全局子串一撞就算「可见」。
 * 对象列得越多的臂被高估越狠，恰好把优势送给 B2——一个会让被测方案自己看起来
 * 更好的度量错误，是最该先怀疑的那种。改为先定位该对象所在行，再在行内比对。
 */
function visibleOn(ctx, q) {
  for (const line of ctx.split('\n')) {
    if (!line.includes(q.id)) continue
    if (line.includes(`${q.field}=${q.answer}`)) return true
  }
  return false
}

// stub：照着「上下文里有就答对、没有就编一个」的行为演，用来验流程，不产生结论
function stubAnswer(ctx) {
  return { answers: questions.map((q) => (visibleOn(ctx, q) ? q.answer : '（编造值）')) }
}

// ── 判分 ────────────────────────────────────────────────────────
function score(parsed, ctx) {
  const a = Array.isArray(parsed?.answers) ? parsed.answers : []
  const rows = questions.map((q, i) => {
    const got = String(a[i] ?? '').trim()
    // 可答性：该字段的值是否真的出现在**该对象那一行**——区分「模型没看到」与「看到了却答错」
    const visible = visibleOn(ctx, q)
    const unknown = /^unknown$/i.test(got) || got === ''
    const correct = !unknown && got === q.answer
    return { ...q, got, visible, unknown, correct, hallucinated: !unknown && !correct }
  })
  const n = rows.length || 1
  return {
    rows,
    correct: rows.filter((r) => r.correct).length,
    hallucinated: rows.filter((r) => r.hallucinated).length,
    unknown: rows.filter((r) => r.unknown).length,
    visible: rows.filter((r) => r.visible).length,
    // 看到了却答错——这是最坏的一类，跟「没看到只好猜」要分开算
    wrongDespiteVisible: rows.filter((r) => r.visible && !r.correct).length,
    n,
  }
}

// ── 跑 ──────────────────────────────────────────────────────────
console.log(`# 状态召回基准 · project.origin（${origin.ids.size} 对象 / 满档 ${v2({ origin, task: TASK, budget: Number.MAX_SAFE_INTEGER }).estChars} 字符）\n`)
console.log(`预算 ${BUDGET}　题目 ${questions.length}　provider ${provider}　repeat ${repeat}`)
if (provider === 'stub') console.log('\n⚠ STUB：数字仅验证流程连通，不是实验结果，不得引用。')
console.log('')

const results = []
for (const arm of ARMS) {
  const ctx = arm.ctx()
  for (let rep = 1; rep <= repeat; rep++) {
    let parsed
    if (provider === 'stub') parsed = stubAnswer(ctx)
    else {
      const model = createModel({ provider, model: arg('model') })
      const res = await model.complete({ prompt: buildPrompt(ctx), maxTokens: 4096 })
      parsed = res.parsed
      if (!parsed) { console.log(`  ⚠ ${arm.id} rep${rep}：模型输出解析失败，本轮作废`); continue }
    }
    const s = score(parsed, ctx)
    results.push({ arm: arm.id, rep, ctxChars: ctx.length, ...s })
    console.log(
      `${arm.id} rep${rep}　上下文 ${ctx.length} 字符　` +
      `正确 ${s.correct}/${s.n}　幻觉 ${s.hallucinated}　弃权 ${s.unknown}　（题目值可见 ${s.visible}）`,
    )
  }
}

// ── 汇总 ────────────────────────────────────────────────────────
const pct = (a, b) => ((a / b) * 100).toFixed(1) + '%'
console.log('\n## 汇总（多轮均值）\n')
console.log('| 臂 | 上下文 | 题目值可见 | 正确率 | **幻觉率** | 诚实弃权率 | 看到却答错 |')
console.log('|---|---:|---|---|---|---|---:|')
for (const arm of ARMS) {
  const r = results.filter((x) => x.arm === arm.id)
  if (!r.length) { console.log(`| ${arm.id} | — | — | — | — | — | — |`); continue }
  const avg = (f) => r.reduce((n, x) => n + f(x), 0) / r.length
  const n = r[0].n
  console.log(
    `| ${arm.id} | ${r[0].ctxChars} | ${pct(r[0].visible, n)} | ${pct(avg((x) => x.correct), n)} | ` +
    `**${pct(avg((x) => x.hallucinated), n)}** | ${pct(avg((x) => x.unknown), n)} | ${avg((x) => x.wrongDespiteVisible).toFixed(1)} |`,
  )
}

// 分层：证明结论不是抽样偏袒某个臂
console.log('\n### 按改动新旧分层（检查抽样公平性）\n')
console.log('| 臂 | 近期改动·正确 | 近期改动·幻觉 | 早期/未动·正确 | 早期/未动·幻觉 |')
console.log('|---|---|---|---|---|')
for (const arm of ARMS) {
  const r = results.filter((x) => x.arm === arm.id)
  if (!r.length) continue
  const by = (st, f) => r.reduce((n, x) => n + x.rows.filter((y) => y.stratum === st && f(y)).length, 0) / r.length
  const cnt = (st) => questions.filter((q) => q.stratum === st).length
  console.log(
    `| ${arm.id} | ${by('近期改动', (y) => y.correct).toFixed(1)}/${cnt('近期改动')} | ${by('近期改动', (y) => y.hallucinated).toFixed(1)} | ` +
    `${by('早期/未动', (y) => y.correct).toFixed(1)}/${cnt('早期/未动')} | ${by('早期/未动', (y) => y.hallucinated).toFixed(1)} |`,
  )
}

mkdirSync(join(HERE, 'results'), { recursive: true })
const out = join(HERE, 'results', `${provider}-b${BUDGET}-q${questions.length}.json`)
writeFileSync(out, JSON.stringify({ provider, budget: BUDGET, repeat, questions, results }, null, 2))
console.log(`\n结果已写入 ${out.slice(ROOT.length + 1)}`)
