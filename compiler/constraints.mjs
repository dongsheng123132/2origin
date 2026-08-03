// 约束谓词——协议里唯一「判对错」的地方，必须领域无关。
//
// 为什么这是协议化的关键：
// ShadowBench-W 的实验臂里，约束是三个写死的类型（field_must_stay / knows_must_not_gain /
// hook_must_stay），名字里就带着小说的味道——「knows」「hook」是叙事概念。销售数据那边
// 则是另一套（revenue must_not_be_negative）。若每个域各写各的校验器，那就不是协议，
// 只是若干个碰巧长得像的程序。
//
// 这里把它们收敛成一组小而完备的谓词：**字段等于 / 不等于 / 不含 / 不变 / 在范围内**。
// 三个小说类型全部可以表达（见下表），销售的非负约束也可以，且都不需要改代码：
//
//   field_must_stay      → { type: 'equals',       object, field, value }
//   knows_must_not_gain  → { type: 'not_contains', object, field: 'knows', value }
//   hook_must_stay       → { type: 'equals',       object: '<hook-id>', field: 'status', value }
//   revenue 非负         → { type: 'range',        object, field, min: 0 }
//
// 约束是**数据**，不是代码。新增一个领域不该需要动这个文件。

const get = (state, object, field) => state?.[object]?.[field]

/** 每个谓词：(state, c) → null 表示通过，否则返回违规描述 */
const PREDICATES = {
  equals: (state, c) => {
    const got = get(state, c.object, c.field)
    return JSON.stringify(got) === JSON.stringify(c.value)
      ? null
      : `${c.object}.${c.field} 应为 ${JSON.stringify(c.value)}，实为 ${JSON.stringify(got)}`
  },

  not_equals: (state, c) => {
    const got = get(state, c.object, c.field)
    return JSON.stringify(got) !== JSON.stringify(c.value) ? null : `${c.object}.${c.field} 不得为 ${JSON.stringify(c.value)}`
  },

  // 数组字段不得获得某个值——「主角不得知道这个秘密」「清单不得混入该项」同构
  not_contains: (state, c) => {
    const arr = get(state, c.object, c.field)
    if (!Array.isArray(arr)) return null
    return arr.includes(c.value) ? `${c.object}.${c.field} 不得包含 ${JSON.stringify(c.value)}` : null
  },

  contains: (state, c) => {
    const arr = get(state, c.object, c.field)
    return Array.isArray(arr) && arr.includes(c.value) ? null : `${c.object}.${c.field} 必须包含 ${JSON.stringify(c.value)}`
  },

  range: (state, c) => {
    const got = get(state, c.object, c.field)
    if (typeof got !== 'number') return null // 字段不存在或非数值时不判——缺失由 required 类约束负责
    if (c.min !== undefined && got < c.min) return `${c.object}.${c.field} = ${got}，低于下限 ${c.min}`
    if (c.max !== undefined && got > c.max) return `${c.object}.${c.field} = ${got}，高于上限 ${c.max}`
    return null
  },

  // 与 equals 的区别：不需要预先知道该等于什么，只要求这次事务没动它
  unchanged: (state, c, stateBefore) => {
    const before = get(stateBefore, c.object, c.field)
    const after = get(state, c.object, c.field)
    return JSON.stringify(before) === JSON.stringify(after)
      ? null
      : `${c.object}.${c.field} 不得改动（${JSON.stringify(before)} → ${JSON.stringify(after)}）`
  },
}

/**
 * 校验一批约束。
 * @param stateAfter  事务折叠后的状态
 * @param constraints 约束数组，每条形如 { id?, rule?, severity?, check: {type, ...} }
 * @param stateBefore 事务折叠前的状态（unchanged 谓词需要）
 * @returns 违规列表；severity 缺省为 'error'
 */
export function checkConstraints(stateAfter, constraints = [], stateBefore = {}) {
  const out = []
  for (const c of constraints) {
    const check = c.check
    // 没有 machine_check 的约束是**人类可读的意图声明**，不是可执行谓词。
    // 静默跳过它们是危险的——会让「有约束」的假象掩盖「没校验」的事实，
    // 所以显式报告为 unenforceable 警告，让调用方知道这条没人守。
    if (!check) {
      out.push({ id: c.id ?? c.rule, severity: 'warning', code: 'unenforceable', msg: `约束「${c.rule ?? c.id}」无机器判定，未校验` })
      continue
    }
    const pred = PREDICATES[check.type]
    if (!pred) {
      out.push({ id: c.id ?? c.rule, severity: 'warning', code: 'unknown-predicate', msg: `未知谓词 ${check.type}` })
      continue
    }
    const msg = pred(stateAfter, check, stateBefore)
    if (msg) out.push({ id: c.id ?? c.rule, severity: c.severity ?? 'error', code: 'constraint', msg: `${c.rule ? c.rule + '｜' : ''}${msg}` })
  }
  return out
}

export const predicateNames = () => Object.keys(PREDICATES)
