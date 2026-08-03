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

  // 取值必须落在给定集合内——状态机的合法取值。
  // 三个域同时要它：图纸版次 ∈ {A,B,C}、工序 ∈ {未开工,进行中,已完工}、待办 ∈ {open,doing,done}。
  // 没有它就只能拿 not_equals 一条条排除，写不全也读不懂。
  in: (state, c) => {
    const got = get(state, c.object, c.field)
    if (got === undefined) return null // 缺失由 exists 负责，各司其职
    const set = c.values ?? []
    return set.some((v) => JSON.stringify(v) === JSON.stringify(got))
      ? null
      : `${c.object}.${c.field} = ${JSON.stringify(got)}，不在允许取值 ${JSON.stringify(set)} 内`
  },

  // 字段必须存在且非空。其余谓词一律「字段不存在就不判」，避免把「没写」误判成「写错」；
  // 真要求必填时用这条显式声明——两种意图分开，才不会互相掩盖。
  exists: (state, c) => {
    const got = get(state, c.object, c.field)
    const empty = got === undefined || got === null || got === '' || (Array.isArray(got) && got.length === 0)
    return empty ? `${c.object}.${c.field} 必填，当前为空` : null
  },

  // ── 以下两条是**聚合谓词**：判的不是某一个对象，而是一组对象之间的关系。 ──
  // 前面的谓词都能靠通配展开成「逐个对象各判一次」，这两条不行——
  // 「编号不得重复」「数量必须对上」本质上要同时看见整组，展开就没意义了。
  // 所以它们不参与 expand，自己按 check.object 的通配去匹配（见 AGGREGATE）。

  // 同类对象的某字段不得重复：图纸编号、构件编号、工序号……
  unique: (state, c) => {
    const seen = new Map()
    const dups = []
    for (const id of matchIds(state, c.object)) {
      const val = get(state, id, c.field)
      if (val === undefined || val === null || val === '') continue
      const key = JSON.stringify(val)
      if (seen.has(key)) dups.push(`${val}（${seen.get(key)} 与 ${id}）`)
      else seen.set(key, id)
    }
    return dups.length ? `${c.object}.${c.field} 出现重复：${dups.join('；')}` : null
  },

  // 一组对象的数量必须等于某个定值，或等于另一组对象的数量。
  // **这正是「门窗表 5 樘、平面图只画了 4 樘」那类事故的通用形状**：
  // 同一件事在图上有两处表述，两处必须对得上。跨领域同构——
  // 待办数 = 计划条目数、章节数 = 目录条目数，都是它。
  count: (state, c) => {
    const n = matchIds(state, c.object).length
    if (typeof c.equals === 'number')
      return n === c.equals ? null : `${c.object} 实有 ${n} 个，应为 ${c.equals} 个`
    if (typeof c.equals_count_of === 'string') {
      const m = matchIds(state, c.equals_count_of).length
      return n === m ? null : `${c.object} 有 ${n} 个，${c.equals_count_of} 有 ${m} 个，两处对不上`
    }
    if (typeof c.equals_ref === 'string') {
      const i = c.equals_ref.lastIndexOf('.')
      const want = get(state, c.equals_ref.slice(0, i), c.equals_ref.slice(i + 1))
      return n === want ? null : `${c.object} 实有 ${n} 个，${c.equals_ref} 声称 ${want} 个`
    }
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

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 按 `前缀:*` 之类的通配挑出匹配的对象 ID。通配之外的字符按字面匹配。 */
export function matchIds(state = {}, pattern) {
  if (typeof pattern !== 'string') return []
  if (!pattern.includes('*')) return state[pattern] ? [pattern] : []
  const re = new RegExp('^' + pattern.split('*').map(escapeRe).join('.*') + '$')
  return Object.keys(state).filter((id) => re.test(id))
}

/** 聚合谓词：判的是一组对象之间的关系，不能被通配展开成逐个校验。 */
const AGGREGATE = new Set(['unique', 'count'])

/**
 * 通配展开：`check.object` 含 `*` 时，对状态里每个匹配的对象各校验一次。
 *
 * 没有它，「**所有**构件净高不得低于 2.6m」只能给每根梁各写一条约束——
 * 图纸有几千个构件就得写几千条，而且新增构件时约束不会自动覆盖它，
 * 这正是「加了状态管理反而更差」的典型来源。三个域同时需要这个能力：
 *   decision:*.status ∈ {…}　part:*.level ≥ 2.6　task:*.owner 必填
 * 匹配不到任何对象时不报违规——约束是对未来的承诺，不是对当下的断言。
 */
function expand(check, state) {
  if (typeof check?.object !== 'string' || !check.object.includes('*')) return [check]
  return matchIds(state, check.object).map((id) => ({ ...check, object: id }))
}

/**
 * 校验一批约束。
 * @param stateAfter  事务折叠后的状态
 * @param constraints 约束数组，每条形如 { id?, rule?, severity?, check: {type, ...} }
 *                    check.object 支持 `*` 通配，如 `decision:*`
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
    // 聚合谓词自己处理通配，其余的展开成逐对象校验
    for (const one of AGGREGATE.has(check.type) ? [check] : expand(check, stateAfter)) {
      const msg = pred(stateAfter, one, stateBefore)
      if (msg) out.push({ id: c.id ?? c.rule, severity: c.severity ?? 'error', code: 'constraint', msg: `${c.rule ? c.rule + '｜' : ''}${msg}` })
    }
  }
  return out
}

export const predicateNames = () => Object.keys(PREDICATES)
