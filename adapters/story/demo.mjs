#!/usr/bin/env node
// OriginWriter 演示 —— 从世界规格建包 → 新会话恢复 → 提交第 11 章 →
// 禁区拒绝 → 伏笔图谱。演示目录在系统临时目录，跑完自清理。
//
//   node adapters/story/demo.mjs
//
// 输出即「对外可演示」的完整会话：每一步打印做什么、给什么、结果如何。

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { initWriter, projectState, submitChapter, checkChapter, hookGraph, seqOf } from './engine.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SPEC = join(HERE, '..', '..', 'benchmark', 'shadowbench-w', 'world', 'spec.origin')
const CORPUS = join(HERE, '..', '..', 'benchmark', 'shadowbench-w', 'corpus')

const tmp = mkdtempSync(join(tmpdir(), 'origin-story-demo-'))
const PKG = join(tmp, '月落渡口.origin')

const step = (s) => console.log(`\n━━━ ${s} ━━━`)

try {
  step('① 建包：世界重放到第 10 章（之后的剧情由 AI 亲手提交）')
  initWriter(PKG, SPEC, { untilChapter: 10, title: '《月落渡口》续写工程' })
  console.log(`   包：${PKG}`)
  console.log(`   世界规格：${SPEC}`)

  step('② 新会话秒恢复：一条命令拿到全部世界状态')
  const s = projectState(PKG)
  console.log(s.split('\n').slice(0, 10).map((l) => '   ' + l).join('\n'))
  console.log('   …')

  step('③ 关键事实核对（为什么能信这些值）')
  console.log('   origin why obj:black-key.holder → 应由 provenance 回答：')
  console.log('   · ch02 老陶抵债给赵七（ev:002, scene:02-03）')
  console.log('   · ch11 林峥自赵七处取得（待提交）')

  step('④ AI 提交第 11 章（正文 + 黑钥匙易主事务）')
  const ch11 = readFileSync(join(CORPUS, 'ch11.txt'), 'utf8')
  const good = submitChapter(PKG, {
    chapter: 11,
    transaction_id: 'ch11-s01',
    text: ch11,
    state_changes: [
      { object: 'obj:black-key', field: 'holder', from: 'char:zhao-qi', to: 'char:lin-zheng', basis: ['scene:11-07'] },
    ],
    assertions: ['zhao-qi-alive', 'gate-not-opened', 'key-intact', 'betrayal-undisclosed', 'left-hand-still-injured'],
  }, { by: 'deepseek-v4-flash' })
  if (good.ok) {
    console.log(`   ✓ 已落盘 seq ${good.receipt.seq_from}–${good.receipt.seq_to}，${good.receipt.chars} 字，正文存 ${good.receipt.text_file}`)
    for (const ref of good.receipt.changed) console.log(`   · 状态变更：${ref}`)
  } else {
    console.log('   ✗ 被拒绝：', good.violations.map((v) => v.msg).join('；'))
  }

  step('⑤ 禁区拒绝演示：模型想在第 12 章用掉黑钥匙')
  const bad = checkChapter(PKG, {
    chapter: 12,
    text: '林峥在月台转动黑钥匙，空间门轰然开启。',
    state_changes: [{ object: 'obj:black-key', field: 'used', from: false, to: true }],
    assertions: ['zhao-qi-alive', 'gate-not-opened'],
  })
  for (const v of bad.violations) console.log(`   ✗ [${v.code}] ${v.msg}`)
  console.log(`   结论：零写入（seq 仍为 ${seqOf(PKG)}），理由已返回给模型重写`)

  step('⑥ 正文对照演示：正文写「白遥左手挥刀」（第 9 章起左手已伤）')
  const hand = checkChapter(PKG, {
    chapter: 12,
    text: '白遥在茶肆后巷，左手持刀格开飞来的瓦片。',
    state_changes: [{ object: 'char:bai-yao', field: 'left_hand_injured', from: true, to: false }],
    assertions: ['left-hand-still-injured'],
  })
  for (const v of hand.violations) console.log(`   ✗ [${v.code}] ${v.msg}`)

  step('⑦ 伏笔图谱：埋下的、待收的、未埋的')
  for (const h of hookGraph(PKG)) {
    const tag = h.status === 'planted_unresolved' ? '⚠ 待收' : h.status === 'not_planted' ? '· 未埋' : '✓ 已收'
    console.log(`   ${tag}  ${h.id}  (埋于 ch${h.setup_chapter ?? '-'}${h.payoff_chapter ? `，回收于 ch${h.payoff_chapter}` : ''})  ${String(h.summary).slice(0, 26)}`)
  }

  step('⑧ 新会话再恢复（模拟第二天继续写）')
  const s2 = projectState(PKG)
  console.log('   ' + s2.split('\n').filter((l) => l.includes('black-key') || l.includes('char:lin-zheng') || l.includes('char:zhao-qi')).join('\n   '))
  console.log(`\n演示完成。完整工程在：${PKG}`)
} finally {
  // 演示完保留目录供查看；注释下一行可改为自动清理
  // rmSync(tmp, { recursive: true, force: true })
}
