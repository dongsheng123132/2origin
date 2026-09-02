#!/usr/bin/env node
// 加载浏览器同一份 engine.js + data.js，交叉核对与真实 CLI（adapters/cad/diff.mjs）
// 直接对同一对 fixture 跑出的结果是否一致。
// 跑法：node website/zh/demo-cad/verify.mjs

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')
const window = {}
const ctx = { window, console }
vm.createContext(ctx)
vm.runInContext(readFileSync(join(here, 'engine.js'), 'utf8'), ctx)
vm.runInContext(readFileSync(join(here, 'data.js'), 'utf8'), ctx)

const E = ctx.window.CadEngine
const D = ctx.window.CAD_DEMO_DATA

let fails = 0
function check(label, cond, detail) {
  if (cond) console.log('OK   ' + label)
  else { fails++; console.log('FAIL ' + label + (detail ? '  ' + detail : '')) }
}

check('对象数：旧版 13', D.old.length === 13, `实际 ${D.old.length}`)
check('对象数：新版 12', D.neu.length === 12, `实际 ${D.neu.length}`)

const r = E.comparePackages(D.old, D.neu)
check('修改 2 处', r.changed.length === 2, `实际 ${r.changed.length}`)
check('新增 0 处', r.added.length === 0, `实际 ${r.added.length}`)
check('删除 1 处', r.removed.length === 1, `实际 ${r.removed.length}`)
check('不变 5 处', r.stable.length === 5, `实际 ${r.stable.length}`)
check('删除的是 ent:结构/B04', r.removed[0]?.id === 'ent:结构/B04', JSON.stringify(r.removed[0]?.id))
check('修改的是 B02 和 B03', r.changed.map((c) => c.id).sort().join(',') === 'ent:结构/B02,ent:结构/B03', r.changed.map((c) => c.id).join(','))

// 与真实 CLI 直接跑同一对 fixture 的输出逐字段核对（不是信任 CLI 的自我报告，是重新跑一遍拿退出码和文本）。
const tmpOld = join(repo, 'tmp-cad-verify-old.origin')
const tmpNew = join(repo, 'tmp-cad-verify-new.origin')
execFileSync('node', ['adapters/cad/import.mjs', 'adapters/cad/fixtures/C-101.dxf', tmpOld, '--name', 'C-101'], { cwd: repo })
execFileSync('node', ['adapters/cad/import.mjs', 'adapters/cad/fixtures/C-101-v2.dxf', tmpNew, '--name', 'C-101-v2'], { cwd: repo })
let cliOut = ''
try {
  cliOut = execFileSync('node', ['adapters/cad/diff.mjs', tmpOld, tmpNew], { cwd: repo }).toString()
} catch (e) {
  cliOut = e.stdout ? e.stdout.toString() : ''  // diff.mjs 退出码 1 表示有变化，属预期，不是失败
}
check('CLI 输出提及"2 处修改 · 0 处新增 · 1 处删除 · 5 处不变"', cliOut.includes('2 处修改 · 0 处新增 · 1 处删除 · 5 处不变'), cliOut.split('\n')[2])
check('CLI 输出提及删除 ent:结构/B04', cliOut.includes('删除  ent:结构/B04'))

rmSync(tmpOld, { recursive: true, force: true })
rmSync(tmpNew, { recursive: true, force: true })

console.log('')
if (fails === 0) console.log(`全部通过`)
else { console.log(`${fails} 项失败`); process.exit(1) }
