#!/usr/bin/env node
// 参考实现自测：同一套编译器 / 校验器，必须同时跑通两个毫不相干的领域。
//
//   node compiler/selftest.mjs
//
// 这个测试就是「本象是不是一个协议」的判据。若只在小说上成立，那它是个小说工具；
// 只有当**销售数据**这种没有人物、没有情节、没有伏笔的域也能用同一份代码校验落地，
// 「面向 AI 的持久对象表示层」这句话才算兑现。

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { rmSync } from 'node:fs'
import {
  loadOrigin, stateFromObjects, compileContext, compileDelta, buildPrompt,
  validateTransaction, applyTransaction, normalizeTransaction, checkConstraints, predicateNames,
  why, historyOf, replay, diagnose, findMirrorPairs,
  commit, initPackage, seqOf,
} from './index.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
let pass = 0, fail = 0
const check = (cond, name, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`) }
}

// ── 领域一：销售数据（无人物、无叙事） ─────────────────────────────
console.log('# 本象协议参考实现自测\n')
console.log('[域 1] 销售数据 spec/examples/sales-2026.origin')

const sales = loadOrigin(join(HERE, '..', 'spec', 'examples', 'sales-2026.origin'))
check(sales.objects.length === 5, `加载 5 个对象`, `实际 ${sales.objects.length}`)
check(sales.relations.length === 2, `加载 2 条关系`, `实际 ${sales.relations.length}`)
check(sales.manifest.artifact?.id === 'sales-2026', 'manifest 解析出 artifact.id')
check(sales.state['field:revenue']?.unit === 'CNY', '状态里带上了字段语义 unit=CNY')

// 该包的约束是人类可读句子（无 machine_check）——协议必须如实报告「这条没人守」
const advisory = checkConstraints(sales.state, sales.constraints)
check(
  advisory.length === 2 && advisory.every((v) => v.code === 'unenforceable'),
  '无机器判定的约束被显式标为 unenforceable（而非静默放行）',
  JSON.stringify(advisory.map((v) => v.code)),
)

// 给这个域补上可执行约束：营收不得为负 —— 只加数据，不改代码
const salesConstraints = [
  { id: 'revenue-non-negative', rule: 'revenue must_not_be_negative', check: { type: 'range', object: 'dataset:sales-2026', field: 'total_revenue', min: 0 } },
  { id: 'source-immutable', rule: '投影改动不得回写源数据', check: { type: 'unchanged', object: 'dataset:sales-2026', field: 'total_revenue' } },
]
const salesState = { ...sales.state, 'dataset:sales-2026': { ...sales.state['dataset:sales-2026'], total_revenue: 120000 } }

// 合法事务：只改投影的图表类型（对应 spec/examples/tx-change-chart.json 的意图）
const txChart = {
  transaction_id: 'tx-20260803-001',
  operation: 'patch_projection',
  target: 'projection:revenue-trend',
  state_changes: [{ object: 'projection:revenue-trend', field: 'chart', from: 'Line Chart', to: 'Grouped Bar Chart' }],
  assertions: ['no-source-data-modified'],
}
const okChart = validateTransaction({
  tx: txChart, stateBefore: salesState, constraints: salesConstraints,
  assertions: { 'no-source-data-modified': (s) => s['dataset:sales-2026']?.total_revenue === 120000 },
})
check(okChart.ok, '改投影图表类型的事务通过校验', JSON.stringify(okChart.violations))

// 违规事务：借「改投影」之名把源数据改成负数——两条约束都该拦
const txBad = {
  transaction_id: 'tx-20260803-002',
  operation: 'patch_projection',
  target: 'projection:revenue-trend',
  state_changes: [{ object: 'dataset:sales-2026', field: 'total_revenue', from: 120000, to: -5 }],
  assertions: ['no-source-data-modified'],
}
const badChart = validateTransaction({
  tx: txBad, stateBefore: salesState, constraints: salesConstraints,
  assertions: { 'no-source-data-modified': (s) => s['dataset:sales-2026']?.total_revenue === 120000 },
})
check(!badChart.ok, '回写源数据为负的事务被拒绝')
check(badChart.violations.some((v) => v.msg.includes('低于下限')), '  └ range 谓词报出越界')
check(badChart.violations.some((v) => v.msg.includes('不得改动')), '  └ unchanged 谓词报出源数据被动')
check(badChart.violations.some((v) => v.code === 'assertion-failed'), '  └ 模型自报断言被复核推翻')

// ── 领域二：叙事世界（人物、秘密、伏笔） ───────────────────────────
console.log('\n[域 2] 叙事世界（同一套代码，零改动）')

const storyObjects = [
  { id: 'char:lin-zheng', type: 'character', name: '林峥', location: 'loc:tower', knows: ['k:gate-exists'] },
  { id: 'char:zhao-qi', type: 'character', name: '赵七', alive: true },
  { id: 'obj:black-key', type: 'item', name: '黑钥匙', holder: 'char:lin-zheng', used: false },
  { id: 'hook:witness', type: 'hook', name: '目击伏笔', status: 'planted_unresolved' },
]
const story = { objects: storyObjects, relations: [], constraints: [], ids: new Set(storyObjects.map((o) => o.id)), state: stateFromObjects(storyObjects) }

// 三个原本写死在实验臂里的小说专用类型，全部用通用谓词表达——没有一行新代码
const storyConstraints = [
  { id: 'fz:zhao-qi-alive', rule: '赵七不得死亡', check: { type: 'equals', object: 'char:zhao-qi', field: 'alive', value: true } },
  { id: 'fz:secret', rule: '林峥不得得知背叛', check: { type: 'not_contains', object: 'char:lin-zheng', field: 'knows', value: 'k:betrayal' } },
  { id: 'fz:hook', rule: '目击伏笔不得提前回收', check: { type: 'equals', object: 'hook:witness', field: 'status', value: 'planted_unresolved' } },
]

const txMove = {
  transaction_id: 'tx-s-001', operation: 'append_scene', target: 'chapter-51',
  state_changes: [{ object: 'obj:black-key', field: 'holder', from: 'char:lin-zheng', to: 'char:shen-yan' }],
}
check(validateTransaction({ tx: txMove, stateBefore: story.state, constraints: storyConstraints }).ok, '合法转手事务通过')

const txKill = { transaction_id: 'tx-s-002', operation: 'append_scene', target: 'chapter-51', state_changes: [{ object: 'char:zhao-qi', field: 'alive', from: true, to: false }] }
check(!validateTransaction({ tx: txKill, stateBefore: story.state, constraints: storyConstraints }).ok, 'equals 谓词拦住「赵七死亡」')

const txLeak = { transaction_id: 'tx-s-003', operation: 'append_scene', target: 'chapter-51', state_changes: [{ object: 'char:lin-zheng', field: 'knows', op: 'append', to: 'k:betrayal' }] }
check(!validateTransaction({ tx: txLeak, stateBefore: story.state, constraints: storyConstraints }).ok, 'not_contains 谓词拦住秘密泄漏')

const txHook = { transaction_id: 'tx-s-004', operation: 'append_scene', target: 'chapter-51', state_changes: [{ object: 'hook:witness', field: 'status', from: 'planted_unresolved', to: 'resolved' }] }
check(!validateTransaction({ tx: txHook, stateBefore: story.state, constraints: storyConstraints }).ok, 'equals 谓词拦住伏笔提前回收')

// ── 从实验里换来的两条接口教训，必须有回归保护 ─────────────────────
console.log('\n[回归] 实验中付出过代价的两处')

const txNoPrefix = { transaction_id: 'tx-s-005', operation: 'append_scene', target: 'x', state_changes: [{ object: 'black-key', field: 'holder', from: 'lin-zheng', to: 'zhao-qi' }] }
const normed = normalizeTransaction(txNoPrefix, story.ids)
check(normed.state_changes[0].object === 'obj:black-key', 'ID 归一化补回 object 前缀（曾致整章作废）')
check(normed.state_changes[0].to === 'char:zhao-qi', 'ID 归一化补回取值前缀')

const txStale = { transaction_id: 'tx-s-006', operation: 'append_scene', target: 'x', state_changes: [{ object: 'obj:black-key', field: 'holder', from: 'char:WRONG', to: 'char:zhao-qi' }] }
const staleRes = validateTransaction({ tx: txStale, stateBefore: story.state, constraints: [] })
check(staleRes.ok, 'stale-write 只警告不拦截（曾按错误处理，一次运行废掉 3 章）')
check(staleRes.violations.some((v) => v.code === 'stale-write' && v.severity === 'warning'), '  └ 但仍如实报告为警告')

// ── 落地与来源 ────────────────────────────────────────────────
console.log('\n[落地] 状态折叠与 provenance')
const applied = applyTransaction({ tx: txMove, state: story.state, by: 'selftest', at: '2026-08-03' })
check(applied.state['obj:black-key'].holder === 'char:shen-yan', '事务落地后状态已更新')
check(story.state['obj:black-key'].holder === 'char:lin-zheng', '原状态未被就地修改（纯函数）')
check(applied.provenance['obj:black-key.holder']?.tx === 'tx-s-001', '逐字段记录了来源事务')

// ── 上下文编译 ────────────────────────────────────────────────
console.log('\n[输入侧] 上下文编译')
const ctx = compileContext({
  origin: story,
  task: { goal: '把黑钥匙交回 char:shen-yan，且不得让 char:lin-zheng 得知背叛' },
  pin: ['char:zhao-qi'], budget: 4000,
})
check(ctx.selected.includes('obj:black-key'), '任务点名的对象被选入上下文')
check(ctx.selected.includes('char:zhao-qi'), 'pin 的对象被钉住')
check(ctx.text.includes('obj:black-key'), '渲染使用完整 ID（曾因剥前缀致 5 章全废）')
check(ctx.text.includes('holder=char:lin-zheng'), '字段值也带完整 ID 前缀')
check(!ctx.overBudget, '未超预算')
check(buildPrompt(ctx).includes('不可省略前缀'), '输出契约包含前缀要求')

// ── 帧与差分（保留模式）─────────────────────────────────────────
console.log('\n[输入侧] 帧与差分')
const frameArgs = { origin: story, task: { goal: '把黑钥匙交回 char:shen-yan' }, budget: 4000 }
const f1 = compileContext(frameArgs)
check(typeof f1.frame?.id === 'string' && f1.frame.id.length === 8, '每一帧带内容指纹')
check(compileContext(frameArgs).frame.id === f1.frame.id, '同样的世界+任务+预算 → 同一个帧 id（纯函数）')

// 世界没变：差分应为空，且仍然重发规则
const dSame = compileDelta({ ...frameArgs, since: f1.frame })
check(dSame.kind === 'delta' && dSame.delta.changed === 0, '世界未变时差分为空')
check(dSame.base === f1.frame.id, '差分标出所基于的帧 id（对不上时调用方才发现得了）')

// 改一个字段：差分只包含那一个对象
const moved = { ...story.state, 'obj:black-key': { ...story.state['obj:black-key'], holder: 'char:zhao-qi' } }
const dOne = compileDelta({ ...frameArgs, state: moved, since: f1.frame })
check(dOne.delta.changed === 1, '改一个字段 → 差分只含一个对象', `实际 ${dOne.delta?.changed}`)
check(dOne.text.includes('obj:black-key') && dOne.text.includes('holder=char:zhao-qi'), '  └ 且给的是新值')
check(dOne.estChars < compileContext({ ...frameArgs, state: moved }).estChars, '  └ 差分比关键帧短')

// 规则永远重发——基帧可能已被上下文压缩挤掉，差分不带规则等于让模型裸奔
const ruled = { origin: { ...story, constraints: storyConstraints }, task: frameArgs.task, budget: 4000 }
const rf1 = compileContext(ruled)
const rd = compileDelta({ ...ruled, state: moved, since: rf1.frame })
check(
  storyConstraints.every((c) => rd.text.includes(c.rule)),
  '差分里原样重发全部约束（275 字符的保险，不省）',
)

// 差分不许比关键帧更长——优化不能把事情变坏
const wideChange = Object.fromEntries(
  Object.entries(story.state).map(([id, s]) => [id, { ...s, note: '每个对象都变了一点' }]),
)
const dWide = compileDelta({ ...frameArgs, state: wideChange, since: f1.frame })
check(dWide.estChars <= compileContext({ ...frameArgs, state: wideChange }).estChars, '差分不小于关键帧时退回关键帧')

// 没有基帧就是关键帧，不能悄悄发一份「相对于不存在的东西」的差分
check(compileDelta({ ...frameArgs }).kind === 'key', '未提供 since 时发关键帧')

// ── 证据链：来源不只是「记下来」，得「查得出」 ───────────────────────
console.log('\n[证据] provenance 日志与 why 查询')

// 两次事务改同一个字段——覆写式 provenance 在这里会丢掉第一次，append-only 日志不会
const j1 = applyTransaction({ tx: txMove, state: story.state, by: 'agent-a', at: '2026-08-03T10:00' })
const txBack = {
  transaction_id: 'tx-s-007', operation: 'append_scene', target: 'chapter-52',
  // 故意谎报前值：模型以为钥匙还在林峥手上，实际已转给沈砚
  state_changes: [{ object: 'obj:black-key', field: 'holder', from: 'char:lin-zheng', to: 'char:zhao-qi' }],
}
const j2 = applyTransaction({ tx: txBack, state: j1.state, history: j1.journal, by: 'agent-b', at: '2026-08-03T11:00' })
const hist = [...j1.journal, ...j2.journal]

check(hist.length === 2 && hist[1].seq === 2, 'journal 按 seq 连续追加（第二次改动没有覆盖第一次）')
check(hist[1].from === 'char:shen-yan', '记录的 from 是落地时的真实前值')
check(hist[1].claimed_from === 'char:lin-zheng', '  └ 模型谎报的前值单独存为 claimed_from（此前报个警告就丢了）')
check(hist[0].claimed_from === undefined, '  └ 前值声明正确时不记 claimed_from')

const w = why({ state: story.state, history: hist, ref: 'obj:black-key.holder' })
check(w.value === 'char:zhao-qi', 'why 给出重放后的当前值')
check(w.chain.length === 2 && w.chain[0].seq === 2, 'why 的改动链最新在前')
check(w.chain[1].by === 'agent-a', '  └ 第一次改动没丢，责任者可追')
check(w.drift === 1, '  └ 偏差次数可累计（模型记忆偏差率的原料）')

const wInit = why({ state: story.state, history: hist, ref: 'char:zhao-qi.alive' })
check(wInit.explained === false && wInit.value === true, '未经事务的字段如实报告「来自包的初始对象表」')

const past = replay(story.state, hist, { until: 'tx-s-001' })
check(past['obj:black-key'].holder === 'char:shen-yan', '按事务 ID 重放到历史某一刻（撤回级联将复用这条路径）')

check(historyOf(hist, { by: 'agent-b' }).length === 1, 'historyOf 可按责任者过滤')
check(historyOf(hist, { object: 'char:zhao-qi' }).length === 0, 'historyOf 可按对象过滤')

// 双份账本：docs/03 原则六那条实测缺陷的机器版
const doubled = {
  'char:lin-zheng': { carries: ['obj:black-key'] },
  'obj:black-key': { holder: 'char:lin-zheng' },
}
check(findMirrorPairs(doubled).length === 1, '双份账本探测抓出 carries/holder 互指（曾致钥匙转手后两边失配）')
check(findMirrorPairs({ 'a:1': { ref: 'a:2' }, 'a:2': { name: 'x' } }).length === 0, '  └ 单向引用不误报')

// ── 包体检 ────────────────────────────────────────────────────
console.log('\n[体检] diagnose')
const diag = diagnose(sales)
check(diag.changes === 2, '读出示例包 provenance/history.jsonl 里的 2 条状态变更')
check(diag.findings.some((f) => f.code === 'unenforceable-ratio'), '报出「2 条约束无一可机器判定」')
check(diag.findings.some((f) => f.code === 'dangling-relation'), '报出关系指向包外对象 dataset:order-items')
check(diag.findings.some((f) => f.code === 'drift-rate'), '报出模型记忆偏差率')
check(diag.ok, '以上均为 warning，示例包无 error 级问题（退出码 0）')
check(
  replay(sales.state, sales.history)['projection:revenue-trend'].chart === 'Stacked Bar Chart',
  '重放示例包日志后，图表类型已是两次事务之后的值',
)

// ── 正文对照状态：只校验状态字段是不够的 ──────────────────────
// docs/03 原则九的回归保护。实验里出现过状态字段完全正确、正文却把关键物品
// 写在错误人物手上的情况；把确定性规则接进门禁后三次运行的错误数从 1/6/3 降为 0/0/0。
// **这条此前没有任何测试覆盖**——是 mutation-check.mjs 把它照出来的。
console.log('\n[门禁] 正文与状态对照')

const NAME = { 'char:lin-zheng': '林峥', 'char:zhao-qi': '赵七', 'char:shen-yan': '沈砚' }
/** 宿主提供的正文检查器：正文若让非持有人握着关键物品，就是与状态矛盾。 */
const holderProse = {
  check(text, { stateAfter }) {
    const holder = stateAfter['obj:black-key']?.holder
    const hits = []
    for (const [id, name] of Object.entries(NAME))
      if (id !== holder && text.includes(name) && text.includes('黑钥匙'))
        hits.push({ why: `正文让${name}握着黑钥匙，状态里的持有人却是 ${holder}`, quote: text })
    return hits
  },
}

const txProseBad = { ...txMove, text: '沈砚走后，林峥仍攥着那把黑钥匙。' }
const proseBad = validateTransaction({ tx: txProseBad, stateBefore: story.state, constraints: storyConstraints, prose: holderProse })
check(!proseBad.ok && proseBad.violations.some((v) => v.code === 'prose-violation'), '状态变更全合法、正文却写错持有人 → 拒绝')
check(
  validateTransaction({ tx: txMove, stateBefore: story.state, constraints: storyConstraints, prose: holderProse }).ok,
  '  └ 不带正文时不误判（状态层照常通过）',
)
const txProseOk = { ...txMove, text: '沈砚接过黑钥匙，转身走进雨里。' }
check(validateTransaction({ tx: txProseOk, stateBefore: story.state, constraints: storyConstraints, prose: holderProse }).ok, '  └ 正文与状态一致时放行')

// ── 通配约束与新建：三个域共同要的两样东西 ─────────────────────
console.log('\n[通用性] 通配约束与显式新建')

// 一条约束管住全部同类对象——图纸有几千个构件时，逐个写规则是不可能的，
// 更要命的是新增构件不会被旧规则覆盖
const wildState = {
  'part:beam-A1': { level: 3.2, material: 'C30' },
  'part:beam-B7': { level: 2.1, material: 'C30' },
  'part:beam-C3': { level: 2.9, material: 'C30' },
}
const wildRule = [{ id: 'headroom', rule: '梁底净高不得低于 2.6m', check: { type: 'range', object: 'part:*', field: 'level', min: 2.6 } }]
const wildHits = checkConstraints(wildState, wildRule)
check(wildHits.length === 1 && wildHits[0].msg.includes('beam-B7'), '一条通配约束扫过全部同类对象，只报越界的那个')
check(checkConstraints({ ...wildState, 'part:beam-D9': { level: 0.5 } }, wildRule).length === 2, '  └ 新增对象自动被同一条约束覆盖')
check(checkConstraints({ 'other:x': { level: 0.1 } }, wildRule).length === 0, '  └ 不匹配的对象不受影响')

// in / exists：状态机合法取值与必填
const enumRule = [{ id: 'rev', rule: '版次只能是 A/B/C', check: { type: 'in', object: 'dwg:*', field: 'rev', values: ['A', 'B', 'C'] } }]
check(checkConstraints({ 'dwg:S-201': { rev: 'B' } }, enumRule).length === 0, 'in 谓词放行合法取值')
check(checkConstraints({ 'dwg:S-201': { rev: 'Z' } }, enumRule).length === 1, '  └ 拦住非法取值')
check(checkConstraints({ 'dwg:S-201': {} }, enumRule).length === 0, '  └ 字段缺失交给 exists 判，不越权')

const reqRule = [{ id: 'owner', rule: '必须有负责人', check: { type: 'exists', object: 'task:*', field: 'owner' } }]
check(checkConstraints({ 'task:t1': { owner: '张三' } }, reqRule).length === 0, 'exists 谓词放行已填字段')
check(checkConstraints({ 'task:t1': { owner: '' } }, reqRule).length === 1, '  └ 空字符串算未填')
check(checkConstraints({ 'task:t1': {} }, reqRule).length === 1, '  └ 字段缺失算未填')

// 聚合谓词：判的是一组对象之间的关系，不能被通配展开成逐个校验
const codes = {
  'part:b1': { code: 'C1' }, 'part:b2': { code: 'C2' }, 'part:b3': { code: 'C2' },
  'label:l1': {}, 'label:l2': {},
}
const uniqRule = [{ id: 'u', rule: '构件编号不得重复', check: { type: 'unique', object: 'part:*', field: 'code' } }]
const uniqHits = checkConstraints(codes, uniqRule)
check(uniqHits.length === 1 && uniqHits[0].msg.includes('C2'), 'unique 谓词抓出跨对象的重复编号')
check(checkConstraints({ 'part:b1': { code: 'C1' } }, uniqRule).length === 0, '  └ 不重复时不报')

// 「同一件事有两处表述，两处必须对得上」——门窗表 5 樘 vs 图上 4 樘的通用形状
const countRule = [{ id: 'c', rule: '构件数必须等于标签数', check: { type: 'count', object: 'part:*', equals_count_of: 'label:*' } }]
check(checkConstraints(codes, countRule).length === 1, 'count 谓词抓出两处数量对不上（3 vs 2）')
check(checkConstraints({ 'part:a': {}, 'label:x': {} }, countRule).length === 0, '  └ 对得上时不报')
check(checkConstraints({ 'ghost:1': {} }, [{ id: 'z', check: { type: 'count', object: 'ghost:*', equals: 0 } }]).length === 1, 'count equals 0 可用来断言「某类对象不该存在」')

// 新建必须显式声明——否则 ID 打错一个字母就会静默造出永远没人管的幽灵对象
const txGhost = { transaction_id: 'tx-g', state_changes: [{ object: 'char:lin-zhen', field: 'location', to: 'loc:x' }] }
const ghostRes = validateTransaction({ tx: txGhost, stateBefore: story.state, constraints: [] })
check(!ghostRes.ok && ghostRes.violations.some((v) => v.code === 'unknown-object'), '未声明就改不存在的对象 → 拒绝（幽灵对象防护）')

const txCreate = {
  transaction_id: 'tx-c', creates: [{ id: 'char:shen-yan', type: 'character' }],
  state_changes: [{ object: 'char:shen-yan', field: 'location', to: 'loc:tower' }],
}
const createRes = validateTransaction({ tx: txCreate, stateBefore: story.state, constraints: [] })
check(createRes.ok, '声明后即可新建', JSON.stringify(createRes.violations))
check(createRes.stateAfter['char:shen-yan']._type === 'character', '  └ 类型随新建一起落地')

// **实测教训**的回归保护：没写 from 的变更曾被 normalizeTransaction 塞进 from: undefined，
// 于是前值检查去读一个还不存在的对象，当场崩溃
const normCreate = normalizeTransaction(txCreate, story.ids)
check(!('from' in normCreate.state_changes[0]), '归一化不给无 from 的变更凭空补一个 from 键（曾致新建对象时崩溃）')

// ── 落盘：从「校验通过」到「真的写进去了」 ────────────────────────
console.log('\n[持久化] commit 往返')

const TMP = join(tmpdir(), `origin-selftest-${process.pid}`)
rmSync(TMP, { recursive: true, force: true })
initPackage(TMP, {
  objects: storyObjects,
  constraints: storyConstraints,
  manifest: 'artifact:\n  id: selftest-story\n  kind: story\n',
})
check(seqOf(TMP) === 0, '新包的 seq 水位为 0')

const c1 = commit(TMP, txMove, { by: 'agent-a', at: '2026-08-04T09:00:00Z' })
check(c1.ok && c1.receipt.seq_to === 1, '合法事务落盘并返回回执', JSON.stringify(c1.violations ?? []))
check(c1.receipt.changed[0] === 'obj:black-key.holder', '  └ 回执列出改动的字段')

const reloaded = loadOrigin(TMP)
check(reloaded.state['obj:black-key'].holder === 'char:shen-yan', '重新加载后当前状态已是新值')
check(reloaded.initial['obj:black-key'].holder === 'char:lin-zheng', '  └ 出生证明未被覆写（objects.jsonl 原封不动）')
check(why({ state: reloaded.initial, history: reloaded.history, ref: 'obj:black-key.holder' }).chain[0].by === 'agent-a', '  └ 落盘后 why 查得到责任者')

// 违规事务：一个字节都不许写
const c2 = commit(TMP, txKill, { by: 'agent-b' })
check(!c2.ok && c2.violations.some((v) => v.code === 'constraint'), '违规事务被拒绝并给出理由')
check(seqOf(TMP) === 1, '  └ 拒绝时未落盘（seq 水位没动）')

// 插队检测：拿着过期的水位提交
const c3 = commit(TMP, txLeak, { by: 'agent-c', expectedSeq: 0 })
check(!c3.ok && c3.conflict?.actual === 1, '过期水位提交被判为写入冲突（首个写者胜）')
check(seqOf(TMP) === 1, '  └ 冲突时同样未落盘')

const c4 = commit(TMP, txBack, { by: 'agent-d', expectedSeq: 1, at: '2026-08-04T10:00:00Z' })
check(c4.ok && c4.receipt.warnings.some((w) => w.code === 'stale-write'), '前值谎报只作为警告随回执返回，不阻断落地')
check(loadOrigin(TMP).state['obj:black-key'].holder === 'char:zhao-qi', '  └ 第二次提交后状态正确')
check(diagnose(loadOrigin(TMP)).findings.some((f) => f.code === 'drift-rate' && f.msg.includes('1/2')), '  └ 偏差率累计为 1/2')

rmSync(TMP, { recursive: true, force: true })

console.log(`\n可用谓词：${predicateNames().join('、')}`)
console.log(`\n${fail ? '✗' : '✓'} ${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
