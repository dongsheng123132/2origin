#!/usr/bin/env node
// 差分帧能不能用：**省下 80% 的字符之后，模型还答得对吗？**
//
//   node benchmark/context-lod/state-recall/delta-bench.mjs --provider stub
//   node benchmark/context-lod/state-recall/delta-bench.mjs --provider hermes --repeat 3
//
// 差分帧对 GPU 是安全的：显存里那份场景图确定还在。对语言模型不是——基帧躺在对话历史里，
// 可能被上下文压缩挤掉，也可能只是注意力没落到那么远的地方。所以「省了多少字符」本身
// 不构成结论，必须配一个问题：**模型是否真的把差分叠加到了基帧上。**
//
// 两个臂，标准答案都是**最终状态**：
//   D0 · 全量关键帧   一条消息给最终状态全量 + 题目（上限对照）
//   D1 · 基帧 + 差分  给旧状态关键帧，再给一份差分，然后出题
//
// 题目分两类，这是本实验的要害：
//   变更题  该对象在差分里被更新过 → 考「有没有用新值覆盖旧值」。
//           答旧值＝差分没被叠加，这是差分方案最危险的失败模式，比答不出来更坏——
//           它会让模型**自信地拿着过期状态**继续干活。
//   未变题  该对象只在基帧里出现过 → 考「基帧还在不在」。
//           答不出来＝差分模式把模型的记忆窗口缩短了，省字符省过了头。

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { loadOrigin, compileContext, compileDelta } from '../../../compiler/index.mjs'
import { replay } from '../../../compiler/provenance.mjs'
import { createModel } from '../../shadowbench-w/arms/lib/model.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..')
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }
const provider = arg('provider', 'stub')
const repeat = Number(arg('repeat', 1))
const BUDGET = Number(arg('budget', 6000))

const origin = loadOrigin(join(ROOT, 'project.origin'))
const TASK = { goal: '恢复项目当前状态并回答关于世界状态的问题' }
const H = origin.history
const SPLIT = H.length - 60 // 基帧停在这里，之后 60 条变更走差分

const stateBase = replay(origin.initial, H.slice(0, SPLIT))
const stateNow = origin.state

const keyBase = compileContext({ origin, task: TASK, state: stateBase, budget: BUDGET })
const keyNow = compileContext({ origin, task: TASK, state: stateNow, budget: BUDGET })
const delta = compileDelta({ origin, task: TASK, state: stateNow, budget: BUDGET, since: keyBase.frame })

// ── 出题：从两类里各取若干 ────────────────────────────────────────
const changedIds = new Set(
  Object.keys(keyNow.frame.lines).filter((id) => keyBase.frame.lines[id] !== keyNow.frame.lines[id]),
)
const SHORT = 24
const visibleOn = (ctx, q) => ctx.split('\n').some((l) => l.includes(q.id) && l.includes(`${q.field}=${q.answer}`))

const pool = { 变更题: [], 未变题: [] }
for (const [id, s] of Object.entries(stateNow)) {
  for (const [k, v] of Object.entries(s)) {
    if (k === '_type' || v === null || v === undefined || typeof v === 'object') continue
    if (String(v).length > SHORT) continue
    const q = { id, field: k, answer: String(v) }
    // 只收「在最终关键帧里确实可见」的题——问一个连上限对照都看不到的字段，
    // 两个臂一起答不出来，测不出任何东西
    if (!visibleOn(keyNow.text, q)) continue
    const bucket = changedIds.has(id) ? '变更题' : '未变题'
    // 变更题还要求：旧值与新值确实不同，否则「答旧值」和「答新值」无法区分
    if (bucket === '变更题') {
      const oldLine = keyBase.frame.lines[id]
      if (oldLine && oldLine.includes(`${k}=${v}`)) continue // 值没变，区分不了
    }
    pool[bucket].push({ ...q, bucket })
  }
}
const take = (a, n) => { const step = Math.max(1, Math.floor(a.length / n)); const o = []; for (let i = 0; i < a.length && o.length < n; i += step) o.push(a[i]); return o }
const questions = [...take(pool.变更题, 12), ...take(pool.未变题, 12)]

const QB = questions.map((q, i) => `  ${i + 1}. ${q.id} 的 ${q.field} 是什么？`).join('\n')
const RULES = `
【回答规则·重要】
- 依据**最新**的世界状态回答。若某对象在状态差分里被更新过，以差分里的值为准。
- 上文没有给出该字段的值 → 必须回答 "UNKNOWN"。不要根据对象名或常理推测。

【输出格式】只输出一个 JSON 对象，不要有其他文字：
{"answers": ["第1题的答案", ...]}
数组长度必须等于 ${questions.length}。`

const ARMS = [
  { id: 'D0·全量关键帧', text: `${keyNow.text}\n\n━━━━━━━━━━\n以上是当前全部项目世界状态。请仅依据上文回答：\n\n${QB}\n${RULES}` },
  { id: 'D1·基帧+差分', text: `【第 1 轮·世界状态全量】\n${keyBase.text}\n\n【第 2 轮·状态差分】\n${delta.text}\n\n━━━━━━━━━━\n以上是你看到的全部信息（第 1 轮全量 + 第 2 轮差分）。请仅依据上文回答：\n\n${QB}\n${RULES}` },
]

function score(parsed) {
  const a = Array.isArray(parsed?.answers) ? parsed.answers : []
  const rows = questions.map((q, i) => {
    const got = String(a[i] ?? '').trim()
    const unknown = /^unknown$/i.test(got) || got === ''
    const correct = !unknown && got === q.answer
    // 只对变更题有意义：答了基帧里的旧值——差分没被叠加，拿着过期状态还很自信
    const oldLine = keyBase.frame.lines[q.id] ?? ''
    const staleAnswer = !unknown && !correct && oldLine.includes(`${q.field}=${got}`)
    return { ...q, got, unknown, correct, staleAnswer }
  })
  const per = (b, f) => rows.filter((r) => r.bucket === b && f(r)).length
  return {
    rows,
    correct: rows.filter((r) => r.correct).length,
    changedCorrect: per('变更题', (r) => r.correct),
    changedStale: per('变更题', (r) => r.staleAnswer),
    unchangedCorrect: per('未变题', (r) => r.correct),
    unknown: rows.filter((r) => r.unknown).length,
    n: rows.length,
  }
}

console.log(`# 差分帧可用性 · project.origin\n`)
console.log(`基帧停在 seq ${SPLIT}，其后 ${H.length - SPLIT} 条变更走差分`)
console.log(`关键帧 ${keyNow.estChars} 字符　vs　基帧+差分 ${keyBase.estChars}+${delta.estChars}=${keyBase.estChars + delta.estChars} 字符`)
console.log(`单看第 2 轮：关键帧要 ${keyNow.estChars}，差分只要 ${delta.estChars}（省 ${((1 - delta.estChars / keyNow.estChars) * 100).toFixed(1)}%）`)
console.log(`题目：变更题 ${questions.filter((q) => q.bucket === '变更题').length}　未变题 ${questions.filter((q) => q.bucket === '未变题').length}`)
if (provider === 'stub') console.log('\n⚠ STUB：数字仅验流程，不是实验结果。')
console.log('')

const results = []
const parseFails = []
for (const arm of ARMS) {
  for (let rep = 1; rep <= repeat; rep++) {
    let parsed
    if (provider === 'stub') parsed = { answers: questions.map((q) => (arm.text.includes(`${q.field}=${q.answer}`) ? q.answer : 'UNKNOWN')) }
    else {
      const model = createModel({ provider, model: arg('model') })
      const res = await model.complete({ prompt: arm.text, maxTokens: 16384 /* 4096 不够：该模型的 reasoning 与正文共享配额，实测推演单次烧掉 1540–2422 token，
         赶上偏长的一次就把正文挤没、finish=stop 但内容截断 → 解析失败。实测 3 轮里失手 2 轮，
         差点被读成「差分让模型答不出来」——**基础设施参数不足伪装成实验结论**，是最难查的一类 */ })
      if (!res.parsed) { parseFails.push(`${arm.id} rep${rep}`); console.log(`  ⚠ ${arm.id} rep${rep}：解析失败，本轮作废`); continue }
      parsed = res.parsed
    }
    const s = score(parsed)
    results.push({ arm: arm.id, rep, chars: arm.text.length, ...s })
    console.log(
      `${arm.id} rep${rep}　提示词 ${arm.text.length} 字符　总对 ${s.correct}/${s.n}　` +
      `变更题 ${s.changedCorrect}/12（答旧值 ${s.changedStale}）　未变题 ${s.unchangedCorrect}/12　弃权 ${s.unknown}`,
    )
  }
}

console.log('\n## 汇总（多轮均值）\n')
console.log('| 臂 | 提示词 | 总正确率 | 变更题正确 | **答旧值（过期状态）** | 未变题正确 |')
console.log('|---|---:|---|---|---|---|')
for (const arm of ARMS) {
  const r = results.filter((x) => x.arm === arm.id)
  if (!r.length) { console.log(`| ${arm.id} | — | — | — | — | — |`); continue }
  const avg = (f) => r.reduce((n, x) => n + f(x), 0) / r.length
  console.log(
    `| ${arm.id} | ${r[0].chars} | ${((avg((x) => x.correct) / r[0].n) * 100).toFixed(1)}% | ` +
    `${avg((x) => x.changedCorrect).toFixed(1)}/12 | **${avg((x) => x.changedStale).toFixed(1)}** | ${avg((x) => x.unchangedCorrect).toFixed(1)}/12 |`,
  )
}

// 解析失败必须显式上报：被丢掉的轮次会让样本量悄悄缩水，
// 「3 轮均值」实际只有 1 轮时，那个均值不配叫均值。
if (parseFails.length) console.log(`\n⚠ 有 ${parseFails.length} 轮解析失败已作废：${parseFails.join('、')}——对应臂的样本量按此折算`)
else console.log('\n所有轮次解析成功，无作废')

mkdirSync(join(HERE, 'results'), { recursive: true })
const out = join(HERE, 'results', `delta-${provider}-b${BUDGET}.json`)
writeFileSync(out, JSON.stringify({ provider, budget: BUDGET, repeat, split: SPLIT, questions, results }, null, 2))
console.log(`\n结果已写入 ${out.slice(ROOT.length + 1)}`)
