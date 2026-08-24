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
  // ── 第七要素与投影：2026-08-05 补上向量后，这两块也该有牙齿检查 ──
  {
    claim: '边界声明缺 scope 要被拒（「本工具可能有误差」这种话等于没说）',
    file: 'compiler/limits.mjs',
    find: "if (!l?.scope) out.push({ severity: 'error', code: 'limit-no-scope'",
    to: "if (false) out.push({ severity: 'error', code: 'limit-no-scope'",
  },
  {
    claim: '空边界清单也必须出话（「未声明边界」不等于「没有边界」）',
    file: 'compiler/limits.mjs',
    find: "return '⚠ 本包未声明任何边界。",
    to: "return ''; return '⚠ 本包未声明任何边界。",
  },
  {
    claim: '按 scope 过滤时不得把 lossy / degraded 藏起来（那是数据本身已经不对了）',
    file: 'compiler/limits.mjs',
    find: "return limits.filter((l) => re.test(l.scope) || l.kind === 'lossy' || l.kind === 'degraded')",
    to: "return limits.filter((l) => re.test(l.scope))",
  },
  {
    claim: '投影必须报出目标格式装不下的字段',
    file: 'compiler/project.mjs',
    find: "  for (const [field, count] of [...lostFields].sort((a, b) => b[1] - a[1]))",
    to: "  for (const [field, count] of [])",
  },
  {
    claim: '投影丢掉证据链要单列一条（「这份表答不出凭什么」得写在明面上）',
    file: 'compiler/project.mjs',
    find: "  if (changes && !(carries && carries.includes('__provenance')))",
    to: "  if (false)",
  },
  {
    claim: '投影规划只读，不得改动本源（USD 式叠层，本源始终不动）',
    file: 'compiler/project.mjs',
    find: "      if (carries && !carries.includes(k)) {",
    to: "      if (carries && !carries.includes(k)) { delete src[k];",
  },

]

// filter: () => true 不是摆设——U-King 便携版 Node(v22.20) 在非 ASCII 工作目录下
// 走 cpSync 递归复制的内部快路径会无提示崩溃(进程直接死、退出码127、不抛异常),
// 显式传一个 filter 函数会改走逐条目复制路径,绕开这个雷。官方 Node 不受影响,
// 但本机 PATH 第一个就是便携版 node,不加这个 npm run verify 根本跑不完。
const COPY_ALL = { recursive: true, filter: () => true }
rmSync(LAB, { recursive: true, force: true })
cpSync(join(ROOT, 'compiler'), join(LAB, 'compiler'), COPY_ALL)
cpSync(join(ROOT, 'spec'), join(LAB, 'spec'), COPY_ALL)
// 方言的自测也要跑：核心里有些承诺只有 CAD 那边覆盖得到，
// 只跑 compiler 自测的话，打坏它们会显示成 SURVIVED——那是假的漏网。
cpSync(join(ROOT, 'adapters'), join(LAB, 'adapters'), COPY_ALL)

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

/**
 * 跑一致性向量。与自测的区别是本质性的：
 * 自测是**这份实现**给自己立的规矩，向量是**协议**对所有实现的要求。
 * 一条变异只被自测抓到、向量放过，说明那条承诺协议根本没约束住——
 * 换个人照着规范写一份实现，可以合法地把它做丢。那是规范的洞，不是实现的洞。
 */
function conformancePasses() {
  try { execFileSync(process.execPath, [join(LAB, 'spec', 'conformance', 'run.mjs')], { stdio: 'pipe' }) }
  catch { return false }
  return true
}

console.log('# 变异检查 —— 故意打坏承诺，看自测与一致性向量抓不抓得到\n')

// 先确认未变异时是全绿的，否则后面的结论全部无意义
if (!selftestPasses()) {
  console.error('✗ 未变异的副本自测就没过——先修好自测再来做变异检查')
  rmSync(LAB, { recursive: true, force: true })
  process.exit(1)
}
if (!conformancePasses()) {
  console.error('✗ 未变异的副本跑一致性向量就没过——先修好再来做变异检查')
  rmSync(LAB, { recursive: true, force: true })
  process.exit(1)
}
console.log('基线：未变异副本自测通过 ✓　一致性向量通过 ✓\n')

let killed = 0, survived = 0, broken = 0, selftestOnly = 0
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
  const caughtBySelftest = !selftestPasses()
  const caughtByVectors = !conformancePasses()
  writeFileSync(path, src, 'utf8') // 立刻还原，避免变异叠加

  if (!caughtBySelftest && !caughtByVectors) {
    survived++
    console.log(`  ✗ SURVIVED  #${i + 1} ${m.claim}\n      打坏了也没人报警——这条承诺其实没被验证`)
    continue
  }
  killed++
  const tag = caughtBySelftest && caughtByVectors ? '自测+向量' : caughtByVectors ? '仅向量' : '仅自测'
  console.log(`  ✓ KILLED    #${i + 1} ${m.claim}　[${tag}]`)
  if (!caughtByVectors) {
    selftestOnly++
    console.log('      ⚠ 一致性向量放过了它：协议没把这条钉死，别人照规范另写一份可以合法做丢')
  }
}

rmSync(LAB, { recursive: true, force: true })

console.log(`\n${MUTATIONS.length} 条变异：${killed} 条被抓出，${survived} 条漏网${broken ? `，${broken} 条清单过期` : ''}`)
if (survived || broken) {
  console.log('漏网的每一条都意味着：那部分代码可以被悄悄改坏而没人知道。')
  process.exit(1)
}
console.log('全部被抓出——自测确实守着这些承诺，不是摆设。')
if (selftestOnly) {
  console.log(`\n其中 ${selftestOnly} 条只有自测抓到、一致性向量放过。这不是实现的毛病，`)
  console.log('是**协议的覆盖缺口**：这些承诺目前只约束得了这一份实现，约束不了第二份。')
  console.log('补法要么给 spec/conformance/vectors/ 加向量，要么承认它本就属于实现自由。')
}
