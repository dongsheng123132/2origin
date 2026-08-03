// 来源查询层——把 provenance 从「记了」变成「查得出」。
//
// 协议承诺的是「每个状态都有来源」（docs/03 设计原则五）。但承诺要兑现，
// 得能回答一句人话：**这个值凭什么是这个值？**
// 在此之前 applyTransaction 只留下一张「字段 → 最后一次改动」的覆写表：
// 改第二次，第一次就没了；没有时间线，没有查询入口，证据链只是个说法。
//
// 这里把它补成 append-only 事件日志 + 三个只读面：
//
//   why()       这个值凭什么是这个值——一条字段的完整改动链，含每次的依据
//   historyOf() 变更时间线，可按对象/字段/事务/责任者过滤
//   diagnose()  包体检：约束守不守得住、引用悬不悬空、有没有双份账本
//
// 日志落在 provenance/history.jsonl（该路径 docs/03 早已写进包布局，此前无人写入）。
// 与包里原有的 imported / projection_registered 事件共存——用 event 字段区分。

import { fold } from './commit-compiler.mjs'
import { checkConstraints } from './constraints.mjs'

export const STATE_CHANGE = 'state_change'

/** 从混合事件日志里挑出状态变更记录，按 seq 升序。 */
export function stateChanges(history = []) {
  return history.filter((e) => e?.event === STATE_CHANGE).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
}

/** 日志中已用的最大 seq。新记录从 nextSeq 开始。 */
export const nextSeq = (history = []) => Math.max(0, ...history.map((e) => e?.seq ?? 0)) + 1

/**
 * 重放：把包的初始状态（objects.jsonl 折出来的）加上日志里的变更，得到某一时刻的状态。
 *
 * `until` 可以是 seq 数字或事务 ID，缺省重放到头。这不只是为了看历史——
 * 「撤回某条事实后世界会变成什么样」将来要靠同一条重放路径实现（MemTX 式信念级联）。
 */
export function replay(baseState, history = [], { until = null } = {}) {
  const all = stateChanges(history)
  let upto = all
  if (until !== null) {
    const cut = typeof until === 'number' ? all.filter((r) => r.seq <= until) : null
    if (cut) upto = cut
    else {
      const i = all.findIndex((r) => r.tx === until)
      upto = i < 0 ? all : all.slice(0, i + 1)
    }
  }
  return fold(baseState, upto.map((r) => ({ object: r.object, field: r.field, op: r.op, to: r.to })))
}

/** 'obj:black-key.holder' → { object, field }。对象 ID 自带冒号，故按最后一个点切。 */
export function parseRef(ref) {
  const i = String(ref ?? '').lastIndexOf('.')
  if (i <= 0) return null
  return { object: ref.slice(0, i), field: ref.slice(i + 1) }
}

/**
 * 这个值凭什么是这个值。
 *
 * @returns {
 *   ref, object, field,
 *   value,     当前值（初始状态重放日志后的结果）
 *   initial,   包里带来的初始值（未经任何事务）
 *   chain,     该字段的全部改动，**最新在前**
 *   explained, 当前值是否由日志解释（false = 值直接来自包，没有事务记录）
 *   drift      其中模型前值声明与实际不符的次数（stale-write）
 * }
 */
export function why({ state, history = [], ref, object, field }) {
  const target = object && field ? { object, field } : parseRef(ref)
  if (!target) return null

  const chain = stateChanges(history)
    .filter((r) => r.object === target.object && r.field === target.field)
    .reverse()

  const initial = state?.[target.object]?.[target.field]
  const value = replay(state, history)?.[target.object]?.[target.field]

  return {
    ref: `${target.object}.${target.field}`,
    object: target.object,
    field: target.field,
    value,
    initial,
    chain,
    explained: chain.length > 0,
    drift: chain.filter((r) => 'claimed_from' in r).length,
  }
}

/** 变更时间线。过滤条件全为可选，缺省返回全部（最新在前）。 */
export function historyOf(history = [], { object, field, tx, by, limit = 0 } = {}) {
  let rows = stateChanges(history).reverse()
  if (object) rows = rows.filter((r) => r.object === object)
  if (field) rows = rows.filter((r) => r.field === field)
  if (tx) rows = rows.filter((r) => r.tx === tx)
  if (by) rows = rows.filter((r) => r.by === by)
  return limit > 0 ? rows.slice(0, limit) : rows
}

/**
 * 双份账本探测——docs/03 设计原则六「派生优先于存储」的机器版。
 *
 * 实测出过的形状：保管关系同时记在角色的 carries 和物品的 holder 两处，
 * 物品一转手两边立刻失配。通用识别方式与领域无关：
 * **若 A 的某字段指向 B，同时 B 的某字段又指回 A，这对互指字段就是同一事实的两份存储。**
 * 只报警不拦截——有些互指是刻意的（双向关系表），由人判断。
 */
export function findMirrorPairs(state = {}) {
  const pairs = []
  const points = (v, id) => (Array.isArray(v) ? v.includes(id) : v === id)

  for (const [a, fieldsA] of Object.entries(state)) {
    for (const [fa, va] of Object.entries(fieldsA ?? {})) {
      if (fa === '_type') continue
      const targets = Array.isArray(va) ? va : [va]
      for (const b of targets) {
        if (typeof b !== 'string' || b === a || !state[b]) continue
        for (const [fb, vb] of Object.entries(state[b] ?? {})) {
          if (fb === '_type' || !points(vb, a)) continue
          if (pairs.some((p) => p.a === b && p.b === a && p.a_field === fb && p.b_field === fa)) continue
          pairs.push({ a, a_field: fa, b, b_field: fb })
        }
      }
    }
  }
  return pairs
}

/**
 * 包体检。回答的是「这个本象包现在健不健康」，不是「这次提交对不对」。
 *
 * 每条 finding 形如 { code, severity, msg }，severity ∈ error | warning | info。
 * 调用方（CLI）按有无 error 决定退出码。
 */
export function diagnose(origin) {
  const findings = []
  const initial = origin.initial ?? origin.state ?? {}
  const state = replay(initial, origin.history ?? [])
  const ids = origin.ids ?? new Set(Object.keys(state))

  // ① 当前状态是否守得住自己的约束——包可能一出生就是违规的
  for (const v of checkConstraints(state, origin.constraints ?? [], initial))
    findings.push({ code: v.code, severity: v.severity ?? 'error', msg: v.msg })

  // ② 悬空引用：关系指向不存在的对象。
  //    判 warning 不判 error——本象是联合式元格式（docs/03 原则一），跨包引用是合法的，
  //    只是包内无法自证。真正的错误要等到跨包解析层能判定「那边也没有」时才成立。
  for (const r of origin.relations ?? []) {
    for (const end of ['subject', 'object']) {
      const id = r[end]
      if (id && !ids.has(id))
        findings.push({ code: 'dangling-relation', severity: 'warning', msg: `关系 ${r.subject} ${r.predicate} ${r.object} 的 ${end} 「${id}」不在本包对象表中（跨包引用？）` })
    }
  }

  // ③ 日志引用了不存在的对象——包被裁剪过或事务写错了对象
  for (const r of stateChanges(origin.history ?? []))
    if (!ids.has(r.object))
      findings.push({ code: 'dangling-history', severity: 'warning', msg: `history seq=${r.seq} 改动了不存在的对象 ${r.object}` })

  // ④ 双份账本
  for (const p of findMirrorPairs(state))
    findings.push({ code: 'mirror-pair', severity: 'warning', msg: `${p.a}.${p.a_field} 与 ${p.b}.${p.b_field} 互指，同一事实存了两份（派生优先于存储）` })

  // ⑤ 模型记忆偏差率——stale-write 此前只在校验时报个警告就丢了，现在它是可累计的观测量
  const changes = stateChanges(origin.history ?? [])
  const drift = changes.filter((r) => 'claimed_from' in r).length
  if (changes.length)
    findings.push({
      code: 'drift-rate', severity: drift ? 'warning' : 'info',
      msg: `模型前值声明偏差 ${drift}/${changes.length}（${((drift / changes.length) * 100).toFixed(1)}%）`,
    })

  const enforceable = (origin.constraints ?? []).filter((c) => c.check).length
  const total = (origin.constraints ?? []).length
  if (total && enforceable < total)
    findings.push({ code: 'unenforceable-ratio', severity: 'warning', msg: `${total} 条约束中只有 ${enforceable} 条可机器判定，其余 ${total - enforceable} 条无人守` })

  return {
    ok: !findings.some((f) => f.severity === 'error'),
    objects: ids.size,
    relations: (origin.relations ?? []).length,
    constraints: { total, enforceable },
    changes: changes.length,
    findings,
  }
}
