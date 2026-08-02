// 上下文编译器——本象协议输入侧的最小实现。
// 不是把前文全塞进去，而是按当前任务从世界状态里挑出「此刻需要看见的」，并控制预算。

const has = (s, sub) => s.includes(sub)

/** 挑出与本次任务相关的人物：主角 + 目标涉及者 + 禁区涉及者 + 与主角同地者 */
function relevantCharacters(spec, state, task) {
  const ids = new Set()
  const text = task.goal + JSON.stringify(task.forbidden_zones ?? [])
  for (const c of spec.characters) {
    if (has(text, c.name) || has(text, c.id)) ids.add(c.id)
  }
  const pov = spec.characters.find((c) => c.role === 'protagonist')
  if (pov) ids.add(pov.id)
  const povLoc = state[pov?.id]?.location
  for (const c of spec.characters) if (povLoc && state[c.id]?.location === povLoc) ids.add(c.id)
  // 持有任务关键物品者
  for (const o of spec.objects) if (has(text, o.name)) { const h = state[o.id]?.holder; if (h) ids.add(h) }
  return [...ids]
}

export function compileContext({ spec, state, task, chapter, budget = 6000, recentText = '' }) {
  const chars = relevantCharacters(spec, state, task)
  const nameOf = Object.fromEntries(spec.characters.map((c) => [c.id, c.name]))

  const lines = []
  lines.push(`【任务】写第 ${chapter} 章，约 3000 字。总目标：${task.goal}`)

  lines.push('\n【相关人物·当前状态】')
  for (const id of chars) {
    const s = state[id] ?? {}
    const bits = []
    if (s.location) bits.push(`在${s.location.replace(/^loc:/, '')}`)
    if (s.left_hand_injured) bits.push('左手有伤')
    if (s.alive === false) bits.push('已死')
    if (s.knows?.length) bits.push(`知晓：${s.knows.map((k) => k.replace(/^k:/, '')).join('、')}`)
    lines.push(`  ${nameOf[id] ?? id}（${id}）${bits.join('；')}`)
  }

  lines.push('\n【关键物品】')
  for (const o of spec.objects) {
    const s = state[o.id] ?? {}
    if (!s.holder && !s.location) continue
    lines.push(`  ${o.name}（${o.id}）持有者：${nameOf[s.holder] ?? s.holder ?? '无'}${s.used ? '，已使用' : ''}`)
  }

  lines.push('\n【世界规则·不可违反】')
  for (const r of spec.rules) lines.push(`  - ${r.statement}`)

  lines.push('\n【未回收伏笔】')
  for (const h of spec.hooks.filter((h) => h.status === 'planted_unresolved'))
    lines.push(`  - ${h.id}：${h.summary}（第 ${h.setup.chapter} 章埋下）`)

  lines.push('\n【禁区·越界即判失败】')
  for (const fz of task.forbidden_zones ?? []) lines.push(`  - ${fz.rule}`)

  if (recentText) {
    // 精确载荷按预算截取：只给最近正文的尾部
    const room = Math.max(0, budget - lines.join('\n').length)
    lines.push('\n【最近正文（节选）】\n' + recentText.slice(-room))
  }

  const body = lines.join('\n')
  return {
    text: body,
    selected: { characters: chars.length, rules: spec.rules.length, hooks: spec.hooks.filter((h) => h.status === 'planted_unresolved').length },
    estChars: body.length,
  }
}

export function buildPrompt(ctx) {
  return `${ctx.text}

【输出格式】只输出一个 JSON 对象，不要有其他文字：
{
  "text": "本章正文（约3000字）",
  "state_changes": [ { "object": "对象ID", "field": "字段", "from": 变更前值, "to": 变更后值 } ],
  "assertions": ["zhao-qi-alive", "gate-not-opened", "betrayal-undisclosed"]
}
state_changes 只写本章真实发生的状态变化；from 必须与上文所给的当前状态一致。
assertions 是你声明本章未违反的边界，将由校验器逐条复核——写了做不到会被判失败。`
}
