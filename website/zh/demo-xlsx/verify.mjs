#!/usr/bin/env node
// 判据：浏览器端 engine.js 在 data.js 上算出的结果，必须与案例包 projections/ 里的记录逐字一致。
//
//   node website/zh/demo-xlsx/verify.mjs
//
// 退出码 0 = 全部一致；任何一项不一致都退出 1 并打印 diff 位置。
// 这里加载的是与浏览器完全相同的 engine.js / data.js 文件，不是另抄一份逻辑。

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// engine.js 是给浏览器的普通脚本，加载后挂在 globalThis.XlsxDemoEngine——这里走同一条路，不另开导出口
await import(pathToFileURL(join(here, 'engine.js')).href)
const E = globalThis.XlsxDemoEngine

const src = readFileSync(join(here, 'data.js'), 'utf8')
const data = JSON.parse(src.slice(src.indexOf('window.XLSX_DEMO_DATA = ') + 'window.XLSX_DEMO_DATA = '.length).replace(/;\s*$/, ''))

const origin = E.loadOrigin(data)
let pass = 0, fail = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`)
  ok ? pass++ : fail++
}
const firstDiff = (a, b) => {
  const al = a.split('\n'), bl = b.split('\n')
  for (let i = 0; i < Math.max(al.length, bl.length); i++)
    if (al[i] !== bl[i]) return `第 ${i + 1} 行不同：\n    浏览器: ${JSON.stringify(al[i])}\n    案例包: ${JSON.stringify(bl[i])}`
  return ''
}

// 1. 判据检查 —— 与 projections/diagnose.txt 逐字一致
const d = E.diagnose(origin)
const txt = E.diagnoseText(d)
const errors = d.findings.filter((f) => f.severity === 'error').length
const warnings = d.findings.filter((f) => f.severity === 'warning').length
check('diagnose 文本与 projections/diagnose.txt 逐字一致', txt === data.reference.diagnose_txt, firstDiff(txt, data.reference.diagnose_txt))
check('error 条数 = 5', errors === 5, `实得 ${errors}`)
check('warning 条数 = 2', warnings === 2, `实得 ${warnings}`)
check('对象 121 / 关系 124 / 约束 13/13', d.objects === 121 && d.relations === 124 && d.constraints.enforceable === 13 && d.constraints.total === 13,
  `实得 ${d.objects}/${d.relations}/${d.constraints.enforceable}/${d.constraints.total}`)

// 2. 过期传播 —— 与 projections/stale-after-tx.json 一致（两种入口：按 history、按页面传入的改动格）
const refStale = data.reference.stale_after_tx.stale_cells.map((c) => c.id).sort()
const fromHistory = E.staleCells(origin)
const fromPick = E.staleCells(origin, ['cell:假设!B/3'])
check('staleCells(按 history) = 28 且与 stale-after-tx.json 同集合', fromHistory.length === 28 && JSON.stringify(fromHistory) === JSON.stringify(refStale), `实得 ${fromHistory.length}`)
check('staleCells(页面传入 假设!B3) = 28 且与 stale-after-tx.json 同集合', fromPick.length === 28 && JSON.stringify(fromPick) === JSON.stringify(refStale), `实得 ${fromPick.length}`)
check('stale-after-tx.json 自报 stale_count 与其列表长度一致', data.reference.stale_after_tx.stale_count === refStale.length)

// 3. 依赖追踪 —— 与 projections/trace-汇总-B3.txt 逐字一致（该文件由 --depth 8 生成）
const tree = E.trace(origin, 'cell:汇总!B/3', { depth: 8 })
const ttxt = E.traceText(tree)
check('trace(汇总!B3, depth 8) 文本与 trace-汇总-B3.txt 逐字一致', ttxt === data.reference.trace_txt, firstDiff(ttxt, data.reference.trace_txt))
check('trace 叶子（人工录入）计数 = 52', E.leaves(tree).length === 52, `实得 ${E.leaves(tree).length}`)

// 4. 其他输入格的传播数——不是判据，只是把事实打印出来供人看（README 只承诺了 假设!B3 → 28）
console.log('\n（参考）各人工录入格改动后的过期公式格数：')
const inputs = Object.keys(origin.state).filter((id) => origin.state[id].kind === 'input').sort()
for (const id of inputs) console.log(`  ${E.short(id).padEnd(10)} → ${E.staleCells(origin, [id]).length}`)

console.log(`\n判决 ${pass}/${pass + fail}`)
process.exit(fail ? 1 : 0)
