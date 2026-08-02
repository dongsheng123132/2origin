// A3 · Benxiang 臂：状态机 + 语义事务 + 证据链 + 预算编译。
// 每章一个循环：编译上下文 → 模型出事务 → 校验 → 不过则带违规回退重试 → 通过才落地。

import { compileContext, buildPrompt } from './context-compiler.mjs'
import { validateTransaction, applyTransaction, normalizeTransaction } from './commit-compiler.mjs'

export const meta = { id: 'a3-benxiang', name: 'Benxiang（状态机+事务+证据+预算编译）' }

export async function run({ spec, task, state0, chapters, model, budget = 6000, maxRetries = 2, corpusTail = '' }) {
  let state = structuredClone(state0)
  let evidence = {}
  const knownIds = new Set([
    ...spec.characters.map((c) => c.id),
    ...spec.objects.map((o) => o.id),
    ...(spec.locations ?? []).map((l) => l.id),
    ...spec.hooks.map((h) => h.id),
  ])
  const hooks = Object.fromEntries(spec.hooks.map((h) => [h.id, { status: h.status }]))
  const out = []
  const usage = { inputTokens: 0, outputTokens: 0, ms: 0, calls: 0 }
  const gate = { attempts: 0, rejections: 0, byCode: {}, warnings: {}, rejected: [] }
  // 精确载荷层（三层投影里的「原文负责准」）。曾漏接此参数，导致本臂在完全没读过
  // 前文正文的情况下续写——结构状态齐备、文体与既有惯例全无依据，原文层错误反超裸模型。
  let recentText = corpusTail

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

      const tx = normalizeTransaction(res.parsed, knownIds)
      const check = validateTransaction({ tx, stateBefore: state, task, hooks, spec })
      // 警告不拦截，但要计数——模型对世界的记忆偏差是有价值的观测量
      for (const w of check.violations.filter((x) => x.severity === 'warning')) {
        gate.warnings[w.code] = (gate.warnings[w.code] ?? 0) + 1
      }
      if (check.ok) {
        accepted = tx
        break
      }
      gate.rejections++
      for (const v of check.errors) gate.byCode[v.code] = (gate.byCode[v.code] ?? 0) + 1
      // 记录被拒事务，否则「全被拒」时无从诊断
      gate.rejected.push({
        chapter,
        attempt,
        submitted: tx?.state_changes ?? null,
        textLen: tx?.text?.length ?? 0,
        errors: check.errors.map((v) => `[${v.code}] ${v.msg}`),
      })

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
