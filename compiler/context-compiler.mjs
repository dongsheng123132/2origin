// 上下文编译器——本象协议的输入侧。
//
// 核心主张：**不把前文全塞进去，而是按当前任务从世界状态里挑出「此刻需要看见的」，并守住预算。**
//
// 与向量 RAG 的分界（ShadowBench-W 二十轮实测，RAG 在状态维度零改善、标准差 0）：
// RAG 检索的是**文本片段**，这里投影的是**当前状态**。「关键物品此刻在谁手上」这种答案
// 不在任何一段原文里——它是一路推演出来的，检索不回来，只能靠状态机维护。

/**
 * 相关性选取：从任务文本里认出被点名的对象，再顺着关系图扩一跳。
 *
 * 领域无关的做法——不假设「主角」「同地点」这类叙事概念，只用两条通用信号：
 *   ① 任务文本里出现了该对象的 id 或 name
 *   ② 它与已选中对象之间存在一条关系（relations 里的三元组）
 * 宿主可以用 pin 参数强行钉住若干对象（如叙事域的 POV 人物）。
 */
export function selectRelevant({ origin, task, pin = [], hops = 1 }) {
  const text = [task?.goal ?? '', JSON.stringify(task?.constraints ?? []), JSON.stringify(task?.forbidden_zones ?? [])].join(' ')
  const picked = new Set(pin)

  for (const o of origin.objects) {
    if (!o.id) continue
    if (text.includes(o.id) || (o.name && text.includes(o.name))) picked.add(o.id)
  }

  for (let i = 0; i < hops; i++) {
    for (const r of origin.relations) {
      if (picked.has(r.subject) && r.object) picked.add(r.object)
      else if (picked.has(r.object) && r.subject) picked.add(r.subject)
    }
  }
  return [...picked].filter((id) => origin.ids.has(id))
}

/**
 * 把状态渲染成给模型看的文本。
 *
 * **实测教训**：字段值一律用完整 ID 呈现。曾为「好读」把命名空间前缀剥掉，
 * 模型照抄了那份人类可读写法，交上来的事务里全是无前缀 ID，被门禁判为未知对象，
 * 5 章全废。给模型看的格式就是它会模仿的格式——**可读性优化必须让位于可回传性**。
 */
function renderObject(id, state, nameOf) {
  const s = state[id] ?? {}
  const bits = []
  for (const [k, val] of Object.entries(s)) {
    if (k === '_type' || val === undefined || val === null) continue
    if (Array.isArray(val)) {
      if (val.length) bits.push(`${k}=[${val.join(', ')}]`)
    } else if (typeof val === 'object') continue
    else bits.push(`${k}=${val}`)
  }
  const label = nameOf[id] && nameOf[id] !== id ? `（${nameOf[id]}）` : ''
  return `  ${id}${label} ${bits.join('；')}`.trimEnd()
}

/**
 * 编译上下文。
 * @param budget 字符预算。超出时优先保状态与约束，最后才截 recentText——
 *               状态是别处拿不到的，原文尾巴是可再取的。
 */
export function compileContext({ origin, task, state = origin.state, pin = [], budget = 6000, recentText = '', hops = 1 }) {
  const ids = selectRelevant({ origin, task, pin, hops })
  const nameOf = Object.fromEntries(origin.objects.map((o) => [o.id, o.name ?? o.title ?? o.id]))

  const lines = []
  if (task?.goal) lines.push(`【任务】${task.goal}`)

  lines.push('\n【相关对象·当前状态】（字段值请原样照抄，含 ID 前缀）')
  for (const id of ids) lines.push(renderObject(id, state, nameOf))

  const enforceable = (origin.constraints ?? []).filter((c) => c.check)
  const advisory = (origin.constraints ?? []).filter((c) => !c.check)
  if (enforceable.length) {
    lines.push('\n【约束·机器校验，违反即拒绝】')
    for (const c of enforceable) lines.push(`  - ${c.rule ?? c.id}`)
  }
  if (advisory.length) {
    lines.push('\n【约束·人工复核】')
    for (const c of advisory) lines.push(`  - ${c.rule ?? c.id}`)
  }

  if (task?.forbidden_zones?.length) {
    lines.push('\n【禁区·越界即判失败】')
    for (const fz of task.forbidden_zones) lines.push(`  - ${fz.rule ?? fz.id}`)
  }

  if (recentText) {
    const room = Math.max(0, budget - lines.join('\n').length)
    if (room > 0) lines.push('\n【最近内容（节选）】\n' + recentText.slice(-room))
  }

  const body = lines.join('\n')
  return { text: body, selected: ids, estChars: body.length, overBudget: body.length > budget }
}

/** 附上输出契约。模型只有知道要交什么形状的事务，才可能交对。 */
export function buildPrompt(ctx, { extra = '' } = {}) {
  return `${ctx.text}

【输出格式】只输出一个 JSON 对象，不要有其他文字：
{
  "transaction_id": "tx-<序号>",
  "operation": "<语义操作名>",
  "target": "<目标对象 ID>",
  "state_changes": [ { "object": "对象ID", "field": "字段", "from": 变更前值, "to": 变更后值 } ],
  "assertions": ["<你声明未违反的边界>"]
}
state_changes 只写本次真实发生的状态变化。
object 与取值必须原样使用上文给出的完整 ID，不可省略前缀。
from 应与上文所给当前状态一致；不确定就不要写这条变更。
assertions 将由校验器逐条复核——写了做不到会被判失败。${extra ? '\n' + extra : ''}`
}
