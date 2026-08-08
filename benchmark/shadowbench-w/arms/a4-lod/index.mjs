// A4 · Benxiang + 预算斜坡臂。
//
// 与 A3 的唯一差别：输入侧开 `lod: true`，启用核心的相机 + 三档 LOD + 预算斜坡。
// 世界规则、地点词表、禁区在着色器里进 fixed 段，不参与降级；人物与物品按远近降/升档。
//
// **为什么必须另开一臂，而不是把 A3 改掉。**
// results-log.md 里 W1/W2/W3 的数字是旧投影跑出来的。投影器的产出就是提示词本身，
// 差一个字，那些数字就不再是「这套输入下的成绩」。本仓库为此撤回过两次结论
// （第七起、Gate 0），也为此有 armsHash——规格与判分器没变、**跑法**变了，分数照样会动。
// 所以：A3 保持逐字节不变（projection-equivalence.mjs 以 81 例守住），
// LOD 作为 A4 从零跑分，两组数字各自成立，不互相顶替。
//
// 预期的作用面（跑之前先写下来，免得事后挑一个好看的解释）：
//   S 级世界只有 8 人物 + 6 物品，budget 6000 下状态段约 1.3k 字符，**装得下**。
//   所以 A4 与 A3 在这个世界上大概率**没有显著差异**——斜坡无用武之地。
//   真正会分开的是大世界（对象数把预算撑爆），S 级不是。若跑出显著差异，
//   更该怀疑是方差而不是机制（单次运行方差大到能翻转结论，见 results-log）。

import { compileContext, buildPrompt } from '../a3-benxiang/context-compiler.mjs'
import { validateTransaction, applyTransaction, normalizeTransaction } from '../a3-benxiang/commit-compiler.mjs'

export const meta = { id: 'a4-lod', name: 'Benxiang + 预算斜坡（相机·LOD·升降档）' }

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
  const gate = { attempts: 0, rejections: 0, byCode: {}, warnings: {}, rejected: [], needsReview: [] }
  // 投影侧观测量：这一臂到底有没有真的降档过。全是 full 就等于跑了个 A3，
  // 结论要照此解释——不能把「机制没被触发」讲成「机制没用」。
  const lodStats = { frames: 0, degraded: 0, dropped: 0, utilization: [] }
  let recentText = corpusTail

  for (const chapter of chapters) {
    const ctx = compileContext({ spec, state, task, chapter, budget, recentText, lod: true })
    lodStats.frames++
    if (ctx.byLevel && (ctx.byLevel.key.length || ctx.byLevel.id.length)) lodStats.degraded++
    lodStats.dropped += ctx.dropped?.length ?? 0
    if (ctx.utilization) lodStats.utilization.push(ctx.utilization)

    let prompt = buildPrompt(ctx)
    let accepted = null
    let best = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      gate.attempts++
      const res = await model.complete({ prompt, chapter })
      usage.inputTokens += res.usage.inputTokens
      usage.outputTokens += res.usage.outputTokens
      usage.ms += res.usage.ms
      usage.calls++

      const tx = normalizeTransaction(res.parsed, knownIds)
      const check = validateTransaction({ tx, stateBefore: state, task, hooks, spec })
      for (const w of check.violations.filter((x) => x.severity === 'warning')) {
        gate.warnings[w.code] = (gate.warnings[w.code] ?? 0) + 1
      }
      if (check.ok) { accepted = tx; break }
      gate.rejections++
      for (const v of check.errors) gate.byCode[v.code] = (gate.byCode[v.code] ?? 0) + 1
      if (tx?.text && (!best || check.errors.length < best.errors)) best = { tx, errors: check.errors.length }
      gate.rejected.push({
        chapter, attempt,
        submitted: tx?.state_changes ?? null,
        textLen: tx?.text?.length ?? 0,
        errors: check.errors.map((v) => `[${v.code}] ${v.msg}`),
      })
      prompt =
        buildPrompt(ctx) +
        `\n\n【上一次提交被校验器拒绝，请修正后重新提交】\n` +
        check.errors.map((v) => `  - [${v.code}] ${v.msg}`).join('\n')
    }

    if (!accepted && best) {
      accepted = best.tx
      gate.needsReview.push({ chapter, remainingErrors: best.errors })
    }
    if (!accepted) { out.push({ chapter, text: '', rejected: true }); continue }
    ;({ state, evidence } = applyTransaction({ tx: accepted, state, evidence, chapter }))
    out.push({ chapter, text: accepted.text, needsReview: gate.needsReview.some((r) => r.chapter === chapter) })
    recentText = accepted.text
  }

  return { arm: meta.id, stub: model.stub, chapters: out, state, hooks, evidence, usage, gate, lodStats }
}
