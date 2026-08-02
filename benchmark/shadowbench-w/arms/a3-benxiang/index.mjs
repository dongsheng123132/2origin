// A3 · Benxiang 臂：状态机 + 语义事务 + 证据链 + 预算编译。
// 每章一个循环：编译上下文 → 模型出事务 → 校验 → 不过则带违规回退重试 → 通过才落地。

import { compileContext, buildPrompt } from './context-compiler.mjs'
import { validateTransaction, applyTransaction } from './commit-compiler.mjs'

export const meta = { id: 'a3-benxiang', name: 'Benxiang（状态机+事务+证据+预算编译）' }

export async function run({ spec, task, state0, chapters, model, budget = 6000, maxRetries = 2 }) {
  let state = structuredClone(state0)
  let evidence = {}
  const hooks = Object.fromEntries(spec.hooks.map((h) => [h.id, { status: h.status }]))
  const out = []
  const usage = { inputTokens: 0, outputTokens: 0, ms: 0, calls: 0 }
  const gate = { attempts: 0, rejections: 0, byCode: {} }
  let recentText = ''

  for (const chapter of chapters) {
    const ctx = compileContext({ spec, state, task, chapter, budget, recentText })
    let prompt = buildPrompt(ctx)
    let accepted = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      gate.attempts++
      const res = await model.complete({ prompt, chapter })
      usage.inputTokens += res.usage.inputTokens
      usage.outputTokens += res.usage.outputTokens
      usage.ms += res.usage.ms
      usage.calls++

      const tx = res.parsed
      const check = validateTransaction({ tx, stateBefore: state, task, hooks })
      if (check.ok) {
        accepted = tx
        break
      }
      gate.rejections++
      for (const v of check.errors) gate.byCode[v.code] = (gate.byCode[v.code] ?? 0) + 1

      // 带证据的退回：把具体违规讲清楚，而不是笼统说「不一致」
      prompt =
        buildPrompt(ctx) +
        `\n\n【上一次提交被校验器拒绝，请修正后重新提交】\n` +
        check.errors.map((v) => `  - [${v.code}] ${v.msg}`).join('\n')
    }

    if (!accepted) {
      out.push({ chapter, text: '', rejected: true })
      continue
    }
    ;({ state, evidence } = applyTransaction({ tx: accepted, state, evidence, chapter }))
    out.push({ chapter, text: accepted.text })
    recentText = accepted.text
  }

  return { arm: meta.id, stub: model.stub, chapters: out, state, hooks, evidence, usage, gate }
}
