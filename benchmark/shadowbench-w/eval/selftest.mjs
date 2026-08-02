#!/usr/bin/env node
// 判分器自测：谁来验证验证者。
// 一个悄悄什么都检测不出的判分器，会让所有实验臂看起来都很完美——这是基准最危险的失效方式。
// 本测试用已知违规的夹具反测确定性规则，并用一段干净文本反测误报。
//
//   node eval/selftest.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { scoreW1 } from './ced.mjs'
import { scoreW3 } from './state-diff.mjs'
import { scoreW2 } from './detect-score.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(HERE, 'fixtures', 'ced-selftest.json'), 'utf8'))

let failed = 0
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`)
  if (!ok) failed++
}

console.log('# 判分器自测\n\n[W1] 确定性规则')
const w1 = scoreW1(fixture)
for (const [chKey, expectedRule] of Object.entries(fixture._expect)) {
  const chapter = Number(chKey.replace('ch', ''))
  const hits = w1.findings.filter((f) => f.chapter === chapter)
  if (expectedRule === null) {
    check(hits.length === 0, `ch${chapter} 干净对照无误报`, hits.length ? `实际报出 ${hits.map((h) => h.rule).join('、')}` : '')
  } else {
    check(hits.some((h) => h.rule === expectedRule), `ch${chapter} 命中 ${expectedRule}`, hits.length ? '' : '（一条都没报出）')
  }
}

console.log('\n[W3] 状态比对')
const perfect = {
  arm: '__selftest__',
  state: {
    'obj:black-key': { holder: 'char:lin-zheng', used: false, intact: true },
    'char:zhao-qi': { alive: true },
    'char:bai-yao': { left_hand_injured: true, secret_betrayal: true },
    'char:lin-zheng': { knows: ['k:space-gate-exists'] },
  },
  hooks: { 'hook:a-zhi-witness': { status: 'planted_unresolved' } },
}
check(scoreW3(perfect).stateAccuracy === 1, '全对的状态应得 100%')

const leaked = structuredClone(perfect)
leaked.state['char:lin-zheng'].knows.push('k:bai-yao-betrayal')
check(scoreW3(leaked).stateAccuracy < 1, 'knows 泄漏应被 not_contains 抓到')

const stale = structuredClone(perfect)
stale.state['obj:black-key'].holder = 'char:zhao-qi'
check(scoreW3(stale).stateAccuracy < 1, '钥匙未转手应判失败')

const partial = { arm: '__selftest__', state: { 'obj:black-key': { holder: 'char:lin-zheng' } } }
check(scoreW3(partial).missing > 0, '漏报字段应计入 missing')

console.log('\n[W2] 检出评分')
const w2 = scoreW2({
  arm: '__selftest__',
  detections: [
    { chapter: 10, description: '白遥左手挥刀，但其左手第 9 章已受伤' }, // 命中 planted:001
    { chapter: 6, description: '正午时分开启月台之门，违反时辰规则' }, // 命中 planted:003
    { chapter: 3, description: '铜铃响时禽鸟尽飞，此处有异' }, // 踩中 trap:001（其实合规）
  ],
})
check(w2.matched.filter((m) => m.found).length === 2, '应命中 2 条注入', `实际 ${w2.matched.filter((m) => m.found).length}`)
check(Math.abs(w2.recall - 2 / 6) < 1e-9, '召回率应为 2/6')
check(Math.abs(w2.precision - 2 / 3) < 1e-9, '准确率应为 2/3')
check(w2.trapsTriggered === 1, '应识别出踩中 1 个误报陷阱')

console.log(`\n${failed ? `✗ ${failed} 项未通过` : '✓ 全部通过'}`)
process.exit(failed ? 1 : 0)
