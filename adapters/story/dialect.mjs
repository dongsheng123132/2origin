// Story 方言 —— 长篇小说的领域规则。
//
// 与 Memory / CAD / xlsx 方言同构：核心（compiler/）只提供领域无关的
// 事务校验与证据链，本文件提供小说域「什么状态合法、什么动作越界」。
//
// 世界的骨：角色（char:*）、地点（loc:*）、物品（obj:*）、势力（faction:*）。
// 世界的魂：知识（knows 数组）、保管链（holder）、伏笔（hook:* 状态机）。
// 写长篇会犯的错，一半以上是这三样漂移：角色用了他不该知道的信息、
// 物品到了不该在的人手上、伏笔埋了没收或者提前收了。
//
// 这里的每条约束都要能机器判定——「AI 以事务提交写作」的前提是
// 提交有确定性门禁，而不是又交给另一个模型去感觉。

/** 伏笔状态机。planted_unresolved 是埋下未收，resolved 是已回收。
 *  任何状态都可以 → resolved，但必须声明回收依据（见 STORY_ASSERTIONS）。 */
export const HOOK_STATUSES = ['planted_unresolved', 'resolved', 'abandoned']

/** 对象类型白名单——ID 前缀决定类型，防止「创建时手滑造出幽灵对象」。 */
export const STORY_TYPES = ['char', 'loc', 'obj', 'faction', 'hook', 'k']

/**
 * 叙事域断言表。模型在事务里自己立的字据（assertions），由校验器逐条复核。
 * 这些是「写作时最容易嘴上答应、手上犯规」的边界，让模型显式承诺、
 * 让机器显式验收。名字与 ShadowBench-W 的禁区 ID 对齐，方便跨基准比对。
 */
export const STORY_ASSERTIONS = {
  /** 关键角色存活。写死主角的冲动是长篇写作第一杀手。 */
  'zhao-qi-alive': (s) => s['char:zhao-qi']?.alive === true,
  'lin-zheng-alive': (s) => s['char:lin-zheng']?.alive === true,
  'bai-yao-alive': (s) => s['char:bai-yao']?.alive === true,
  /** 空间门不得开启、黑钥匙不得使用（一次性道具，用了故事就没了）。 */
  'gate-not-opened': (s) => s['obj:black-key']?.used === false,
  'key-intact': (s) => s['obj:black-key']?.intact === true,
  /** 主角不得获知白遥叛变——知识不对称是长篇最大的戏剧引擎，也最容易写穿帮。 */
  'betrayal-undisclosed': (s) => !(s['char:lin-zheng']?.knows ?? []).includes('k:bai-yao-betrayal'),
  /** 身体状态连续性：白遥左手第 9 章起受伤，此后不得用左手持刀或负重。 */
  'left-hand-still-injured': (s) => s['char:bai-yao']?.left_hand_injured === true,
}

/** 未知断言（模型自己编的、无法复核的承诺）降级为警告而不是拒绝——
 *  基准三十三轮实验证明：模型自造断言多半是措辞差异，不是恶意。 */
export const UNKNOWN_ASSERTION = 'warning'

/**
 * 把 ShadowBench-W 的禁区（forbidden_zones）翻译成核心约束。
 * 禁区是叙事概念（「林峥不得获知白遥叛变」），约束是协议概念
 * （equals / not_contains / in），翻译表在这里，与 a3 臂同源。
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
    // hook_must_stay：本方言把伏笔作为对象直接放进包（与 a3 臂的独立投影不同），
    // 所以可以走核心的 equals——这是比基准更简洁的一体化处理。
    else if (mc.type === 'hook_must_stay')
      out.push({ id: fz.id, rule: fz.rule, check: { type: 'equals', object: mc.hook, field: 'status', value: mc.status } })
  }
  return out
}

/** 把禁区翻译成「模型可以显式承诺」的断言名（与 STORY_ASSERTIONS 对齐）。 */
export function zonesToAssertionNames(zones = []) {
  const names = []
  for (const fz of zones) {
    const mc = fz.machine_check
    if (!mc) continue
    if (mc.type === 'field_must_stay') {
      const key = `${mc.object.slice('char:'.length)}-${mc.field}`
      if (key === 'zhao-qi-alive') names.push('zhao-qi-alive')
      else if (key === 'lin-zheng-alive') names.push('lin-zheng-alive')
      else if (key === 'bai-yao-left_hand_injured') names.push('left-hand-still-injured')
      else if (key === 'black-key-used') names.push('gate-not-opened')
      else if (key === 'black-key-intact') names.push('key-intact')
    } else if (mc.type === 'knows_must_not_gain') {
      names.push('betrayal-undisclosed')
    }
  }
  return [...new Set(names)]
}

/**
 * 伏笔专用校验：hook:* 的状态机与回收依据。
 * 核心的 equals/not_contains 不认识「伏笔」这个概念，这里补齐：
 * ① 状态只能取 HOOK_STATUSES
 * ② 状态 → resolved 必须有 payoff 依据（basis 或 hook.payoff 声明），
 *    防止「伏笔说收就收」——那是长篇烂尾的病灶
 */
export function hookViolations(stateAfter, tx) {
  const out = []
  const changes = tx?.state_changes ?? []
  for (const c of changes) {
    if (!c.object?.startsWith('hook:')) continue
    const st = stateAfter[c.object]?.status
    if (st !== undefined && !HOOK_STATUSES.includes(st)) {
      out.push({ code: 'hook-status', msg: `${c.object} 状态 ${JSON.stringify(st)} 不在合法取值 ${JSON.stringify(HOOK_STATUSES)} 内` })
    }
    if (c.field === 'status' && c.to === 'resolved') {
      const hasBasis = Array.isArray(c.basis) && c.basis.length
      const declaresPayoff = (tx.hooks ?? []).some((h) => h.id === c.object && h.payoff)
      if (!hasBasis && !declaresPayoff) {
        out.push({ code: 'hook-payoff', msg: `${c.object} 状态改为 resolved 但未声明回收依据（state_changes[].basis 或 hooks[].payoff）——伏笔回收必须留证据` })
      }
    }
  }
  return out
}
