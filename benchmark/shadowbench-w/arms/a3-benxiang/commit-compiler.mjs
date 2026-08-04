// A3 臂的**叙事方言**——机制全部来自参考实现，这里只放小说域的数据与呈现。
//
// 这个文件曾是 compiler/commit-compiler.mjs 的一份 fork。两边漂了两天：参考实现在
// Memory / CAD 方言上修掉的洞（normalizeTransaction 的 `from: undefined`、fold 对空
// object/field 的守卫、非数组 state_changes 的早退）一个都没惠及基准，而基准恰恰是
// 这个项目对外的证据来源。fork 一份校验器等于让「护栏」和「用护栏跑出来的数字」
// 各自演化——数字还在，护栏已经不是当初那个了。
//
// 现在的分工，和 CAD / Memory 两个方言一致：
//   核心（compiler/）  结构校验、快照隔离、约束求值、断言复核、折叠与证据链
//   方言（本文件）      断言表、禁区→约束的翻译、正文规则、以及基准的输出形状
//
// 禁区的三个 machine_check 类型不需要专门的代码——constraints.mjs 开头那张映射表
// 早就写好了它们对应哪个通用谓词，这里只是把它落实：
//   field_must_stay      → equals
//   knows_must_not_gain  → not_contains
//   hook_must_stay       → equals（作用在伏笔投影上，见 hookViolations）

import { RULES } from '../../eval/ced.mjs'
import {
  validateTransaction as coreValidate,
  applyTransaction as coreApply,
  normalizeId,
  normalizeTransaction,
} from '../../../../compiler/commit-compiler.mjs'
import { checkConstraints } from '../../../../compiler/constraints.mjs'

// 归一化不再自带一份：核心版本的前缀是从已知 ID 里现推的，比这里原先写死的
// ['char:','obj:','loc:','hook:','k:','faction:'] 更不容易漏。
export { normalizeId, normalizeTransaction }

/** 断言名 → 可复核的谓词。模型自己立的字据，由校验器验收。协议不预设任何具体断言，这张表是叙事域的。 */
const ASSERTIONS = {
  'zhao-qi-alive': (s) => s['char:zhao-qi']?.alive === true,
  'gate-not-opened': (s) => s['obj:black-key']?.used === false,
  'betrayal-undisclosed': (s) => !(s['char:lin-zheng']?.knows ?? []).includes('k:bai-yao-betrayal'),
  'key-intact': (s) => s['obj:black-key']?.intact === true,
}

/**
 * 禁区翻译成通用约束。
 * 没有 machine_check 的禁区**直接跳过**，不走核心的 unenforceable 警告——
 * 那条警告是给「以为有人守、其实没人守」的约束准备的；禁区这边人工复核项另有 text_check，
 * 计进 gate.warnings 会污染「模型记忆偏差率」的口径。
 */
export function zonesToConstraints(zones = []) {
  const out = []
  for (const fz of zones) {
    const mc = fz.machine_check
    if (!mc) continue
    if (mc.type === 'field_must_stay')
      out.push({ id: fz.id, rule: fz.rule, check: { type: 'equals', object: mc.object, field: mc.field, value: mc.value } })
    else if (mc.type === 'knows_must_not_gain')
      out.push({ id: fz.id, rule: fz.rule, check: { type: 'not_contains', object: mc.object, field: 'knows', value: mc.value } })
    // hook_must_stay 判的是伏笔状态，不在世界状态里——见 hookViolations
  }
  return out
}

/**
 * 伏笔类禁区。
 *
 * 伏笔状态存在与世界状态并列的 hooks 投影里，没有并进 state——并进去会让
 * `hook:*` 变成「已存在的对象」，模型改写伏笔就不再被 unknown-object 拦下，
 * 那是实打实的护栏松动。所以这里单独对 hooks 求值，用的仍是核心的 equals 谓词。
 */
function hookViolations(zones, hooks) {
  const out = []
  for (const fz of zones) {
    const mc = fz.machine_check
    if (mc?.type !== 'hook_must_stay') continue
    const st = hooks?.[mc.hook]?.status
    if (st === undefined) continue // 状态未知则不判，与旧实现一致
    const cs = [{ id: fz.id, rule: fz.rule, check: { type: 'equals', object: mc.hook, field: 'status', value: mc.status } }]
    if (checkConstraints(hooks ?? {}, cs).length) out.push(zoneViolation(fz, `${mc.hook} 状态变为 ${st}`))
  }
  return out
}

/**
 * 把核心的约束违规还原成禁区违规——**码和文案都要还原**。
 *
 * 码：results-log 里多处按码做分析（「forbidden-zone 这个码在 rep1–10 里一次都没出现过」
 * 是判定 Run #11 装置故障的关键证据）。码一改，历史结果和新结果就没法横向比。
 *
 * 文案：这段字会原样喂回给模型做退回重试，**它是模型输入的一部分**。核心的措辞
 * （「应为 X，实为 Y」）其实比旧版（「变为 X」）信息更全——但正因为更全，换上去就等于
 * 在不知不觉中给 A3 换了一套更好的退回提示，未来的运行便不再能和 rep1–10 直接比。
 * 改进测量对象可以，改进测量仪器不能悄悄做。要换，得单独立一次对照实验。
 * （实测：只换文案，stub 模式下输入 token 从 25358 变成 25450。）
 */
const zoneViolation = (fz, detail) => ({ code: 'forbidden-zone', fz: fz.id, msg: `${fz.rule}｜${detail}` })

/** 核心报出违规的是哪条禁区、当时的后状态是什么——据此重建旧版文案 */
function asZoneViolations(violations, zones, stateAfter) {
  const byId = new Map(zones.map((fz) => [fz.id, fz]))
  return violations.map((x) => {
    const fz = x.code === 'constraint' ? byId.get(x.id) : null
    if (!fz) return x
    const mc = fz.machine_check
    if (mc.type === 'knows_must_not_gain') return zoneViolation(fz, `${mc.object} 获得了 ${mc.value}`)
    return zoneViolation(fz, `${mc.object}.${mc.field} 变为 ${JSON.stringify(stateAfter?.[mc.object]?.[mc.field])}`)
  })
}

/**
 * 违规文案按本方言的口径改写。理由同 zoneViolation：错误文案会原样进退回提示，
 * 属于模型输入，不能随核心实现一起漂。
 *
 * unknown-object 这条还有独立理由：核心的文案会提示「若要新建，请在事务的 creates 里声明」，
 * 而本臂的输出契约里根本没有 creates 字段（见 context-compiler 的 buildPrompt）。
 * 照搬等于教模型去用一个它交不出来的字段。
 */
function toDialectWording(x) {
  if (x.code === 'unknown-object') return { ...x, msg: x.msg.replace('（若要新建，请在事务的 creates 里声明）', '') }
  if (x.code === 'assertion-failed') return { ...x, msg: x.msg.replace(/^声明 /, '模型声明 ') }
  return x
}

/**
 * 校验语义事务（叙事域口径）。
 *
 * 与核心的差别只有两处，都是叙事域特有的：
 *   ① 要求 tx.text 非空——写作任务交不出正文就是没干活；核心不该知道「正文」这个概念
 *   ② errors 返回**数组**而非计数，因为退回重试时要把每条违规原文喂回给模型
 */
export function validateTransaction({ tx, stateBefore, task, hooks = {}, spec = null }) {
  const zones = task?.forbidden_zones ?? []

  const res = coreValidate({
    tx,
    stateBefore,
    constraints: zonesToConstraints(zones),
    assertions: ASSERTIONS,
    // 正文对照状态：只校验状态字段是不够的。实测中出现过状态字段完全正确、
    // 正文却把黑钥匙写在别人手上的情况——状态层与正文层是脱钩的。
    prose: spec && {
      check: (text, { stateBefore: before, stateAfter }) =>
        RULES.flatMap((rule) => rule.check({ text, state: before, stateAfter, spec, chapter: null })),
    },
  })

  const v = asZoneViolations(res.violations, zones, res.stateAfter).map(toDialectWording)
  if (!tx || typeof tx.text !== 'string' || !tx.text.trim()) v.unshift({ code: 'schema', msg: '事务缺少正文 text' })
  v.push(...hookViolations(zones, hooks))

  const errors = v.filter((x) => x.severity !== 'warning')
  return { ok: errors.length === 0, violations: v, errors }
}

/**
 * 落地事务。走核心的 applyTransaction，证据链从它产出的 journal 派生——
 * 基准记的是「哪个字段是哪一章写的」，比核心的 provenance 粗，但口径必须保持不变，
 * 否则 97 份历史结果文件的 evidence 字段就读不了了。
 */
export function applyTransaction({ tx, state, evidence = {}, chapter }) {
  const { state: next, journal } = coreApply({ tx, state, by: 'a3-benxiang', at: null })
  const nextEvidence = { ...evidence }
  for (const rec of journal) nextEvidence[`${rec.object}.${rec.field}`] = `ch${chapter}`
  return { state: next, evidence: nextEvidence }
}
