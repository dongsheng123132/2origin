// 投影层——「一源万影」缺的那一半。
//
// 在此之前这个仓库跑通的其实是**万源一象**：Word/CAD/Excel 导进本象、编译给 AI 看、
// 收 AI 的事务写回状态。但架构图底下那行「PDF / 图片 / 文字 / 三维 / 界面（多影输出）」
// 一行代码都没有，manifest 里的 `projections:` 块是一份**声明**，
// 而 `projection must_disclose_truncation` 是一条**没人守的约束**（unenforceable 警告）。
//
// 没有投影，本象是个「导入并分析」的工具，不是表示层——
// 因为「Excel 只是影子」这句话要成立，前提是影子**真的能从本象生成出来**。
//
// ## 核心只管三件事，格式交给方言
//
//   ① **选取**：哪些对象进这次投影
//   ② **披露**：丢了什么 —— 这是协议级承诺，不是可选项
//   ③ **溯源**：从哪个 seq 的世界生成的
//
// 怎么把选中的东西写成 .xlsx / .dxf / .pdf，核心一概不管——那是方言的事，
// 与 decision:projector-per-domain 同一个道理：协议统一的是契约，不是每种格式的字节。
//
// ## 借 USD 的一条经验：投影是「叠一层」，不是「导出一份」
//
// OpenUSD 之所以能成为跨厂商标准，关键机制是**非破坏性叠加**（LayerStack / override）：
// 场景不是被导出成一份新文件，而是在本源之上叠一层视图规格，本源始终不动。
// 这里照抄这个立场：`plan()` **不修改本象、不写任何文件**，只产出一份「这次要投什么、
// 会丢什么」的计划。真正落盘由方言拿着计划去做，且必须把丢弃清单一并交出来。
//
// ## 为什么「丢了什么」必须是强制的
//
// 投影天然有损：Excel 装不下证据链，PDF 装不下公式依赖，图表装不下被截断的长尾。
// 有损不是问题，**假装无损才是**。一份不声明自己丢了什么的投影，
// 会被下游当成本体使用——这正是本项目开篇要解决的「投影的投影」。
// 所以 dropped 不是返回值里可有可无的一项，是 `plan()` 的主要产物。

import { matchIds } from './constraints.mjs'

/** 对象的身份字段，不算内容——它们不会被「格式装不下」 */
const IDENTITY = new Set(['_type'])

/**
 * 规划一次投影。**只读**：不改本象，不写文件。
 *
 * @param origin  loadOrigin() 的结果
 * @param spec.id       这次投影的标识，如 'budget-xlsx'
 * @param spec.format   目标格式，如 'xlsx'（只记录，不解释）
 * @param spec.select   要投影的对象 ID 通配数组，如 ['cell:*', 'sheet:*']；缺省为全部
 * @param spec.carries  目标格式装得下的字段名数组；缺省为「全都装得下」
 *                      —— 声明它，才能算出「哪些字段被丢了」
 * @param spec.at_seq   从哪个 seq 的世界投影，缺省为当前
 *
 * @returns {
 *   id, format, at_seq,
 *   selected,  被选中的对象 ID
 *   objects,   选中对象的（已按 carries 裁剪的）状态
 *   dropped,   **丢弃清单**：每条 { code, what, count, why }
 *   lossless,  dropped 为空时为 true
 * }
 */
export function planProjection(origin, spec = {}) {
  const { id = 'projection', format = 'unknown', select = ['*'], carries = null, at_seq = null } = spec
  const state = origin.state ?? {}

  const selected = [...new Set(select.flatMap((p) => matchIds(state, p)))].sort()
  const selectedSet = new Set(selected)
  const dropped = []

  // ① 没被选进来的对象
  const unselected = Object.keys(state).filter((k) => !selectedSet.has(k))
  if (unselected.length)
    dropped.push({
      code: 'object-not-selected',
      what: `${unselected.length} 个对象不在选取范围内`,
      count: unselected.length,
      why: `select = ${JSON.stringify(select)}`,
      sample: unselected.slice(0, 5),
    })

  // ② 选中了、但目标格式装不下的字段
  const objects = {}
  const lostFields = new Map()
  for (const oid of selected) {
    const src = state[oid] ?? {}
    const kept = {}
    for (const [k, v] of Object.entries(src)) {
      if (IDENTITY.has(k)) { kept[k] = v; continue }
      if (carries && !carries.includes(k)) {
        lostFields.set(k, (lostFields.get(k) ?? 0) + 1)
        continue
      }
      kept[k] = v
    }
    objects[oid] = kept
  }
  for (const [field, count] of [...lostFields].sort((a, b) => b[1] - a[1]))
    dropped.push({
      code: 'field-not-carried',
      what: `字段 ${field}`,
      count,
      why: `${format} 装不下它（不在 carries 声明中）`,
    })

  // ③ 关系：两端都被选中才留得下
  const rels = origin.relations ?? []
  const lostRels = rels.filter((r) => !selectedSet.has(r.subject) || !selectedSet.has(r.object))
  if (lostRels.length)
    dropped.push({
      code: 'relation-dangling',
      what: `${lostRels.length} 条关系的一端不在投影内`,
      count: lostRels.length,
      why: '关系需要两端都在场才有意义',
      sample: lostRels.slice(0, 3).map((r) => `${r.subject} ${r.predicate} ${r.object}`),
    })

  // ④ 证据链：除非目标格式明确声称装得下，否则投影一律丢掉历史。
  //    这条单独列出来而不是混在 field-not-carried 里——因为它是本象**最核心的资产**，
  //    「这份 Excel 里的数答不出凭什么」必须是一句写在明面上的话。
  const changes = (origin.history ?? []).filter((e) => e?.event === 'state_change').length
  if (changes && !(carries && carries.includes('__provenance')))
    dropped.push({
      code: 'provenance-not-carried',
      what: `${changes} 条变更记录（证据链）`,
      count: changes,
      why: `${format} 装不下证据链——投影出去的值答不出「凭什么」，要追责请回到本象包`,
    })

  return {
    id, format,
    at_seq: at_seq ?? currentSeq(origin),
    selected, objects, dropped,
    lossless: dropped.length === 0,
  }
}

const currentSeq = (origin) =>
  Math.max(0, ...(origin.history ?? []).map((e) => e?.seq ?? 0))

/**
 * 把投影计划渲染成一句人和 AI 都读得懂的披露。
 * 这段文字应当**跟着投影件一起走**（写进 xlsx 的一张表、PDF 的末页、图表的脚注）。
 */
export function disclosure(plan) {
  if (plan.lossless) return `本文件由本象包投影生成（seq ${plan.at_seq}），未丢弃任何信息。`
  const lines = [
    `本文件是本象包在 seq ${plan.at_seq} 时的**投影**，不是本体。以下信息未包含在内：`,
    ...plan.dropped.map((d) => `  · ${d.what}——${d.why}`),
    `要回答「这个值凭什么是这个值」，请回到本象包，而不是这份文件。`,
  ]
  return lines.join('\n')
}

/**
 * 投影事件记录，供调用方追加进 provenance/history.jsonl。
 *
 * 记下来才能回答「这份发出去的报表是从哪个版本的世界生成的」——
 * 没有它，投影件流出去之后就与本象失联了，跟普通导出没有区别。
 */
export const projectionRecord = (plan, { by = 'unknown', at = null, output = null } = {}) => ({
  event: 'projected',
  projection: plan.id,
  format: plan.format,
  at_seq: plan.at_seq,
  objects: plan.selected.length,
  lossless: plan.lossless,
  dropped: plan.dropped.map((d) => ({ code: d.code, count: d.count })),
  ...(output ? { output } : {}),
  by,
  at: at ?? new Date().toISOString(),
})
