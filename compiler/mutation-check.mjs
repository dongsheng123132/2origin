#!/usr/bin/env node
// 变异检查 —— 证明自测不是摆设。
//
//   node compiler/mutation-check.mjs
//
// 「73 项全过」本身说明不了什么：一套只断言 1+1=2 的测试也能全过。
// 真正该问的是**反过来**：如果我把某条承诺故意打坏，测试会不会当场发现？
//
// 于是这里把参考实现复制一份，逐条注入下面这些「破坏」，每次都重跑完整自测：
//   - 测试挂了 → 这条承诺确实被守着（KILLED）
//   - 测试照过 → **这条承诺其实没人验证**，是个洞（SURVIVED）
//
// 每一条变异都对应协议明面上的一个主张。一条活下来就退出码 1——
// 与其让「全绿」制造安全感，不如让洞立刻暴露。

import { execFileSync } from 'node:child_process'
import { cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const LAB = join(tmpdir(), `benxiang-mutation-${process.pid}`)

/** 每条变异：打坏哪个承诺、改哪一行、改成什么。 */
const MUTATIONS = [
  {
    claim: '当前状态由重放历史得出（否则 append-only 的日志就是摆设）',
    file: 'compiler/origin.mjs',
    find: 'const state = replay(initial, history)',
    to: 'const state = initial',
  },
  {
    claim: '校验不通过就不许落地',
    file: 'compiler/commit-compiler.mjs',
    find: "const errors = v.filter((x) => x.severity !== 'warning')",
    to: 'const errors = []',
  },
  {
    claim: '模型谎报的前值要留痕（模型记忆偏差率的原料）',
    file: 'compiler/commit-compiler.mjs',
    find: 'rec.claimed_from = c.from',
    to: 'void c.from',
  },
  {
    claim: '写入冲突检测（首个写者胜）',
    file: 'compiler/store.mjs',
    find: 'if (expectedSeq !== null && expectedSeq !== seqNow)',
    to: 'if (false)',
  },
  {
    claim: 'ID 归一化补回命名空间前缀',
    file: 'compiler/commit-compiler.mjs',
    find: 'for (const p of prefixes) if (known.has(p + raw)) return p + raw',
    to: 'for (const p of prefixes) if (false) return p + raw',
  },
  {
    claim: '通配约束扫过全部同类对象',
    file: 'compiler/constraints.mjs',
    find: "if (typeof check?.object !== 'string' || !check.object.includes('*')) return [check]",
    to: 'if (true) return [check]',
  },
  {
    claim: '未声明就改不存在的对象要拒绝（幽灵对象防护）',
    file: 'compiler/commit-compiler.mjs',
    find: 'if (!exists && !created.has(c.object))',
    to: 'if (false)',
  },
  {
    claim: '编号唯一性（跨对象）',
    file: 'compiler/constraints.mjs',
    find: 'if (seen.has(key)) dups.push',
    to: 'if (false) dups.push',
  },
  {
    claim: '数量对账：同一件事的两处表述必须对上（门窗表 vs 平面图）',
    file: 'compiler/constraints.mjs',
    find: 'return n === m ? null : `${c.object} 有 ${n} 个',
    to: 'return null && `${c.object} 有 ${n} 个',
  },
  {
    claim: '聚合谓词不被通配展开（展开后「一组对象之间的关系」就没意义了）',
    file: 'compiler/constraints.mjs',
    find: 'for (const one of AGGREGATE.has(check.type) ? [check] : expand(check, stateAfter)) {',
    to: 'for (const one of expand(check, stateAfter)) {',
  },
  {
    claim: '双份账本探测',
    file: 'compiler/provenance.mjs',
    find: "if (typeof b !== 'string' || b === a || !state[b]) continue",
    to: 'continue',
  },
  {
    claim: '正文与状态对照（曾出现状态全对、正文写错持有人）',
    file: 'compiler/commit-compiler.mjs',
    find: "if (prose?.check && typeof tx.text === 'string' && tx.text)",
    to: 'if (false)',
  },
  {
    claim: '模型自报断言要被复核',
    file: 'compiler/commit-compiler.mjs',
    find: 'else if (!pred(stateAfter)) v.push',
    to: 'else if (false) v.push',
  },
]

rmSync(LAB, { recursive: true, force: true })
cpSync(join(ROOT, 'compiler'), join(LAB, 'compiler'), { recursive: true })
cpSync(join(ROOT, 'spec'), join(LAB, 'spec'), { recursive: true })
// 方言的自测也要跑：核心里有些承诺只有 CAD 那边覆盖得到，
// 只跑 compiler 自测的话，打坏它们会显示成 SURVIVED——那是假的漏网。
cpSync(join(ROOT, 'adapters'), join(LAB, 'adapters'), { recursive: true })

const pristine = new Map()
for (const m of new Set(MUTATIONS.map((x) => x.file)))
  pristine.set(m, readFileSync(join(LAB, m), 'utf8'))

const SUITES = [join(LAB, 'compiler', 'selftest.mjs'), join(LAB, 'adapters', 'cad', 'selftest.mjs')]

/** 跑全部自测，任何一套挂了就算「抓到了」。 */
function selftestPasses() {
  for (const s of SUITES) {
    try { execFileSync(process.execPath, [s], { stdio: 'pipe' }) }
    catch { return false }
  }
  return true
}

console.log('# 变异检查 —— 故意打坏承诺，看自测抓不抓得到\n')

// 先确认未变异时是全绿的，否则后面的结论全部无意义
if (!selftestPasses()) {
  console.error('✗ 未变异的副本自测就没过——先修好自测再来做变异检查')
  rmSync(LAB, { recursive: true, force: true })
  process.exit(1)
}
console.log('基线：未变异副本自测通过 ✓\n')

let killed = 0, survived = 0, broken = 0
for (const [i, m] of MUTATIONS.entries()) {
  const path = join(LAB, m.file)
  const src = pristine.get(m.file)

  // 变异必须精确命中一处。命中零处或多处都说明这份清单已经跟代码脱节，
  // 那样跑出来的「全部 KILLED」是假的——所以宁可报错也不含糊过去。
  const hits = src.split(m.find).length - 1
  if (hits !== 1) {
    console.log(`  ⚠ #${i + 1} ${m.claim}\n      变异点在 ${m.file} 里命中 ${hits} 处（应为 1）——清单已过期`)
    broken++
    continue
  }

  writeFileSync(path, src.replace(m.find, m.to), 'utf8')
  const stillPasses = selftestPasses()
  writeFileSync(path, src, 'utf8') // 立刻还原，避免变异叠加

  if (stillPasses) { survived++; console.log(`  ✗ SURVIVED  #${i + 1} ${m.claim}\n      打坏了也没测试报警——这条承诺其实没被验证`) }
  else { killed++; console.log(`  ✓ KILLED    #${i + 1} ${m.claim}`) }
}

rmSync(LAB, { recursive: true, force: true })

console.log(`\n${MUTATIONS.length} 条变异：${killed} 条被抓出，${survived} 条漏网${broken ? `，${broken} 条清单过期` : ''}`)
if (survived || broken) {
  console.log('漏网的每一条都意味着：那部分代码可以被悄悄改坏而没人知道。')
  process.exit(1)
}
console.log('全部被抓出——自测确实守着这些承诺，不是摆设。')
