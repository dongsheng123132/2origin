#!/usr/bin/env node
// 加载浏览器同一份 engine.js + data.js，交叉核对 replay 出的终态与案例包记录的事实是否一致。
// 跑法：node website/zh/demo-story/verify.mjs

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const window = {}
const ctx = { window, console }
vm.createContext(ctx)
vm.runInContext(readFileSync(join(here, 'engine.js'), 'utf8'), ctx)
vm.runInContext(readFileSync(join(here, 'data.js'), 'utf8'), ctx)

const E = ctx.window.StoryEngine
const D = ctx.window.STORY_DEMO_DATA

let fails = 0
function check(label, cond, detail) {
  if (cond) {
    console.log('OK   ' + label)
  } else {
    fails++
    console.log('FAIL ' + label + (detail ? '  ' + detail : ''))
  }
}

const steps = E.replaySteps(D.objects, D.history)
check('replay 步数 = history 长度 + 1', steps.length === D.history.length + 1, `实际 ${steps.length}`)
const final = steps[steps.length - 1]

// 逐项核对 seq11-19（kind:observed，真实事务提交产生的历史）折出的终态，против 案例包本身记录的事实。
check('obj:black-key.holder = char:shen-yan（seq13 真实事务）', final['obj:black-key'].holder === 'char:shen-yan', JSON.stringify(final['obj:black-key']))
check('char:lin-zheng.location = loc:dukou-teahouse（seq19）', final['char:lin-zheng'].location === 'loc:dukou-teahouse')
check('obj:beiting-copper-thread._type = item（seq15）', final['obj:beiting-copper-thread']._type === 'item')
check('obj:beiting-copper-thread.holder = char:shen-yan（seq17）', final['obj:beiting-copper-thread'].holder === 'char:shen-yan')
check('obj:beiting-iron-shard.holder = char:shen-yan（seq18）', final['obj:beiting-iron-shard'].holder === 'char:shen-yan')

// gate-report.json 记录 ch15-auto 这次真实提交改动的字段清单——用 replay 到 seq14 vs seq19 的 diff 反推，
// 应该覆盖 receipt.changed 里列的全部 5 个字段。
const beforeCh15 = steps[14] // 折了 seq1..14 之后（history 数组下标 0-based，seq14 对应 steps[14]）
const changedFields = D.reference.gate_report_ch15.receipt.changed
for (const f of changedFields) {
  const [obj, field] = f.split('.')
  const before = JSON.stringify(beforeCh15[obj]?.[field])
  const after = JSON.stringify(final[obj]?.[field])
  check(`ch15 receipt 字段确有变化：${f}`, before !== after, `${before} -> ${after}`)
}

// 六条约束在真实当前状态（案例包 canon）下应全绿——没人在正文里真的开了门、杀了赵七等。
const results = E.checkAll(final, D.constraints)
for (const r of results) check(`约束 ${r.id} 在当前 canon 下满足`, r.ok, JSON.stringify(r))

// 违规示例：tx-legal-example.json 的 text 字段自称会撞 fz:gate-closed，预期 accepted=false。
const bad = E.diagnoseTx(final, D.demo_txs.legal_example.state_changes, D.constraints)
check('违规示例事务被拒绝', bad.accepted === false, JSON.stringify(bad.violated.map((v) => v.id)))
check('违规示例命中 fz:gate-closed', bad.violated.some((v) => v.id === 'fz:gate-closed'))

// 合法示例：tx-accepted-example.json 的 text 字段自称不碰任何约束字段，预期 accepted=true。
const good = E.diagnoseTx(final, D.demo_txs.accepted_example.state_changes, D.constraints)
check('合法示例事务通过', good.accepted === true, JSON.stringify(good.violated.map((v) => v.id)))

console.log('')
if (fails === 0) {
  console.log(`全部通过（${results.length} 条约束 + 5 条字段 + 2 个示例事务 + 结构性检查）`)
  process.exit(0)
} else {
  console.log(`${fails} 项失败`)
  process.exit(1)
}
