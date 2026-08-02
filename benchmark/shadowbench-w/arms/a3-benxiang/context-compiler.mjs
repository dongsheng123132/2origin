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

  // 一律用完整 ID 呈现字段值——曾为「好读」把 loc:/char: 前缀剥掉，
  // 模型照抄了那份人类可读的写法，事务里全是无前缀 ID，被门禁判为未知对象、5 章全废。
  lines.push('\n【相关人物·当前状态】（字段值请原样照抄，含前缀）')
  for (const id of chars) {
    const s = state[id] ?? {}
    const bits = []
    if (s.location) bits.push(`location=${s.location}`)
    if (s.left_hand_injured) bits.push('left_hand_injured=true')
    if (s.alive === false) bits.push('alive=false')
    if (s.knows?.length) bits.push(`knows=[${s.knows.join(', ')}]`)
    lines.push(`  ${id}（${nameOf[id] ?? id}）${bits.join('；')}`)
  }

  lines.push('\n【关键物品】')
  for (const o of spec.objects) {
    const s = state[o.id] ?? {}
    if (!s.holder && !s.location) continue
    lines.push(`  ${o.id}（${o.name}）holder=${s.holder ?? 'null'}${s.used !== undefined ? `；used=${s.used}` : ''}`)
  }

  lines.push('\n【可用地点 ID】')
  lines.push('  ' + (spec.locations ?? []).map((l) => `${l.id}（${l.name}）`).join('　'))

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
state_changes 只写本章真实发生的状态变化。
object 与取值必须原样使用上文给出的完整 ID（如 char:lin-zheng、loc:dukou-teahouse），不可省略前缀。
from 必须与上文所给的当前状态一致；不确定就不要写这条变更。
assertions 是你声明本章未违反的边界，将由校验器逐条复核——写了做不到会被判失败。`
}
