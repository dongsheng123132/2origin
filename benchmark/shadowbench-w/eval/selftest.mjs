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

// ── 以下由变异验证补出（`node eval/mutation-check.mjs`，2026-08-08）──────────
// 这几条对应的判分逻辑此前**没有任何断言在看**：把严格比对退化成字符串比、把证据正则
// 放成「非空即可」、把主指标 EPC 写死成 0 —— 三种改法自测都照样全绿。
// 夹具只能证明「判分器能发现坏输入」，证明不了「判分器自己被改坏时会有人喊」。

// ① 类型必须严格。LLM 回填状态时把布尔写成字符串、把标量裹成数组是常事，
//    那是**真的判错了**，不能因为 `String()` 看起来一样就放过去。
const typed = structuredClone(perfect)
typed.state['obj:black-key'].used = 'false' // 期望布尔 false，这里是字符串
check(scoreW3(typed).stateAccuracy < 1, '布尔被写成字符串应判失败（严格比对不许退化）')

const boxed = structuredClone(perfect)
boxed.state['obj:black-key'].holder = ['char:lin-zheng'] // 期望标量，这里裹成数组
check(scoreW3(boxed).stateAccuracy < 1, '标量被裹成数组应判失败')

// ② 证据可追溯率必须真的检查格式。这个数字在 Run #2 被当作 A3 的核心优势公布过
//    （「证据可追溯率 100%，A0 无此能力」），却一直没有断言保护 ——
//    把正则放成 `/./` 之后它恒等于 100%，而报告读起来一模一样。
const evidenced = structuredClone(perfect)
evidenced.evidence = {
  'obj:black-key.holder': 'scene:03-02', // 合格：指得回具体场景
  'char:zhao-qi.alive': '我记得是这样', // 不合格：指不回任何来源
}
const ev = scoreW3(evidenced).evidenceTraceability
check(Math.abs(ev - 0.5) < 1e-9, '指不回来源的证据不算可追溯', `实际 ${ev}`)

// ③ 主指标必须由真实发现数算出来，不能是常数。
//    上面 [W1] 那段只看了 `findings`（逐章规则命中），从不看聚合值 ——
//    于是 `epc: 0` 这种最粗暴的送分能一路绿灯进报告。
check(w1.errors === w1.findings.length, 'errors 必须等于实际发现数')
check(w1.epc > 0, '有违规的夹具，主指标 EPC 必须 > 0（不许是写死的常数）', `实际 ${w1.epc}`)

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

// ── 词表覆盖回归（Run #23/#24 的常设护栏，2026-08-05）────────────────────
// 六条确定性规则曾只认得 13/40 种写法，且漏报**依赖文风**——一条臂写「赵七气绝」被抓，
// 另一条写「赵七死前」不被抓，臂间差异里就混进了「谁的用词更接近词表」这个与正确性无关的量。
// 补完词表若没有回归夹具，下一次「顺手改个正则」就会悄悄退回去，而且不报错。
console.log('\n[词表] 确定性规则覆盖回归')
{
  const { SUITES, checkCase } = await import('./vocab-audit.mjs')
  let miss = 0, fp = 0, real = 0, traps = 0
  for (const [id, cases] of Object.entries(SUITES))
    for (const [text, want, note = '', used = 0] of cases) {
      const got = checkCase(id, text, used ? (await import('./vocab-audit.mjs')).USED_STATE : null)
      if (want) { real++; if (!got) { miss++; console.log(`    ✗ ${id} 漏报：${text.slice(0, 24)}`) } }
      else { traps++; if (got) { fp++; console.log(`    ✗ ${id} 误报：${text.slice(0, 24)}  ${note}`) } }
    }
  check(miss === 0, `${real} 条真违规须全部命中`, `漏报 ${miss} 条`)
  check(fp === 0, `${traps} 个误报陷阱须全部静默`, `误报 ${fp} 条`)
}

// ── 探询提示词不得泄题（第八起事故的常设护栏，2026-08-05）────────────────
// 旧探询把 8 个答案里的 5 个字面印在题面上，照抄即得 75.0%，而二十轮零方差被当成了
// 最硬的证据。这类缺陷不会报错、不会改指纹、结果还特别稳——只能靠一条固定的断言挡住。
console.log('\n[探询] 提示词泄题自检')
{
  const { buildProbePrompt, buildProbeShape } = await import('../arms/lib/probe.mjs')
  const { loadSpec } = await import('./replay.mjs')
  const spec = loadSpec()
  const taskAt = (n) => JSON.parse(readFileSync(join(HERE, '..', 'world', 'spec.origin', 'tasks', n), 'utf8'))
  for (const [label, t] of [['S 级', taskAt('continuation.json')], ['M 级', taskAt('continuation-m.json')]]) {
    const prompt = buildProbePrompt({ task: t, written: '（正文占位）', spec })
    const must = Object.entries(t.expected_state_after.must_hold).filter(([k]) => k !== 'note')

    // 非 ID 类答案（布尔、枚举）：字面值一次都不许出现
    const plain = must.filter(([, v]) => !(typeof v === 'string' && /^(char|obj|loc|hook):/.test(v)))
    const leaked = plain.filter(([, v]) => prompt.includes(String(v)))
    check(leaked.length === 0, `${label}：${plain.length} 个非 ID 答案均不得出现在题面上`, `泄露：${leaked.map(([k]) => k).join('，')}`)

    // ID 类答案：骨架里必然出现某些 ID，藏不掉。判据改成**不得被点名**——
    // 正确 ID 一旦出现，全部同类候选就必须一并出现，否则「出现」这件事本身就是答案。
    // S 级正是栽在这里：正确持有者 char:lin-zheng 以「另一个问题的主语」身份印在题面上。
    for (const [k, v] of must.filter(([, v]) => typeof v === 'string' && v.startsWith('char:'))) {
      if (!prompt.includes(v)) continue
      const missing = spec.characters.map((c) => c.id).filter((id) => !prompt.includes(id))
      check(missing.length === 0, `${label}：${k} 的正确 ID 出现在题面上，则全部候选须一并出现`, `缺：${missing.join('，')}`)
    }

    // 问的字段必须与判的字段完全一致——旧版把 hook 计入分母却从不问（第八起第③条）
    const shape = buildProbeShape(t)
    const asked = new Set()
    for (const [id, fields] of Object.entries({ ...shape.state, ...shape.hooks }))
      for (const f of Object.keys(fields)) asked.add(`${id}.${f}`)
    const notAsked = must.map(([k]) => k.split('.').slice(0, 2).join('.')).filter((k) => !asked.has(k))
    check(notAsked.length === 0, `${label}：待判字段必须全部被问到`, `没问：${notAsked.join('，')}`)
  }
}

console.log(`\n${failed ? `✗ ${failed} 项未通过` : '✓ 全部通过'}`)
process.exit(failed ? 1 : 0)
