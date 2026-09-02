// 浏览器端叙事状态引擎——独立于 xlsx demo 的 engine.js。
// fold() 的语义照抄 compiler/commit-compiler.mjs 里的 fold()：op:'append' 时按集合去重追加，
// 否则整字段替换。这是本引擎与 xlsx engine.js 的关键差异——xlsx 案例包没有 append 语义。
;(function () {
  function fold(state, changes) {
    const next = JSON.parse(JSON.stringify(state))
    for (const c of changes || []) {
      if (!c || !c.object || !c.field) continue
      const obj = next[c.object] || (next[c.object] = {})
      if (c.op === 'append') {
        if (!Array.isArray(obj[c.field])) obj[c.field] = []
        if (obj[c.field].indexOf(c.to) === -1) obj[c.field].push(c.to)
      } else {
        obj[c.field] = c.to
      }
    }
    return next
  }

  function stateFromObjects(objects) {
    const state = {}
    for (const o of objects) {
      const { id, ...rest } = o
      state[id] = rest
    }
    return state
  }

  // 按 history 顺序逐条 fold，返回每一步之后的状态快照数组（下标 0 = 起始状态，未套用任何 history）。
  function replaySteps(base, history) {
    const steps = [stateFromObjects(base)]
    let cur = steps[0]
    for (const h of history) {
      cur = fold(cur, [{ object: h.object, field: h.field, to: h.to, op: h.op }])
      steps.push(cur)
    }
    return steps
  }

  const CHECKS = {
    equals: (v, c) => v === c.value,
    not_equals: (v, c) => v !== c.value,
    contains: (v, c) => Array.isArray(v) && v.includes(c.value),
    not_contains: (v, c) => !Array.isArray(v) || !v.includes(c.value),
  }

  function checkOne(state, c) {
    const obj = state[c.check.object] || {}
    const v = obj[c.check.field]
    const fn = CHECKS[c.check.type]
    if (!fn) return { ok: false, reason: '未知判据类型 ' + c.check.type }
    const ok = fn(v, c.check)
    return { ok, id: c.id, rule: c.rule, actual: v }
  }

  function checkAll(state, constraints) {
    return constraints.map((c) => checkOne(state, c))
  }

  // 把一笔待提交事务的 state_changes 折进当前状态，跑全部约束，返回 { state, results, accepted }。
  function diagnoseTx(state, stateChanges, constraints) {
    const next = fold(state, stateChanges)
    const results = checkAll(next, constraints)
    const violated = results.filter((r) => !r.ok)
    return { state: next, results, accepted: violated.length === 0, violated }
  }

  window.StoryEngine = { fold, stateFromObjects, replaySteps, checkAll, checkOne, diagnoseTx }
})()
