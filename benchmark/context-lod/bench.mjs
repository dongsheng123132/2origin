#!/usr/bin/env node
// 上下文编译器 · 预算行为对照实验（确定性，不调模型）
//
//   node benchmark/context-lod/bench.mjs
//
// 为什么这一轮不调模型：被测的命题是**投影本身的性质**，不是模型的表现——
//   「同一预算下，模型能看见世界的多少、规则还在不在」
// 这是编译器的纯函数属性，调模型只会把它埋进采样噪声里，还要花钱。
// 模型侧的下游效应（违反数、事务通过率）留给 ShadowBench-W，那是另一场实验。
//
// 三个臂：
//   A  · v0.1（基线）  相关性二值选取 + 超预算不处理。真实后果是上游按预算硬截尾，
//                      所以本臂如实模拟这一步——只测「编译器输出」而不测「被截之后」，
//                      等于假装超预算没有代价。
//   A′ · 宿主兜底      无 task 时 MCP 走的 renderAll 全量倾倒（见下方注释）。基线唯一
//                      真正溢出的路径，也是这场实验最先烧出来的东西。
//   B  · v0.2（LOD）   相机 + 细节层次 + 预算斜坡。
//
// 四个指标（都对最终进入模型的那段文本测量）：
//   预算利用率   实际字符 / 预算。低=浪费，>1=溢出（会被上游截）
//   可寻址对象   完整 ID 出现在文本里的对象数 / 世界对象总数。模型只能引用它见过的 ID
//   规则存活     enforceable 约束 + 禁区，逐条是否完整出现。**这一项是 0/1 的生死题**
//   焦点保真     任务点名对象的状态字段，有多少条真的出现在文本里

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadOrigin, stateFromObjects } from '../../compiler/index.mjs'
import * as V1 from './baseline-v0.1.mjs'
import * as V2 from '../../compiler/context-compiler.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')

// ── 两个世界 ──────────────────────────────────────────────────────
// W1 是真的：本仓库自己的 project.origin，129 个对象、6 条约束、628 条历史。
const W1 = loadOrigin(join(ROOT, 'project.origin'))

// W2 用 selftest 同款小说夹具，补上关系边——W1 没有 relations，扩跳这条路径要单独测到。
const storyObjects = [
  { id: 'char:lin-zheng', type: 'character', name: '林峥', location: 'loc:dukou-teahouse', alive: true, knows: ['k:map'], bio: '渡口茶馆的常客，左手有旧伤，习惯用右手接东西。行事谨慎，寡言。' },
  { id: 'char:shen-yan', type: 'character', name: '沈砚', location: 'loc:dukou-teahouse', alive: true, knows: ['k:betrayal', 'k:map'], bio: '表面是账房，实为北衙耳目。与赵七有旧怨，从不在人前提及。' },
  { id: 'char:zhao-qi', type: 'character', name: '赵七', location: 'loc:north-alley', alive: true, knows: [], bio: '跑腿的少年，腿快嘴严，认得城里每一条暗巷。' },
  { id: 'obj:black-key', type: 'item', name: '黑钥匙', holder: 'char:lin-zheng', used: false, desc: '铁质，柄上刻一道横纹，能开渡口仓的旧锁。' },
  { id: 'loc:dukou-teahouse', type: 'location', name: '渡口茶馆', desc: '临水,二层,后门通着船坞;白日人杂,入夜只剩守夜的老周。' },
  { id: 'loc:north-alley', type: 'location', name: '北巷', desc: '窄,两侧高墙,尽头是废弃的染坊。' },
  { id: 'hook:witness', type: 'hook', name: '目击伏笔', status: 'planted_unresolved', summary: '有人在第 12 章见过林峥深夜出入船坞。' },
]
const W2 = {
  objects: storyObjects,
  relations: [
    { subject: 'obj:black-key', predicate: 'held_by', object: 'char:lin-zheng' },
    { subject: 'char:lin-zheng', predicate: 'located_in', object: 'loc:dukou-teahouse' },
    { subject: 'char:shen-yan', predicate: 'located_in', object: 'loc:dukou-teahouse' },
    { subject: 'hook:witness', predicate: 'about', object: 'char:lin-zheng' },
  ],
  constraints: [
    { id: 'fz:zhao-qi-alive', rule: '赵七不得死亡', check: { type: 'equals', object: 'char:zhao-qi', field: 'alive', value: true } },
    { id: 'fz:secret', rule: '林峥不得得知背叛', check: { type: 'not_contains', object: 'char:lin-zheng', field: 'knows', value: 'k:betrayal' } },
    { id: 'fz:hook', rule: '目击伏笔不得提前回收', check: { type: 'equals', object: 'hook:witness', field: 'status', value: 'planted_unresolved' } },
  ],
  history: [],
  ids: new Set(storyObjects.map((o) => o.id)),
  state: stateFromObjects(storyObjects),
}

/**
 * 臂 A′：MCP 的兜底路径（adapters/memory/mcp-server.mjs:169 `task ? ctx.text : renderAll`）。
 * 无 task 时宿主放弃相关性选取、把整个世界原样倒出——这是基线唯一会真正溢出的路径，
 * 也是「硬截先切掉什么」能被验到的地方：renderAll 把约束排在全部对象之后（同文件 :252），
 * 于是按预算截尾，最先没的就是「违反即拒绝提交」。这段是照抄，不是重写。
 */
function renderAll(origin) {
  const lines = ['【项目世界状态】']
  const byType = {}
  for (const [id, f] of Object.entries(origin.state)) (byType[f._type ?? 'object'] ??= []).push([id, f])
  for (const [type, items] of Object.entries(byType)) {
    lines.push(`\n· ${type}`)
    for (const [id, f] of items) {
      const bits = Object.entries(f)
        .filter(([k, v]) => k !== '_type' && v !== null && v !== undefined && typeof v !== 'object')
        .map(([k, v]) => `${k}=${v}`)
      const arrs = Object.entries(f).filter(([k, v]) => k !== '_type' && Array.isArray(v) && v.length).map(([k, v]) => `${k}=[${v.join(', ')}]`)
      lines.push(`  ${id}　${[...bits, ...arrs].join('；')}`)
    }
  }
  const enforceable = (origin.constraints ?? []).filter((c) => c.check)
  if (enforceable.length) {
    lines.push('\n【约束·违反即拒绝提交】')
    for (const c of enforceable) lines.push(`  - ${c.rule ?? c.id}`)
  }
  return lines.join('\n')
}

const CASES = [
  { world: W1, wname: 'project.origin（真实·129 对象·0 关系）', task: { goal: '继续推进本象协议的 conformance 工作' } },
  { world: W1, wname: 'project.origin（真实·129 对象·0 关系）', task: { goal: '恢复项目当前状态' }, fallback: renderAll },
  {
    world: W2, wname: 'story（夹具·7 对象·4 关系）',
    task: {
      goal: '把 obj:black-key 交回 char:shen-yan，且不得让 char:lin-zheng 得知背叛',
      forbidden_zones: [{ id: 'fz:no-gate', rule: '本章不得开启渡口仓' }],
    },
  },
]
const BUDGETS = [1500, 3000, 6000, 12000]

// ── 指标 ──────────────────────────────────────────────────────────
const addressable = (text, world) => [...world.ids].filter((id) => text.includes(id)).length

function rulesIntact(text, world, task) {
  const rules = [
    ...(world.constraints ?? []).filter((c) => c.check).map((c) => c.rule ?? c.id),
    ...((task.forbidden_zones ?? []).map((f) => f.rule ?? f.id)),
  ]
  if (!rules.length) return { got: 0, total: 0, ok: true }
  const got = rules.filter((r) => text.includes(r)).length
  return { got, total: rules.length, ok: got === rules.length }
}

/** 焦点对象＝任务文本点名的对象；数它们有多少条状态字段真的进了上下文 */
function focusFidelity(text, world, task) {
  const focus = [...world.ids].filter((id) => task.goal.includes(id))
  let got = 0, total = 0
  for (const id of focus) {
    for (const [k, v] of Object.entries(world.state[id] ?? {})) {
      if (k === '_type' || v === null || v === undefined || typeof v === 'object' && !Array.isArray(v)) continue
      total++
      if (text.includes(`${k}=`)) got++
    }
  }
  return { got, total }
}

const pct = (n) => (n * 100).toFixed(0) + '%'
const bar = (v) => '█'.repeat(Math.max(0, Math.min(20, Math.round(v * 10)))) // 1 格 = 10% 预算

console.log('# 上下文编译器 · 预算行为对照（确定性，无模型调用）\n')

const rows = []
for (const { world, wname, task, fallback } of CASES) {
  console.log(`\n## ${wname}`)
  console.log(`任务：${task.goal}`)
  console.log('')
  console.log('| 预算 | 臂 | 字符 | 利用率 | 可寻址对象 | 规则存活 | 焦点字段 |')
  console.log('|---:|---|---:|---|---:|---|---:|')

  for (const budget of BUDGETS) {
    // 臂 A：基线编译 → 上游按预算硬截（超预算的真实后果）
    const a0 = V1.compileContext({ origin: world, task, budget })
    const aText = a0.estChars > budget ? a0.text.slice(0, budget) : a0.text
    // 臂 B：LOD
    const b0 = V2.compileContext({ origin: world, task, budget })
    const bText = b0.text

    // 臂 A′：宿主兜底（renderAll）→ 同样按预算硬截
    const arms = [['A·v0.1', aText, a0], ['B·v0.2', bText, b0]]
    if (fallback) {
      const f0 = fallback(world)
      arms.splice(1, 0, ["A′·兜底", f0.length > budget ? f0.slice(0, budget) : f0, { estChars: f0.length }])
    }

    for (const [arm, text, raw] of arms) {
      const ru = rulesIntact(text, world, task)
      const ff = focusFidelity(text, world, task)
      const util = text.length / budget
      rows.push({ wname, goal: task.goal, budget, arm, chars: text.length, util, addr: addressable(text, world), ru, ff, truncated: raw.estChars > budget })
      console.log(
        `| ${budget} | ${arm} | ${text.length}${raw.estChars > budget ? ' ⚠截' : ''} | ${pct(util)} ${bar(util)} | ` +
        `${addressable(text, world)}/${world.ids.size} | ${ru.total ? (ru.ok ? `✅ ${ru.got}/${ru.total}` : `❌ ${ru.got}/${ru.total}`) : '—'} | ${ff.total ? `${ff.got}/${ff.total}` : '—'} |`,
      )
    }
  }
}

// ── 汇总 ──────────────────────────────────────────────────────────
console.log('\n\n## 汇总\n')
for (const arm of ['A·v0.1', "A′·兜底", 'B·v0.2']) {
  const r = rows.filter((x) => x.arm === arm)
  const avgUtil = r.reduce((n, x) => n + x.util, 0) / r.length
  const avgAddr = r.reduce((n, x) => n + x.addr / [...CASES].find((c) => c.wname === x.wname).world.ids.size, 0) / r.length
  const ruleFail = r.filter((x) => x.ru.total && !x.ru.ok).length
  const over = r.filter((x) => x.util > 1).length
  console.log(
    `${arm}：平均预算利用率 ${pct(avgUtil)}　平均可寻址 ${pct(avgAddr)}　` +
    `规则残缺 ${ruleFail}/${r.filter((x) => x.ru.total).length} 例　溢出 ${over}/${r.length} 例`,
  )
}
console.log('\n注：「⚠截」表示该臂输出超预算、已按预算硬截尾——这是上游/服务商的真实行为，不是本实验施加的惩罚。')
