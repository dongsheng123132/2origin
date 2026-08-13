// A2 · 纯提示词状态维护。
//
// 这条臂只检验一个问题：要求模型在每章正文旁维护一份可查询的 JSON 世界状态，
// 本身能带来多少收益？它拿到与 A3 相同的世界规则、禁区和初始状态，但刻意没有：
//   - 上下文编译器（状态与规则原样给出，最近正文只做和 A0 相同的尾部截断）
//   - 事务/证据链（每章直接重写完整 state/hooks）
//   - 校验与退回（模型输出无论对错都只调用一次，不重试）

export const meta = { id: 'a2-prompt-state', name: '纯提示词状态维护（无校验/证据/上下文编译）' }

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function buildPrompt({ spec, task, chapter, state, hooks, recentText, budget }) {
  const rules = (spec.rules ?? []).map((r) => `  - ${r.statement}`).join('\n') || '  （无）'
  const forbidden = (task.forbidden_zones ?? []).map((fz) => `  - ${fz.rule}`).join('\n') || '  （无）'

  return `【任务】写第 ${chapter} 章，约 3000 字。总目标：${task.goal}

【当前世界状态】
${JSON.stringify(state, null, 2)}

【当前伏笔状态】
${JSON.stringify(hooks, null, 2)}

【世界规则·不可违反】
${rules}

【禁区·不可违反】
${forbidden}

【最近正文（尾部截断）】
${recentText.slice(-budget)}

你必须在写正文的同时维护可查询的世界状态。只输出一个 JSON 对象，不要有其他文字：
{
  "text": "本章正文（约3000字）",
  "state": { "对象ID": { "字段": "本章结束后的值" } },
  "hooks": { "伏笔ID": { "status": "本章结束后的状态" } }
}
state 和 hooks 必须是本章结束后的完整快照：继承未变化字段，并写入本章真实发生的变化；
所有 ID 与字段名必须原样保留。不要输出 evidence、state_changes 或 assertions。`
}

export async function run({ spec, task, state0, chapters, model, budget = 6000, corpusTail = '' }) {
  let state = structuredClone(state0)
  let hooks = Object.fromEntries((spec.hooks ?? []).map((h) => [h.id, { status: h.status }]))
  let recentText = corpusTail
  const out = []
  const usage = { inputTokens: 0, outputTokens: 0, ms: 0, calls: 0 }
  const promptOnly = { parseFailures: [], stateSnapshots: 0 }

  for (const chapter of chapters) {
    const prompt = buildPrompt({ spec, task, chapter, state, hooks, recentText, budget })
    const res = await model.complete({ prompt, chapter })
    usage.inputTokens += res.usage.inputTokens
    usage.outputTokens += res.usage.outputTokens
    usage.ms += res.usage.ms
    usage.calls++

    const parsed = res.parsed
    const text = typeof parsed?.text === 'string' ? parsed.text : res.raw
    const hasState = isRecord(parsed?.state)
    const hasHooks = isRecord(parsed?.hooks)

    // A2 没有校验与退回：格式不合格也不重试。保留上一份快照继续写，避免一次 JSON
    // 解析失败把所有已知世界状态凭空清零；同时把失败显式记账，不能静默伪装成成功。
    if (hasState) state = structuredClone(parsed.state)
    if (hasHooks) hooks = structuredClone(parsed.hooks)
    if (hasState && hasHooks) promptOnly.stateSnapshots++
    else promptOnly.parseFailures.push({ chapter, missingState: !hasState, missingHooks: !hasHooks })

    out.push({ chapter, text, stateReported: hasState, hooksReported: hasHooks })
    recentText = text
  }

  return {
    arm: meta.id,
    stub: model.stub,
    chapters: out,
    state,
    hooks,
    evidence: {},
    usage,
    gate: null,
    promptOnly,
  }
}
