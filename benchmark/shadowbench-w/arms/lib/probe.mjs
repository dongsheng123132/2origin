// 无状态臂（A0/A1）的 W3 状态探询——**唯一一份**。
//
// A3 的状态来自自己的状态机；没有状态机的臂只能额外问一轮「你把世界写成什么样了」，
// 这一轮的 Token 照计。这是给对照臂的公平采集方式，不是给它们的惩罚。
//
// ── 为什么单独成模块（2026-08-05，第八起事故的修法）──────────────────────
// 原先 A0 与 A1 各存一份提示词，靠一句注释约定「必须完全相同」。约定不是机制：
// 两份字符串迟早会漂，而 W3 的差异会混进「提问方式的差异」。现在只有一份。
//
// ── 第八起事故（Run #18）修了什么 ────────────────────────────────────────
// 旧探询有三个致命缺陷，任何一个单独出现都足以让 W3 失去意义：
//
//   ① **不传上下文**。`complete()` 每次只发一条 user 消息，不带历史。而提示词第一句是
//      「根据你刚写的内容」——模型从未见过那些正文。等于让一个失忆的人复述他没读过的书。
//   ② **模板泄题**。示例 JSON 里把 `used:false`、`intact:true`、`alive:true`、
//      `left_hand_injured:true`、`secret_betrayal:true` 的**正确值字面写了出来**，
//      照抄即得 5 分；`knows:[...]` 填空数组又白送 1 分。
//   ③ **问的和判的不是一套**。`hook:shen-yan-suspicion.status` 计入分母却从不出现在
//      模板里，对照臂结构上永远拿不到这一分。
//
//   6÷8 = 75.0%——那个「二十轮零方差」的墙，是模板自己的答案。
//
// 三条对应的修法：
//   ① 把该臂**本轮写出的全部正文**随探询送入（默认全量，不截断——见下）
//   ② 所有值改为占位符，**一个真值都不出现**
//   ③ 待问字段**从答案集的 must_hold 键派生**，问的与判的从此不可能不一致
//
// ── 为什么默认给全量正文而不是按预算截断 ─────────────────────────────────
// 「世界被你写成什么样了」这个问题，唯一的依据就是它自己写的那些字。截断会人为削弱
// 对照臂，而 A1 的设计原则写得很清楚：它必须是一个**尽力做好的** RAG，不是一个便于
// 被打败的稻草人。同理，A0 也该拿到它自己写的全部内容。若给了全文仍答不上来，
// 那才是真结论。代价（探询输入 Token 变大）照实计入该臂成本。

/** "char:lin-zheng.knows.not_contains" → { id, field, op } —— 与 state-diff.mjs 同一套解析 */
function parseKey(key) {
  const [id, field, op] = key.split('.')
  return { id, field, op: op ?? 'equals' }
}

/**
 * 占位符：只暗示**类型**，绝不泄露取值。
 *
 * 布尔值曾写作 `<true 或 false>`——不算泄露单个答案，但按固定顺序列举选项本身就是偏置：
 * 八个待判字段里有四个布尔答案为 true，只挑第一个选项就白得 4 分。
 * 改成不列举取值的纯类型提示，任何「照着题面猜」的策略都拿不到分。
 */
function placeholder(op, want) {
  if (op === 'not_contains') return '["<知识ID>", "…"]'
  if (typeof want === 'boolean') return '<布尔值>'
  if (typeof want === 'string' && want.startsWith('char:')) return '"<角色ID，形如 char:xxx>"'
  if (typeof want === 'string' && want.startsWith('obj:')) return '"<物品ID，形如 obj:xxx>"'
  return '"<取值>"'
}

/**
 * 从答案集派生待问字段。
 * **这是第③条修法的机制**：问什么由 must_hold 的键决定，不再手写一份可能对不上的模板。
 */
export function buildProbeShape(task) {
  const must = task.expected_state_after?.must_hold ?? {}
  const state = {}
  const hooks = {}
  for (const [key, want] of Object.entries(must)) {
    if (key === 'note') continue
    const { id, field, op } = parseKey(key)
    const bucket = id.startsWith('hook:') ? hooks : state
    ;(bucket[id] ??= {})[field] = placeholder(op, want)
  }
  return { state, hooks }
}

/** 把 shape 渲染成 JSON 骨架（占位符不加引号，故不能用 JSON.stringify） */
function renderShape(shape) {
  const section = (obj) =>
    Object.entries(obj)
      .map(([id, fields]) => {
        const inner = Object.entries(fields).map(([f, ph]) => `      "${f}": ${ph}`).join(',\n')
        return `    "${id}": {\n${inner}\n    }`
      })
      .join(',\n')
  const parts = [`  "state": {\n${section(shape.state)}\n  }`]
  if (Object.keys(shape.hooks).length) parts.push(`  "hooks": {\n${section(shape.hooks)}\n  }`)
  return `{\n${parts.join(',\n')}\n}`
}

/**
 * 完整角色名册。**这不是给提示，是在消除提示。**
 *
 * 骨架里必然出现某些角色 ID（比如要问「林峥知道哪些事」就得写出 char:lin-zheng）。
 * 而 S 级考题的正确持有者恰好就是 char:lin-zheng——于是正确答案以「另一个问题的主语」
 * 的身份印在了题面上，等于点名。M 级答案是 char:shen-yan，纯属侥幸躲过。
 *
 * 解法不是把角色藏起来（藏不掉），是让**所有**候选同等出现：名册齐全时，
 * 「出现在题面上」这件事本身不携带任何信息。A3 的上下文编译器本来就给全量地点 ID，
 * 给对照臂全量角色 ID 是同一种做法，不构成额外优待。
 */
function roster(spec) {
  if (!spec?.characters?.length) return ''
  return `\n【可用角色 ID】\n  ` + spec.characters.map((c) => `${c.id}（${c.name}）`).join('　') + '\n'
}

export function buildProbePrompt({ task, written, spec = null }) {
  const shape = renderShape(buildProbeShape(task))
  return (
    `以下是你在本次续写中写出的全部正文：\n\n${written}\n\n` +
    `${'─'.repeat(40)}\n${roster(spec)}\n` +
    `请根据以上正文，报告当前世界状态。只输出一个 JSON 对象，不要有其他文字：\n\n${shape}\n\n` +
    `要求：\n` +
    `- 每个字段都必须给出**实际取值**，不得原样保留尖括号占位符。\n` +
    `- 不确定也要给出你的判断，不要留空、不要写 null。\n` +
    `- ID 一律使用完整前缀（char: / obj: / hook: / k:）。`
  )
}

/**
 * 跑一轮状态探询。返回 { state, hooks, diag }，并就地累加 usage。
 *
 * diag 是第④条修法：`model.mjs` 早就算出了 finishReason / reasoningTokens，
 * 臂却把它们丢了——于是「格式失败 / 解析失败 / 模型不上报」三种情况在盘上无法区分，
 * deepseek 上那些整轮 0% 至今说不清是谁的锅。现在落盘。
 */
export async function probeState({ model, task, written, chapter, usage, spec = null }) {
  const prompt = buildProbePrompt({ task, written, spec })
  const res = await model.complete({ prompt, chapter })
  usage.inputTokens += res.usage.inputTokens
  usage.outputTokens += res.usage.outputTokens
  usage.ms += res.usage.ms ?? 0
  usage.calls++

  return {
    state: res.parsed?.state ?? {},
    hooks: res.parsed?.hooks ?? {},
    diag: {
      promptChars: prompt.length,
      writtenChars: written.length,
      parsed: !!res.parsed,
      finishReason: res.finishReason ?? null,
      reasoningTokens: res.usage?.reasoningTokens ?? null,
      // 解析失败时 raw 是唯一线索，必须留下；成功时也留个头，便于核对是不是照抄了占位符
      raw: (res.raw ?? '').slice(0, 2000),
    },
  }
}
