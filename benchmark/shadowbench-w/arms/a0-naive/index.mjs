// A0 · 裸模型 + 尾部截断：最朴素基线。无状态、无校验、无证据。
// 注意：ConStory-Bench 的数据显示这条基线意外地强，Gate 0 就是要跟它比。

export const meta = { id: 'a0-naive', name: '裸模型 + 尾部截断' }

export async function run({ task, chapters, model, corpusTail = '', budget = 6000 }) {
  const out = []
  const usage = { inputTokens: 0, outputTokens: 0, ms: 0, calls: 0 }
  let tail = corpusTail

  for (const chapter of chapters) {
    const prompt =
      `以下是一部长篇小说的最近正文（因篇幅所限只给出结尾部分）：\n\n${tail.slice(-budget)}\n\n` +
      `请接着写第 ${chapter} 章，约 3000 字。总目标：${task.goal}\n` +
      `只输出 JSON：{"text": "本章正文"}`
    const res = await model.complete({ prompt, chapter })
    usage.inputTokens += res.usage.inputTokens
    usage.outputTokens += res.usage.outputTokens
    usage.ms += res.usage.ms
    usage.calls++
    const text = res.parsed?.text ?? res.raw
    out.push({ chapter, text })
    tail += '\n' + text
  }

  // W3 数据采集：无状态的臂只能额外问一轮「现在世界是什么样」——这一轮的成本照计
  const probe = await model.complete({
    prompt:
      `根据你刚写的内容，输出当前世界状态 JSON：\n` +
      `{"state": {"obj:black-key": {"holder": "...", "used": false, "intact": true},` +
      ` "char:zhao-qi": {"alive": true}, "char:bai-yao": {"left_hand_injured": true, "secret_betrayal": true},` +
      ` "char:lin-zheng": {"knows": [...]}}}`,
    chapter: chapters.at(-1),
  })
  usage.inputTokens += probe.usage.inputTokens
  usage.outputTokens += probe.usage.outputTokens
  usage.calls++

  return {
    arm: meta.id,
    stub: model.stub,
    chapters: out,
    state: probe.parsed?.state ?? {},
    hooks: {},
    evidence: {},
    usage,
    gate: null,
  }
}
