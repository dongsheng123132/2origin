// 提交编译器——本象协议输出侧的最小实现。
// AI 交上来的不是成品，而是语义事务；事务须通过校验才允许落地。
//
//   validateTransaction() → { ok, violations }   不通过则把 violations 回传模型重试（带证据的门禁）
//   applyTransaction()    → { state, evidence }  通过后折叠进世界状态，并记录每个字段的来源

/** 断言名 → 可复核的谓词。模型自己立的字据，由校验器验收。 */
const ASSERTIONS = {
  'zhao-qi-alive': (s) => s['char:zhao-qi']?.alive === true,
  'gate-not-opened': (s) => s['obj:black-key']?.used === false,
  'betrayal-undisclosed': (s) => !(s['char:lin-zheng']?.knows ?? []).includes('k:bai-yao-betrayal'),
  'key-intact': (s) => s['obj:black-key']?.intact === true,
}

function fold(state, changes) {
  const next = structuredClone(state)
  for (const c of changes) {
    const obj = (next[c.object] ??= {})
    if (c.op === 'append') {
      if (!Array.isArray(obj[c.field])) obj[c.field] = []
      if (!obj[c.field].includes(c.to)) obj[c.field].push(c.to)
    } else {
      obj[c.field] = c.to
    }
  }
  return next
}

export function validateTransaction({ tx, stateBefore, task, hooks = {} }) {
  const v = []
  const changes = tx?.state_changes ?? []

  if (!tx || typeof tx.text !== 'string' || !tx.text.trim()) v.push({ code: 'schema', msg: '事务缺少正文 text' })
  if (!Array.isArray(changes)) return { ok: false, violations: [{ code: 'schema', msg: 'state_changes 必须是数组' }] }

  // ① 结构与引用
  for (const [i, c] of changes.entries()) {
    if (!c.object || !c.field) v.push({ code: 'schema', msg: `state_changes[${i}] 缺少 object 或 field` })
    else if (!stateBefore[c.object]) v.push({ code: 'unknown-object', msg: `state_changes[${i}] 未知对象 ${c.object}` })
    // ② 快照隔离：声明的前值必须接得上当前值，接不上说明模型记错了世界
    else if ('from' in c && c.op !== 'append') {
      const now = stateBefore[c.object][c.field]
      if (JSON.stringify(now) !== JSON.stringify(c.from))
        v.push({
          code: 'stale-write',
          msg: `${c.object}.${c.field} 前值不符：事务声明 ${JSON.stringify(c.from)}，实际 ${JSON.stringify(now)}`,
        })
    }
  }

  const after = fold(stateBefore, changes)

  // ③ 禁区（数据驱动，取自 tasks/continuation.json 的 machine_check）
  for (const fz of task.forbidden_zones ?? []) {
    const mc = fz.machine_check
    if (!mc) continue
    if (mc.type === 'field_must_stay') {
      const got = after[mc.object]?.[mc.field]
      if (JSON.stringify(got) !== JSON.stringify(mc.value))
        v.push({ code: 'forbidden-zone', fz: fz.id, msg: `${fz.rule}｜${mc.object}.${mc.field} 变为 ${JSON.stringify(got)}` })
    } else if (mc.type === 'knows_must_not_gain') {
      if ((after[mc.object]?.knows ?? []).includes(mc.value))
        v.push({ code: 'forbidden-zone', fz: fz.id, msg: `${fz.rule}｜${mc.object} 获得了 ${mc.value}` })
    } else if (mc.type === 'hook_must_stay') {
      const st = hooks[mc.hook]?.status
      if (st && st !== mc.status)
        v.push({ code: 'forbidden-zone', fz: fz.id, msg: `${fz.rule}｜${mc.hook} 状态变为 ${st}` })
    }
  }

  // ④ 模型自报断言的复核
  for (const a of tx?.assertions ?? []) {
    const pred = ASSERTIONS[a]
    if (!pred) v.push({ code: 'unknown-assertion', msg: `断言 ${a} 无法复核（未登记）`, severity: 'warning' })
    else if (!pred(after)) v.push({ code: 'assertion-failed', msg: `模型声明 ${a}，复核不成立` })
  }

  const errors = v.filter((x) => x.severity !== 'warning')
  return { ok: errors.length === 0, violations: v, errors }
}

export function applyTransaction({ tx, state, evidence = {}, chapter }) {
  const next = fold(state, tx.state_changes ?? [])
  const nextEvidence = { ...evidence }
  for (const c of tx.state_changes ?? []) nextEvidence[`${c.object}.${c.field}`] = `ch${chapter}`
  return { state: next, evidence: nextEvidence }
}
