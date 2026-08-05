#!/usr/bin/env node
// OriginWriter 自测（Story 方言）。
//
//   node adapters/story/selftest.mjs
//
// 覆盖：建包（重放到第 N 章）/ 状态投影 / 提交通过（落盘+正文+outline）/
// 禁区拒绝（零写入）/ 正文对照（CED 规则）/ stale-write 降级 / 写冲突 /
// 伏笔状态机与回收依据。
// 所有临时文件写在系统临时目录，跑完自清理，不留仓库。

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { initWriter, projectState, submitChapter, checkChapter, hookGraph, seqOf } from './engine.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SPEC = join(HERE, '..', '..', 'benchmark', 'shadowbench-w', 'world', 'spec.origin')
const CORPUS = join(HERE, '..', '..', 'benchmark', 'shadowbench-w', 'corpus')

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? '　' + extra : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${extra ? '　' + extra : ''}`) }
}

const tmp = mkdtempSync(join(tmpdir(), 'origin-story-'))
const PKG = join(tmp, 'novel.origin')

try {
  console.log('OriginWriter 自测（Story 方言）：')

  // ── 建包 ──
  initWriter(PKG, SPEC, { untilChapter: 10 })
  ok('从世界规格建包，重放到第 10 章', existsSync(join(PKG, 'graph', 'objects.jsonl')))
  ok('禁区已翻译成约束', readFileSync(join(PKG, 'graph', 'constraints.json'), 'utf8').includes('forbidden-zone') || JSON.parse(readFileSync(join(PKG, 'graph', 'constraints.json'), 'utf8')).length > 0)

  const s10 = projectState(PKG)
  ok('ch10 状态投影含黑钥匙在赵七手', s10.includes('obj:black-key') && /holder=char:zhao-qi/.test(s10))
  ok('ch10 状态投影：林峥在渡口镇', /char:lin-zheng/.test(s10) && /location=loc:dukou-zhen/.test(s10))
  ok('ch10 状态投影：白遥左手已伤', /char:bai-yao/.test(s10) && /left_hand_injured=true/.test(s10))
  ok('ch10 状态投影：林峥不知道叛变', !/char:lin-zheng[\s\S]{0,200}?knows=\[[^\]]*k:bai-yao-betrayal/.test(s10))

  const hooks = hookGraph(PKG)
  ok('伏笔图谱：shen-yan-suspicion 待收', hooks.find((h) => h.id === 'hook:shen-yan-suspicion')?.status === 'planted_unresolved')
  ok('伏笔图谱：second-bell 未埋（payoff 在 48 章）', hooks.find((h) => h.id === 'hook:second-bell')?.status === 'not_planted')
  ok('seq=10（重放 10 条）', seqOf(PKG) === 10)

  // ── 合法提交 ──
  const ch11 = readFileSync(join(CORPUS, 'ch11.txt'), 'utf8')
  const good = submitChapter(PKG, {
    chapter: 11,
    transaction_id: 'ch11-s01',
    text: ch11,
    state_changes: [
      { object: 'obj:black-key', field: 'holder', from: 'char:zhao-qi', to: 'char:lin-zheng', basis: ['scene:11-07'] },
    ],
    assertions: ['zhao-qi-alive', 'gate-not-opened', 'key-intact', 'betrayal-undisclosed', 'left-hand-still-injured'],
  }, { by: 'selftest' })
  ok('合法章节提交通过', good.ok, good.ok ? '' : JSON.stringify(good.violations?.slice(0, 2)))
  ok('黑钥匙易主落盘', good.ok && good.receipt.changed.includes('obj:black-key.holder'))
  ok('正文写入 narrative/chapters/ch11.txt', existsSync(join(PKG, 'narrative', 'chapters', 'ch11.txt')))
  ok('outline 登记第 11 章', readFileSync(join(PKG, 'narrative', 'chapters', 'outline.jsonl'), 'utf8').includes('"chapter":11'))
  ok('seq 推进到 11', seqOf(PKG) === 11)
  ok('提交后黑钥匙在林峥手', projectState(PKG).includes('holder=char:lin-zheng'))

  // ── 禁区拒绝 + 零写入 ──
  const before = seqOf(PKG)
  const bad = submitChapter(PKG, {
    chapter: 12, transaction_id: 'ch12-bad',
    text: '林峥在月台转动黑钥匙，空间门轰然开启。',
    state_changes: [{ object: 'obj:black-key', field: 'used', from: false, to: true, basis: ['scene:12-01'] }],
    assertions: ['zhao-qi-alive', 'gate-not-opened'],
  })
  ok('禁区违规被拒绝（钥匙不得使用）', !bad.ok && bad.violations.some((v) => v.code === 'constraint'))
  ok('自报断言复核失败', !bad.ok && bad.violations.some((v) => v.code === 'assertion-failed'))
  ok('零字节写入（seq 未推进）', seqOf(PKG) === before)
  ok('无 ch12.txt 落盘', !existsSync(join(PKG, 'narrative', 'chapters', 'ch12.txt')))

  // ── 正文对照状态（CED 规则）──
  const hand = checkChapter(PKG, {
    chapter: 12,
    text: '白遥在茶肆后巷，左手持刀格开飞来的瓦片。',
    state_changes: [{ object: 'char:bai-yao', field: 'left_hand_injured', from: true, to: false }],
    assertions: ['left-hand-still-injured'],
  })
  ok('正文用左手挥刀被 CED 规则拦截', !hand.ok && hand.violations.some((v) => v.code === 'constraint'))
  ok('状态声明左手痊愈被断言复核拦截', hand.violations.some((v) => v.code === 'assertion-failed'))

  // ── stale-write 降级 ──
  const stale = checkChapter(PKG, {
    chapter: 12,
    text: '林峥把黑钥匙交给沈砚验看。',
    state_changes: [{ object: 'obj:black-key', field: 'holder', from: 'char:zhao-qi', to: 'char:shen-yan' }],
  })
  ok('记错前值降级为警告不拒绝', stale.ok && stale.violations.some((v) => v.severity === 'warning' && v.code === 'stale-write'))

  // ── 写冲突 ──
  const conflict = submitChapter(PKG, { chapter: 13, text: '一段正文', state_changes: [] }, { expect_seq: 5 })
  ok('expect_seq 不符拒绝（插队检测）', !conflict.ok && conflict.conflict)

  // ── 伏笔状态机 ──
  // ① 非法状态取值：把 shen-yan-suspicion 改成不存在于状态机的值
  const hookBad = checkChapter(PKG, {
    chapter: 12,
    text: '沈砚断定台内并无内应。',
    state_changes: [{ object: 'hook:shen-yan-suspicion', field: 'status', from: 'planted_unresolved', to: 'paid' }],
  })
  ok('伏笔状态非法取值被拒', !hookBad.ok && hookBad.violations.some((v) => v.code === 'hook-status'))
  // ② 回收无依据：把 a-zhi-witness 改为 resolved，但不给 basis 也不声明 payoff
  const hookPayoff = checkChapter(PKG, {
    chapter: 12,
    text: '阿枝终于开口，说出那夜所见。',
    state_changes: [{ object: 'hook:a-zhi-witness', field: 'status', from: 'planted_unresolved', to: 'resolved' }],
  })
  ok('伏笔回收无依据被拒（hook-payoff）', !hookPayoff.ok && hookPayoff.violations.some((v) => v.code === 'hook-payoff'))
  // ③ 禁区伏笔不得回收：a-zhi-witness 是禁区（fz:a-zhi-silent），即使带 payoff 也被 equals 拦截
  const hookForbidden = checkChapter(PKG, {
    chapter: 12,
    text: '阿枝终于开口，说出那夜所见。',
    state_changes: [{ object: 'hook:a-zhi-witness', field: 'status', from: 'planted_unresolved', to: 'resolved', basis: ['scene:12-09'] }],
    hooks: [{ id: 'hook:a-zhi-witness', status: 'resolved', payoff: { chapter: 12 } }],
  })
  ok('禁区伏笔回收被拦（fz:a-zhi-silent）', !hookForbidden.ok && hookForbidden.violations.some((v) => v.id === 'fz:a-zhi-silent'))

  console.log(`\n${pass} 通过 / ${fail} 失败`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
process.exit(fail ? 1 : 0)
