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
import {
  loadOrigin, stateFromObjects, compileContext, buildPrompt,
  validateTransaction, applyTransaction, normalizeTransaction, checkConstraints, predicateNames,
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

console.log(`\n可用谓词：${predicateNames().join('、')}`)
console.log(`\n${fail ? '✗' : '✓'} ${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
