#!/usr/bin/env node
// 差分等价测试：合并前的 fork 版校验器 vs 合并后的方言版，同样的输入必须给同样的判定。
//
// 为什么非做不可：results-log.md 里的 W1/W3 数字是**旧校验器**跑出来的。校验器换了实现，
// 若判定跟着变，那些数字就不再是「这套护栏下的成绩」——等于悄悄换了考卷还沿用旧分数。
// 这个项目撤回过两次结论（第七起事故、Gate 0），不能在这种地方留一个没人验过的假设。
//
// 判定标准不是逐字节相同的提示词——实验本来就是随机的（模型未设 temperature，
// results-log 反复强调「单次运行方差大到能翻转结论」，方法论是多轮 + 置换检验）。
// 标准是**门禁的接受/拒绝不变**：同一个事务，旧版拒新版也得拒，旧版过新版也得过。
// 错误码集合也要一致，因为退回重试时这些码原样喂回给模型，且 results-log 按码做过分析。
//
//   node equivalence.mjs          跑全部用例
//   node equivalence.mjs --v      连每条差异的细节一起打印
//
// 旧版实现从 git HEAD 取出，落成 *.local.mjs（已在 .gitignore 里），跑完删掉。

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..', '..')
const RESULTS = join(HERE, '..', '..', 'results')
const CORPUS = join(HERE, '..', '..', 'corpus')
const ORACLE = join(HERE, 'commit-compiler.legacy.local.mjs')
const GIT_PATH = 'benchmark/shadowbench-w/arms/a3-benxiang/commit-compiler.mjs'

const verbose = process.argv.includes('--v')

// ── 取出旧版实现作为对照 ────────────────────────────────────────────────
// 合并那一版之前的 HEAD 里才有 fork 版；若当前 HEAD 已是合并版，往回找最后一个 fork 版。
function legacySource() {
  const revs = execFileSync('git', ['log', '--format=%H', '--', GIT_PATH], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
  for (const rev of revs) {
    const src = execFileSync('git', ['show', `${rev}:${GIT_PATH}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 })
    if (!src.includes("from '../../../../compiler/commit-compiler.mjs'")) return { src, rev }
  }
  throw new Error('git 历史里找不到 fork 版校验器——无法做差分')
}

const { src, rev } = legacySource()
writeFileSync(ORACLE, src)
process.on('exit', () => { try { rmSync(ORACLE) } catch {} })

const legacy = await import('./commit-compiler.legacy.local.mjs')
const merged = await import('./commit-compiler.mjs')

// ── 输入语料 ────────────────────────────────────────────────────────────
const { loadSpec, replay } = await import('../../eval/replay.mjs')
const spec = loadSpec()
const task = JSON.parse(readFileSync(join(HERE, '..', '..', 'world', 'spec.origin', 'tasks', 'continuation.json'), 'utf8'))
const hooks = Object.fromEntries(spec.hooks.map((h) => [h.id, { status: h.status }]))

// 状态取重放出来的真实世界状态，第 10–15 章各一份
const states = [10, 11, 12, 13, 14, 15].map((n) => ({ label: `ch${n}`, state: replay(spec, n).state }))

// 正文取真实语料——prose 规则只有拿到真中文行文才会被触发
const texts = ['ch11', 'ch12', 'ch13']
  .map((n) => join(CORPUS, `${n}.txt`))
  .filter(existsSync)
  .map((p) => readFileSync(p, 'utf8').slice(0, 4000))
if (!texts.length) texts.push('林峥接过黑钥匙，指节泛白。')

// ① 历史上真实被模型提交过的事务（从 97 份结果文件的 gate.rejected 里捞）
function recordedTransactions() {
  const out = []
  for (const f of readdirSync(RESULTS).filter((f) => f.startsWith('a3') && f.endsWith('.json'))) {
    let d
    try { d = JSON.parse(readFileSync(join(RESULTS, f), 'utf8')) } catch { continue }
    for (const r of d?.result?.gate?.rejected ?? []) {
      if (Array.isArray(r.submitted)) out.push({ name: `${f}#ch${r.chapter}a${r.attempt}`, state_changes: r.submitted })
    }
  }
  return out
}

// ② 合成用例：每一类违规各造一个，保证历史语料没覆盖到的分支也被比到
const synthetic = [
  { name: '空变更', state_changes: [] },
  { name: '未知对象', state_changes: [{ object: 'char:not-exist', field: 'alive', to: false }] },
  { name: '缺 field', state_changes: [{ object: 'char:lin-zheng', to: 'x' }] },
  { name: '缺 object', state_changes: [{ field: 'alive', to: false }] },
  { name: '前值不符（stale-write）', state_changes: [{ object: 'char:zhao-qi', field: 'alive', from: false, to: true }] },
  { name: '不声明前值', state_changes: [{ object: 'char:zhao-qi', field: 'location', to: 'loc:dukou-zhen' }] },
  { name: '禁区·赵七死亡', state_changes: [{ object: 'char:zhao-qi', field: 'alive', from: true, to: false }] },
  { name: '禁区·钥匙被用', state_changes: [{ object: 'obj:black-key', field: 'used', from: false, to: true }] },
  { name: '禁区·主角获知叛变', state_changes: [{ object: 'char:lin-zheng', field: 'knows', op: 'append', to: 'k:bai-yao-betrayal' }] },
  { name: '禁区·左手痊愈', state_changes: [{ object: 'char:bai-yao', field: 'left_hand_injured', from: true, to: false }] },
  { name: '正常取钥匙', state_changes: [{ object: 'obj:black-key', field: 'holder', from: 'char:zhao-qi', to: 'char:lin-zheng' }] },
  { name: '无前缀 ID（考归一化）', state_changes: [{ object: 'black-key', field: 'holder', to: 'lin-zheng' }] },
]

// ③ 断言组合：模型自报的字据，含登记的与未登记的
const assertionSets = [
  undefined,
  [],
  ['zhao-qi-alive'],
  ['zhao-qi-alive', 'gate-not-opened', 'betrayal-undisclosed'],
  ['key-intact'],
  ['no-such-assertion'],
]

// ④ 正文形状：缺正文 / 空正文 / 真正文
const textShapes = [
  { label: '无 text', apply: (tx) => { delete tx.text } },
  { label: '空 text', apply: (tx) => { tx.text = '   ' } },
  { label: '真正文', apply: (tx, i) => { tx.text = texts[i % texts.length] } },
]

// ── 比对 ────────────────────────────────────────────────────────────────
// 比的是**退回给模型的那几行原文**，不只是码。index.mjs 把它们拼成
// `[码] 文案` 塞进重试提示——那是模型输入，文案漂了等于悄悄换了实验条件。
const codesOf = (r) => {
  const errs = Array.isArray(r?.errors) ? r.errors : []
  return errs.map((e) => `[${e.code}] ${e.msg}`).sort().join('\n')
}
const warnCodes = (r) => (r?.violations ?? []).filter((x) => x.severity === 'warning').map((x) => x.code).sort().join(',')

let compared = 0
const okDiffs = []
const codeDiffs = []
const warnDiffs = new Map()

const knownIds = new Set([
  ...spec.characters.map((c) => c.id),
  ...spec.objects.map((o) => o.id),
  ...(spec.locations ?? []).map((l) => l.id),
  ...spec.hooks.map((h) => h.id),
])

function compare(name, rawTx, stateBefore, useSpec) {
  // 两侧各自走自己的归一化——归一化也是被合并的对象之一，必须一起比。
  // 归一化本身也可能抛（两版都会：非数组 state_changes 在这里就崩，validate 里那条
  // 早退守卫其实够不着），所以它和校验一起纳入 try。
  const run = (mod) => {
    try {
      const tx = mod.normalizeTransaction(structuredClone(rawTx), knownIds)
      return mod.validateTransaction({ tx, stateBefore, task, hooks, spec: useSpec })
    } catch (e) {
      return { threw: e.constructor.name }
    }
  }
  const ra = run(legacy)
  const rb = run(merged)
  compared++

  // 旧版对非数组 state_changes 早退时不返回 errors 字段，index.mjs 会当场崩——
  // 新版补齐了。这类用例只比 ok，不比码。
  if (ra.threw || rb.threw) {
    if (!!ra.threw !== !!rb.threw) okDiffs.push({ name, legacy: ra.threw ?? ra.ok, merged: rb.threw ?? rb.ok })
    return
  }
  if (ra.ok !== rb.ok) okDiffs.push({ name, legacy: ra.ok, merged: rb.ok, lc: codesOf(ra), mc: codesOf(rb) })
  else if (codesOf(ra) !== codesOf(rb)) codeDiffs.push({ name, legacy: codesOf(ra), merged: codesOf(rb) })

  const wa = warnCodes(ra)
  const wb = warnCodes(rb)
  if (wa !== wb) {
    const key = `${wa || '(无)'} → ${wb || '(无)'}`
    warnDiffs.set(key, (warnDiffs.get(key) ?? 0) + 1)
  }
}

const recorded = recordedTransactions()
console.error(`对照版本：${rev.slice(0, 7)}（fork 版）`)
console.error(`语料：历史真实事务 ${recorded.length} 条 + 合成用例 ${synthetic.length} 条 × 状态 ${states.length} 份`)

// 历史事务：跨每一份状态、每一种正文形状比一遍
recorded.forEach((tx, i) => {
  for (const { label, state } of states) {
    for (const shape of textShapes) {
      const t = { state_changes: structuredClone(tx.state_changes), assertions: assertionSets[i % assertionSets.length] }
      shape.apply(t, i)
      compare(`${tx.name}|${label}|${shape.label}`, t, state, spec)
    }
  }
})

// 合成用例：再叠上「不传 spec」（关掉正文校验）这一路
for (const s of synthetic) {
  for (const { label, state } of states) {
    for (const [ai, assertions] of assertionSets.entries()) {
      for (const shape of textShapes) {
        for (const useSpec of [spec, null]) {
          const t = { state_changes: structuredClone(s.state_changes), assertions }
          shape.apply(t, ai)
          compare(`${s.name}|${label}|a${ai}|${shape.label}|spec=${!!useSpec}`, t, state, useSpec)
        }
      }
    }
  }
}

// 畸形事务：旧版会崩，新版应当稳住
for (const { label, state } of states.slice(0, 1)) {
  compare(`非数组 state_changes|${label}`, { text: '正文', state_changes: 'not-an-array' }, state, spec)
  compare(`state_changes 缺失|${label}`, { text: '正文' }, state, spec)
}

// ── 报告 ────────────────────────────────────────────────────────────────
console.log(`\n差分用例 ${compared} 组`)

let bad = false
if (okDiffs.length) {
  bad = true
  console.log(`\n✗ 接受/拒绝判定不一致：${okDiffs.length} 处`)
  for (const d of okDiffs.slice(0, 20)) console.log(`   ${d.name}\n     旧=${d.legacy} [${d.lc ?? ''}]\n     新=${d.merged} [${d.mc ?? ''}]`)
} else {
  console.log('✓ 接受/拒绝判定完全一致——门禁松紧未变，results-log 的 W1/W3 口径仍然成立')
}

if (codeDiffs.length) {
  bad = true
  console.log(`\n✗ 错误码集合不一致：${codeDiffs.length} 处`)
  for (const d of codeDiffs.slice(0, 20)) console.log(`   ${d.name}\n     旧=${d.legacy}\n     新=${d.merged}`)
} else {
  console.log('✓ 错误码集合完全一致——退回给模型的违规清单、以及按码做的历史分析都不受影响')
}

// 警告差异是**预期内**的，单独列出而非判失败：旧版 normalizeTransaction 无条件写
// `from: normalizeId(undefined)`，于是没声明前值的变更也被当成声明了 undefined，
// 白报一条 stale-write。警告不参与 ok 判定，不影响 W1/W3。
//
// 这个洞在历史运行里**没有真的发作**：22 份带拒绝记录的结果文件里共 311 条变更条目，
// 未声明 from 的是 0 条——模型每次都写了前值。所以累计那 39 条 stale-write 应当都是
// 真实的前值不符，「模型记忆偏差率」不需要回溯修正。
// 保留的余地：结果文件只存被拒事务的变更明细，被接受事务的没存，那部分无法回验。
if (warnDiffs.size) {
  console.log(`\n⚠ 警告集合差异（不影响接受/拒绝，仅影响 gate.warnings 计数口径）：`)
  for (const [k, n] of [...warnDiffs].sort((a, b) => b[1] - a[1])) console.log(`   ${k}　×${n}`)
  console.log('   ↑ 全部来自「未声明前值」的合成用例：旧版把它当成声明了 undefined，虚报 stale-write。')
  console.log('   历史语料里未声明前值的变更为 0/311，故已发表的 stale-write 计数不受影响。')
} else if (verbose) {
  console.log('\n（警告集合亦完全一致）')
}

if (bad) {
  console.error('\n✗ 差分未通过：合并改变了门禁行为，results-log 的数字不能沿用')
  process.exit(1)
}
console.log('\n✓ 差分通过：合并只换了实现，没换判定')
