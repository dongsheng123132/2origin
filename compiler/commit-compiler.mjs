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
    state_changes: tx.state_changes.map((c) => {
      const out = { ...c, object: normalizeId(c.object, known), to: normalizeId(c.to, known) }
      // **只在原本就有 from 时才写回**。早先无条件写 `from: normalizeId(c.from)`，
      // 于是没声明前值的变更也被塞进一个 `from: undefined` 键，`'from' in c` 恒为真。
      // 之前所有对象都预先存在，那条分支总能取到值，所以这个洞一直没炸；
      // 直到事务开始新建对象——前值检查去读一个还不存在的对象，当场崩。
      if ('from' in c) out.from = normalizeId(c.from, known)
      return out
    }),
  }
}

/**
 * 事务声明要新建的对象 ID。
 * `creates` 可写成 `['decision:mvp']` 或 `[{ id: 'decision:mvp', type: 'decision' }]`，
 * 带 type 的会被记进日志，重放后该对象仍知道自己是什么类型。
 */
export function createdIds(tx) {
  return new Set((tx?.creates ?? []).map((x) => (typeof x === 'string' ? x : x?.id)).filter(Boolean))
}

/** 新建声明转成 `_type` 变更——沿用同一条落地路径，重放即可重建类型，不另开机制。 */
function creationChanges(tx) {
  return (tx?.creates ?? [])
    .filter((x) => typeof x === 'object' && x?.id && x?.type)
    .map((x) => ({ object: x.id, field: '_type', to: x.type }))
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

  const created = createdIds(tx)

  // ① 结构与引用
  for (const [i, c] of changes.entries()) {
    if (!c?.object || !c?.field) {
      v.push({ code: 'schema', msg: `state_changes[${i}] 缺少 object 或 field` })
      continue
    }
    // 未知对象仍是错误——除非事务**显式声明**了要新建它。
    // **实测教训**：这里原本一律拒绝，于是「新建一个决策/待办」根本无法表达，
    // Memory 方言第一次实跑就全军覆没。但直接放开更糟：模型把 ID 打错一个字母，
    // 就会静默造出一个幽灵对象，而幽灵对象永远不会被任何约束管到。
    // 所以创建必须是声明出来的意图，不能是打字失误的副作用——
    // 写错 ID 去改一个不存在的对象，照旧当场拒绝。
    const exists = !!stateBefore[c.object]
    if (!exists && !created.has(c.object))
      v.push({ code: 'unknown-object', msg: `state_changes[${i}] 未知对象 ${c.object}（若要新建，请在事务的 creates 里声明）` })
    // ② 快照隔离：声明的前值接不上当前值 → **警告，不拦截**。
    //    新建的对象没有前值可比，跳过。
    //    实测教训：曾按错误处理，一次运行因此废掉 3 章（10 次全拒）。运行时本就知道当前值，
    //    要求模型精确复述旧值是接口刁难。降级为警告并计入指标——「模型记忆偏差率」本身
    //    是有价值的观测量，按当前值落地即可。
    else if (exists && 'from' in c && c.op !== 'append') {
      const now = stateBefore[c.object][c.field]
      if (JSON.stringify(now) !== JSON.stringify(c.from))
        v.push({
          code: 'stale-write',
          severity: 'warning',
          msg: `${c.object}.${c.field} 前值不符：声明 ${JSON.stringify(c.from)}，实际 ${JSON.stringify(now)}`,
        })
    }
  }

  const stateAfter = fold(stateBefore, [...creationChanges(tx), ...changes])

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
 * 落地事务：折叠状态 + 逐字段记录来源 + 追加事件日志。
 *
 * provenance 不是可选装饰——「哪些字段是这次改的、由谁改的」是协议承诺的一部分，
 * 没有它就无法回答「这个值凭什么是这个值」。
 *
 * **但只有 provenance 也答不了这句话**：那是一张覆写表，同一字段改第二次，
 * 第一次的来源就没了。所以这里同时产出 append-only 的 `journal`——
 * 每次改动一条记录，写进 provenance/history.jsonl，由 provenance.mjs 的
 * why()/historyOf()/replay() 查询。provenance 保留原形状（最后一次改动），
 * 老调用方不受影响。
 *
 * 记录形状（event 字段区分于包里原有的 imported / projection_registered 事件）：
 *
 *   { event: 'state_change', seq, object, field, op?, from, claimed_from?, to,
 *     kind, basis?, tx, by, at }
 *
 *   from          落地那一刻的**真实**前值，不是模型说的
 *   claimed_from  模型声称的前值，仅在与真实前值不符时出现——这就是被降级为警告的
 *                 stale-write，此前报完就丢了。累计起来即「模型记忆偏差率」，
 *                 是可观测、可比较的指标（见 provenance.diagnose）
 *   kind          observed（事务直接写入）/ derived（由别的字段推出）/ asserted（人工断言）
 *   basis         derived 时的依据字段引用，缺省取事务的 depends_on
 *                 —— 撤回级联（MemTX 式信念修复）要靠这条边，先把位置留出来
 *
 * @param history 已有事件日志（用于接续 seq）；不传则从 1 开始
 */
export function applyTransaction({ tx, state, provenance = {}, history = [], by = 'unknown', at = null }) {
  const all = [...creationChanges(tx), ...(tx?.state_changes ?? [])]
  const next = fold(state, all)
  const nextProv = { ...provenance }
  const journal = []
  let seq = Math.max(0, ...history.map((e) => e?.seq ?? 0))

  for (const c of all) {
    if (!c?.object || !c?.field) continue
    const ref = `${c.object}.${c.field}`
    const actualFrom = state?.[c.object]?.[c.field]
    const rec = {
      event: 'state_change',
      seq: ++seq,
      object: c.object,
      field: c.field,
      from: actualFrom,
      to: c.to,
      kind: c.kind ?? tx?.kind ?? 'observed',
      tx: tx?.transaction_id ?? null,
      by,
      at,
    }
    if (c.op) rec.op = c.op
    if (c.op !== 'append' && 'from' in c && JSON.stringify(c.from) !== JSON.stringify(actualFrom)) rec.claimed_from = c.from
    const basis = c.basis ?? tx?.depends_on
    if (Array.isArray(basis) && basis.length) rec.basis = basis

    journal.push(rec)
    nextProv[ref] = { by, tx: rec.tx, at, seq: rec.seq }
  }
  return { state: next, provenance: nextProv, journal }
}
