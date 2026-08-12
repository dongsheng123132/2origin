// A3 臂的**叙事投影器**——输入侧。
// 不是把前文全塞进去，而是按当前任务从世界状态里挑出「此刻需要看见的」，并控制预算。
//
// ── 2026-08 改：从 fork 改为核心的方言着色器 ────────────────────────
//
// 这个文件曾经是独立实现，当时拒绝合并的理由记在这里，原样保留以便对照：
//
//   「核心的投影是领域无关的……这里的投影恰恰全建立在叙事概念上：主角 + 与主角同地者
//     + 关键物品持有者，分成人物 / 物品 / 地点 / 世界规则 / 伏笔五段呈现。
//     要合并，就得给核心加一个 render/sections 钩子，让本文件把选取和渲染整个覆盖掉——
//     **共享的只剩预算算术那三行**，而核心那侧真正的使用者只有 Memory 方言一个。
//     那不是复用，是为了消灭重复而造的抽象。」
//
// 这个判断在当时完全正确。现在前提变了：核心的预算侧不再是三行算术，而是相机 depth
// 分级、三档 LOD 阶梯、超预算由远及近降档、有余量由近及远升档、装不下时显式记账、
// 加上全文长度收敛回环——六十行，且每一行都是领域无关的。本臂一行都没有：它至今是
// 「选中就全渲染，超了截正文尾巴」，在 project.origin 上实测预算利用率只有 13%。
//
// 所以合并的理由从**消除重复**换成了**方言拿不到预算纪律**，分界也随之清楚：
//
//   **投影归方言（本文件的 SHADER），预算归核心（compileContext）。**
//
// 「各写各的」仍然成立——各写各的是 render，不是各自再发明一遍怎么花预算。
//
// ── 输出兼容性（重要）────────────────────────────────────────────
//
// results-log.md 里 W1/W2/W3 的数字是**旧投影器**跑出来的。投影变了，那些数字就
// 不再是「这套输入下的成绩」。所以缺省路径（lod: false）与旧实现**逐字节相同**，
// 由 projection-equivalence.mjs 逐章比对守住。要用 LOD 必须显式开 `lod: true`，
// 那是新的一臂、要重新跑分，不能拿旧数字充数。

import { compileContext as coreCompile } from '../../../../compiler/context-compiler.mjs'

const has = (s, sub) => s.includes(sub)

/** 挑出与本次任务相关的人物：主角 + 目标涉及者 + 禁区涉及者 + 与主角同地者 */
function relevantCharacters(spec, state, task) {
  const ids = new Set()
  const text = task.goal + JSON.stringify(task.forbidden_zones ?? [])
  for (const c of spec.characters) {
    if (has(text, c.name) || has(text, c.id)) ids.add(c.id)
  }
  const pov = spec.characters.find((c) => c.role === 'protagonist')
  if (pov) ids.add(pov.id)
  const povLoc = state[pov?.id]?.location
  for (const c of spec.characters) if (povLoc && state[c.id]?.location === povLoc) ids.add(c.id)
  // 持有任务关键物品者
  for (const o of spec.objects) if (has(text, o.name)) { const h = state[o.id]?.holder; if (h) ids.add(h) }
  return [...ids]
}

/**
 * 叙事着色器。喂给核心 compileContext 的 project 参数。
 *
 * 领域知识全部落在这里，核心一个叙事概念都不认识：
 *   cast    谁进画面——主角、同地者、持有者（上面那个函数）
 *   render  人物给 location/伤/生死/knows，物品给 holder/used——**字段选择就是着色**
 *   group   人物 / 关键物品 两段抬头
 *   fixed   任务行 + 地点 ID 表 + 世界规则 + 未回收伏笔 + 禁区
 *
 * 为什么地点表和伏笔进 fixed 而不是当对象参与降级：它们是**模型必须原样照抄的词表**
 * 和**少一条就判错的边界**。地点 ID 被降档 = 模型开始编地名；伏笔被降档 = 提前回收。
 * 这类东西不该跟「某个配角此刻在哪」抢预算。
 */
export function narrativeShader({ spec, chapter }) {
  const nameOf = Object.fromEntries(spec.characters.map((c) => [c.id, c.name]))
  const objName = Object.fromEntries(spec.objects.map((o) => [o.id, o.name]))
  const isChar = new Set(spec.characters.map((c) => c.id))

  return {
    cast({ task, state }) {
      const chars = relevantCharacters(spec, state, task)
      // 物品：只列此刻有归属的（旧实现同款过滤）
      const items = spec.objects
        .filter((o) => { const s = state[o.id] ?? {}; return s.holder || s.location })
        .map((o) => o.id)
      return {
        focused: [...chars.map((id) => ({ id, depth: 0 })), ...items.map((id) => ({ id, depth: 0 }))],
        background: [],
      }
    },

    render(id, level, { state }) {
      const s = state[id] ?? {}
      if (isChar.has(id)) {
        if (level === 'id') return `  ${id}（${nameOf[id] ?? id}）`
        const bits = []
        if (s.location) bits.push(`location=${s.location}`)
        if (s.left_hand_injured) bits.push('left_hand_injured=true')
        if (s.alive === false) bits.push('alive=false')
        // key 档舍弃 knows：它是最长的字段，且泄漏面最小——人物在哪、死没死才是硬状态
        if (level !== 'key' && s.knows?.length) bits.push(`knows=[${s.knows.join(', ')}]`)
        return `  ${id}（${nameOf[id] ?? id}）${bits.join('；')}`
      }
      if (level === 'id') return `  ${id}（${objName[id] ?? id}）`
      return `  ${id}（${objName[id] ?? id}）holder=${s.holder ?? 'null'}${s.used !== undefined ? `；used=${s.used}` : ''}`
    },

    group(id) {
      return isChar.has(id)
        ? '\n【相关人物·当前状态】（字段值请原样照抄，含前缀）'
        : '\n【关键物品】'
    },

    fixed({ task }) {
      const head = [`【任务】写第 ${chapter} 章，约 3000 字。总目标：${task.goal}`]
      const tail = ['\n【可用地点 ID】']
      tail.push('  ' + (spec.locations ?? []).map((l) => `${l.id}（${l.name}）`).join('　'))
      tail.push('\n【世界规则·不可违反】')
      for (const r of spec.rules) tail.push(`  - ${r.statement}`)
      tail.push('\n【未回收伏笔】')
      for (const h of spec.hooks.filter((h) => h.status === 'planted_unresolved'))
        tail.push(`  - ${h.id}：${h.summary}（第 ${h.setup.chapter} 章埋下）`)
      tail.push('\n【禁区·越界即判失败】')
      for (const fz of task.forbidden_zones ?? []) tail.push(`  - ${fz.rule}`)
      return { head, tail, banner: null, recentBanner: '\n【最近正文（节选）】' }
    },
  }
}

/**
 * @param lod  false（缺省）= 全部对象钉在 full 档，行为与旧实现逐字节一致。
 *             true = 放开核心的预算斜坡：不足升档补满、超出由远及近降档。
 *             **开了就是新的一臂，results-log 里的旧数字不再可比。**
 */
export function compileContext({ spec, state, task, chapter, budget = 6000, recentText = '', lod = false }) {
  const origin = {
    objects: [...spec.characters, ...spec.objects],
    relations: [], constraints: [], history: [],
    ids: new Set([...spec.characters, ...spec.objects].map((o) => o.id)),
    state,
  }
  const ctx = coreCompile({
    origin, state, task, budget, recentText,
    background: 0,
    // 关斜坡而**不是**把预算调到无穷大。差别是致命的：预算无穷大会连带关掉
    // recentText 的截断，而这里的 recentText 是整个语料文件（ch01-50.txt 有 292756
    // 字符），旧实现只取尾部 `budget - 正文长度` ≈ 4700 字符。用无穷大预算会把
    // 29 万字整个灌进提示词——提示词膨胀 60 倍，成本和实验语义全变。
    // （这个 bug 我确实写出来过；等价测试当时用 4000 字符的尾巴，短到根本触发不了截断。）
    slope: lod,
    project: narrativeShader({ spec, chapter }),
  })

  const hooks = spec.hooks.filter((h) => h.status === 'planted_unresolved').length
  return {
    ...ctx,
    text: ctx.text,
    selected: { characters: relevantCharacters(spec, state, task).length, rules: spec.rules.length, hooks },
    estChars: ctx.text.length,
  }
}

export function buildPrompt(ctx) {
  return `${ctx.text}

【输出格式】只输出一个 JSON 对象，不要有其他文字：
{
  "text": "本章正文（约3000字）",
  "state_changes": [ { "object": "对象ID", "field": "字段", "from": 变更前值, "to": 变更后值 } ],
  "assertions": ["zhao-qi-alive", "gate-not-opened", "betrayal-undisclosed"]
}
state_changes 只写本章真实发生的状态变化。
object 与取值必须原样使用上文给出的完整 ID（如 char:lin-zheng、loc:dukou-teahouse），不可省略前缀。
from 必须与上文所给的当前状态一致；不确定就不要写这条变更。
assertions 是你声明本章未违反的边界，将由校验器逐条复核——写了做不到会被判失败。`
}
