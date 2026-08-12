#!/usr/bin/env node
// 投影等价测试：合并前的 fork 版投影器 vs 合并后的方言着色器，**逐字节相同**。
//
//   node benchmark/shadowbench-w/arms/a3-benxiang/projection-equivalence.mjs
//   node …/projection-equivalence.mjs --v      打印首处差异的上下文
//
// 为什么标准是逐字节，而不是像 equivalence.mjs 那样只比「判定不变」：
//
//   校验器的产出是**判定**（过/拒 + 错误码），那是可以脱离字面比较的语义对象。
//   投影器的产出是**提示词本身**——它就是喂给模型的输入。差一个字，模型的输出分布
//   就变了，results-log.md 里 W1/W2/W3 的数字也就不再是「这套输入下的成绩」。
//   这个项目撤回过两次结论（第七起事故、Gate 0），不能在换实现时留一个没人验过的假设。
//
// 所以 lod:false 这条缺省路径的合同是：**换实现，不换一个字节。**
// 要用核心的预算斜坡必须显式 lod:true——那是新的一臂，重新跑分，不沿用旧数字。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadSpec, replay } from '../../eval/replay.mjs'
import { compileContext as fresh } from './context-compiler.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const VERBOSE = process.argv.includes('--v')

// ── 旧实现：从 git 里取合并前那一版，避免「照抄一份再跟自己比」的自证 ──────
//
// **钉死在 commit，不能用 HEAD。** 用 HEAD 的话，这份改动一旦提交，HEAD 就指向新实现，
// 测试会静默退化成「自己跟自己比」、从此永远通过——一个恒真的断言比没有断言更坏，
// 因为它还占着一行绿色的 ✓。69d2d07 是合并前最后一个含 fork 版投影器的提交。
import { execFileSync } from 'node:child_process'
const LEGACY_COMMIT = '69d2d07'
const LEGACY_PATH = 'benchmark/shadowbench-w/arms/a3-benxiang/context-compiler.mjs'
const ROOT = join(HERE, '..', '..', '..', '..')
let legacy
try {
  const src = execFileSync('git', ['show', `${LEGACY_COMMIT}:${LEGACY_PATH}`], { cwd: ROOT, encoding: 'utf8' })
  // 自证防护：旧版必须真的是那份 fork，否则这场比对没有意义
  if (src.includes('narrativeShader') || !src.includes('relevantCharacters')) {
    throw new Error(`${LEGACY_COMMIT} 里的不是合并前的 fork 版投影器`)
  }
  legacy = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))
} catch (e) {
  console.error(`✗ 取不到合并前的实现（${LEGACY_COMMIT}:${LEGACY_PATH}）：${e.message}`)
  console.error('  这个测试的全部意义就是跟旧版比对，取不到就不能假装通过。')
  process.exit(1)
}

// ── 真实世界与真实任务 ────────────────────────────────────────────
const spec = loadSpec()
const TASKS = [
  {
    goal: '把 obj:black-key 从 char:lao-tao 手里转交给 char:lin-zheng，途中不得惊动观星台',
    forbidden_zones: [
      { id: 'fz:betrayal', rule: '林峥不得知晓白遥叛变' },
      { id: 'fz:gate', rule: '空间门不得被开启' },
    ],
  },
  { goal: '写赵七在渡口的一场戏', forbidden_zones: [{ id: 'fz:key-once', rule: '黑钥匙不得被使用' }] },
  { goal: '推进主线：观星台察觉异动', forbidden_zones: [] },
]

// 初始状态 + 若干重放后的中途状态——投影是状态的函数，只比初始态等于没比
const state0 = Object.fromEntries(
  [...spec.characters, ...spec.objects].map((o) => [o.id, { ...(o.initial_state ?? {}) }]),
)
const midStates = [
  state0,
  { ...state0, 'char:lin-zheng': { ...state0['char:lin-zheng'], location: 'loc:dukou', left_hand_injured: true } },
  {
    ...state0,
    'obj:black-key': { ...state0['obj:black-key'], holder: 'char:lin-zheng' },
    'char:zhao-qi': { ...state0['char:zhao-qi'], alive: false },
  },
]

// 尾巴必须取**真实运行时的量级**。run.mjs 把整个语料文件当 corpusTail 传进来
// （ch01-50.txt = 292756 字符），旧实现只保留尾部 `budget - 正文` ≈ 4700 字符。
//
// 这里曾只用 4000 字符的短尾巴——短到 slice 恒等于全量，于是「截不截断」这条路径
// 根本没被测到，一个会让提示词膨胀 60 倍的实现差异安然通过了 54 例。
// 教训：**等价测试的输入量级必须覆盖真实运行的量级**，否则绿灯只证明了没测到。
const FULL_TAIL = readFileSync(join(HERE, '..', '..', 'corpus', 'ch01-50.txt'), 'utf8')
const TAILS = [
  ['无正文', ''],
  ['短尾巴', FULL_TAIL.slice(-4000)],       // 短于剩余预算：不触发截断
  ['真实全量尾巴', FULL_TAIL],               // 292756 字符：必须被截到预算内
]

let pass = 0, fail = 0
const cases = []
for (const [ti, task] of TASKS.entries())
  for (const [si, state] of midStates.entries())
    for (const chapter of [1, 17, 50])
      for (const [tname, recentText] of TAILS)
        cases.push({ name: `task${ti}·state${si}·ch${chapter}·${tname}`, task, state, chapter, recentText })

console.log(`# A3 投影等价：合并前 fork vs 合并后着色器（${cases.length} 例，逐字节）\n`)

for (const c of cases) {
  const args = { spec, state: c.state, task: c.task, chapter: c.chapter, budget: 6000, recentText: c.recentText }
  const a = legacy.compileContext(args).text
  const b = fresh({ ...args, lod: false }).text

  if (a === b) { pass++; continue }
  fail++
  console.log(`  ✗ ${c.name}　旧 ${a.length} 字符 / 新 ${b.length} 字符`)
  if (VERBOSE) {
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    console.log(`    首处差异 @${i}`)
    console.log(`    旧：${JSON.stringify(a.slice(Math.max(0, i - 60), i + 60))}`)
    console.log(`    新：${JSON.stringify(b.slice(Math.max(0, i - 60), i + 60))}`)
  }
}

// ── LOD 开关确实有效（否则「缺省不变」只是因为钩子根本没接上）──────────
console.log('')
const probe = { spec, state: midStates[0], task: TASKS[0], chapter: 17, budget: 1200, recentText: '' }
const off = fresh({ ...probe, lod: false }).text
const on = fresh({ ...probe, lod: true }).text
const lodWorks = on.length <= 1200 && off.length > 1200 && on !== off
console.log(
  lodWorks
    ? `  ✓ lod 开关有效：同样预算 1200，关=${off.length} 字符（溢出），开=${on.length} 字符（守住）`
    : `  ✗ lod 开关无效：关=${off.length}，开=${on.length}，预算 1200`,
)
lodWorks ? pass++ : fail++

// 规则不许被降级掉——这是着色器把世界规则放进 fixed 的理由
const rulesKept = spec.rules.every((r) => on.includes(r.statement))
console.log(rulesKept ? '  ✓ LOD 降档后世界规则一条不少（fixed 段不参与降级）' : '  ✗ LOD 降档吃掉了世界规则')
rulesKept ? pass++ : fail++

console.log(`\n${fail ? '✗' : '✓'} ${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
