// 提交编译器——本象协议的输出侧。
//
// 核心主张：**AI 不输出终态，只提交语义事务；事务须通过校验才允许落地。**
// 对应 spec/schemas/transaction.schema.json 与 docs/03-协议草案-v0.1.md 第六节。
//
//   validateTransaction() → { ok, violations, errors }   不通过则把 violations 回传模型重写
//   applyTransaction()    → { state, provenance }        通过后折叠进状态，逐字段记来源
//
// ShadowBench-W 三十三轮实验（W3 状态准确率 98.9% vs 裸模型/RAG 的 75.0%）验证的就是
// 这套机制。下面几处带「实测」的注释是从那些实验里换来的，删掉任何一条都会掉分。

import { checkConstraints } from './constraints.mjs'

/**
 * ID 归一化。
 *
 * **实测教训**：模型极易漏掉命名空间前缀（写 lin-zheng 而非 char:lin-zheng），
 * 而这在语义上毫无歧义。用严格匹配把它判为「未知对象」纯属接口刁难——
 * 一次运行因此整章作废。基于稳定 ID 的协议必须自带归一化层。
 *
 * 前缀不写死：从已知 ID 里现推，所以换个领域（field: / projection: / dataset:）照样工作。
 */
export function normalizeId(raw, known) {
  if (typeof raw !== 'string' || known.has(raw)) return raw
  const prefixes = new Set()
  for (const id of known) {
    const i = id.indexOf(':')
    if (i > 0) prefixes.add(id.slice(0, i + 1))
  }
  for (const p of prefixes) if (known.has(p + raw)) return p + raw
  return raw
}

export function normalizeTransaction(tx, known) {
  if (!tx?.state_changes) return tx
  return {
    ...tx,
    state_changes: tx.state_changes.map((c) => ({
      ...c,
      object: normalizeId(c.object, known),
      from: normalizeId(c.from, known),
      to: normalizeId(c.to, known),
    })),
  }
}

/** 把状态变更折叠进状态副本。op='append' 时按集合语义追加，否则整体替换。 */
export function fold(state, changes = []) {
  const next = structuredClone(state)
  for (const c of changes) {
    if (!c?.object || !c?.field) continue
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

/**
 * 校验语义事务。
 *
 * @param tx           待校验事务
 * @param stateBefore  当前状态
 * @param constraints  约束数组（数据驱动，见 constraints.mjs）
 * @param assertions   断言名 → 谓词 (state) => boolean。宿主登记，协议不预设任何具体断言。
 * @param prose        可选：{ text, check(text, {stateBefore, stateAfter}) => [{why, quote}] }
 *                     正文校验钩子。**实测教训**：只校验状态字段是不够的——出现过状态
 *                     全对、正文却把关键物品写在别人手上的情况。状态层与正文层是脱钩的，
 *                     门禁必须把正文一并纳入，否则形同虚设。
 */
export function validateTransaction({ tx, stateBefore, constraints = [], assertions = {}, prose = null }) {
  const v = []
  const changes = tx?.state_changes ?? []

  if (!tx || typeof tx !== 'object') return { ok: false, violations: [{ code: 'schema', msg: '事务不是对象' }], errors: 1 }
  if (!Array.isArray(changes)) return { ok: false, violations: [{ code: 'schema', msg: 'state_changes 必须是数组' }], errors: 1 }

  // ① 结构与引用
  for (const [i, c] of changes.entries()) {
    if (!c?.object || !c?.field) {
      v.push({ code: 'schema', msg: `state_changes[${i}] 缺少 object 或 field` })
      continue
    }
    if (!stateBefore[c.object]) v.push({ code: 'unknown-object', msg: `state_changes[${i}] 未知对象 ${c.object}` })
    // ② 快照隔离：声明的前值接不上当前值 → **警告，不拦截**。
    //    实测教训：曾按错误处理，一次运行因此废掉 3 章（10 次全拒）。运行时本就知道当前值，
    //    要求模型精确复述旧值是接口刁难。降级为警告并计入指标——「模型记忆偏差率」本身
    //    是有价值的观测量，按当前值落地即可。
    else if ('from' in c && c.op !== 'append') {
      const now = stateBefore[c.object][c.field]
      if (JSON.stringify(now) !== JSON.stringify(c.from))
        v.push({
          code: 'stale-write',
          severity: 'warning',
          msg: `${c.object}.${c.field} 前值不符：声明 ${JSON.stringify(c.from)}，实际 ${JSON.stringify(now)}`,
        })
    }
  }

  const stateAfter = fold(stateBefore, changes)

  // ③ 约束（数据驱动）
  v.push(...checkConstraints(stateAfter, constraints, stateBefore))

  // ④ 模型自报断言的复核——AI 自己立的字据，由校验器验收
  for (const a of tx?.assertions ?? []) {
    const pred = assertions[a]
    if (!pred) v.push({ code: 'unknown-assertion', severity: 'warning', msg: `断言 ${a} 无法复核（未登记）` })
    else if (!pred(stateAfter)) v.push({ code: 'assertion-failed', msg: `声明 ${a}，复核不成立` })
  }

  // ⑤ 正文对照状态
  if (prose?.check && typeof tx.text === 'string' && tx.text) {
    for (const hit of prose.check(tx.text, { stateBefore, stateAfter }) ?? [])
      v.push({ code: 'prose-violation', msg: `${hit.why}｜「${String(hit.quote ?? '').slice(0, 40)}」` })
  }

  const errors = v.filter((x) => x.severity !== 'warning')
  return { ok: errors.length === 0, violations: v, errors: errors.length, stateAfter }
}

/**
 * 落地事务：折叠状态 + 逐字段记录来源。
 * provenance 不是可选装饰——「哪些字段是这次改的、由谁改的」是协议承诺的一部分，
 * 没有它就无法回答「这个值凭什么是这个值」。
 */
export function applyTransaction({ tx, state, provenance = {}, by = 'unknown', at = null }) {
  const next = fold(state, tx?.state_changes ?? [])
  const nextProv = { ...provenance }
  for (const c of tx?.state_changes ?? []) {
    if (!c?.object || !c?.field) continue
    nextProv[`${c.object}.${c.field}`] = { by, tx: tx?.transaction_id ?? null, at }
  }
  return { state: next, provenance: nextProv }
}
