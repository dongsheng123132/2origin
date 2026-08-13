#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DIALECT } from './dialect.mjs'
import { EmbodiedValidationError, getBelief, projectBeliefs, validateEvents } from './reducer.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(HERE, 'fixtures', 'pilot-events.json'), 'utf8'))
const scenario = (id) => {
  const s = fixture.scenarios.find((candidate) => candidate.id === id)
  return { objects: fixture.objects, places: fixture.places, sources: s.sources, events: s.events }
}
const belief = (id, at, object, field) => getBelief(projectBeliefs({ ...scenario(id), at }), object, field)

let pass = 0
let fail = 0
const check = (condition, name, detail = '') => {
  if (condition) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`) }
}
const hasCode = (input, code) => validateEvents(input).some((finding) => finding.code === code)

console.log('\n[方言边界] 五概念齐全，原始感知与控制不进包')
check(['object', 'reference', 'projection', 'transaction', 'validation'].every((key) => DIALECT[key]), '对象 / 引用 / 投影 / 事务 / 校验都有明确映射')
check(fixture.scenarios.every((s) => validateEvents(scenario(s.id)).length === 0), '四组视频事件全部通过确定性校验')

console.log('\n[核心语义] 观察记录与当前信念分开')
let b = belief('S01-static-persistence', 7, 'A', 'location')
check(b.value === 'M' && b.status === 'inferred', '静态遮挡：最后位置保留为 inferred')
check(b.based_on.includes('S01-E01'), '  └ 当前信念能反查直接观察事件')
b = belief('S01-static-persistence', 12, 'A', 'location')
check(b.value === 'M' && b.status === 'observed', '重新看见：同一位置恢复为 observed')

b = belief('S02-hidden-move', 11, 'A', 'location')
check(b.value === null && b.status === 'unknown', '接触后遮挡：旧位置作废，不猜移动结果')
check(b.based_on.includes('S02-E01') && b.based_on.includes('S02-E03'), '  └ unknown 同时保留旧观察与作废事件')
b = belief('S02-hidden-move', 14.5, 'A', 'location')
check(b.value === 'R' && b.status === 'observed', '再次观察：新位置 R 恢复为 observed')
check(belief('S02-hidden-move', 14.5, 'A', 'contact').value === null, '接触结束单独留痕，不靠 object_observed 暗改')

b = belief('S03-similar-object-replacement', 8, 'A', 'location')
check(b.value === null && b.status === 'unknown', '跟踪丢失：A 的位置变为 unknown')
const aNot = belief('S03-similar-object-replacement', 19, 'A', 'identity_not')
const dNot = belief('S03-similar-object-replacement', 19, 'D', 'identity_not')
check(aNot.value === 'D' && dNot.value === 'A', '相似外观对象仍保持 A ≠ D 的持久身份')

b = belief('S04-containment-carry', 15, 'B', 'location')
check(b.value === 'L' && b.status === 'inferred', '容器内物体的位置由 inside(B,A) 与 A.location 推导')
b = belief('S04-containment-carry', 27, 'B', 'location')
check(b.value === 'R' && b.status === 'inferred', '容器移动后，B 的派生位置随 A 更新')
const outside = projectBeliefs({ ...scenario('S04-containment-carry'), at: 42 })
check(getBelief(outside, 'B', 'inside').value === null && getBelief(outside, 'B', 'location').value === 'R', '取出后 inside 清空，B 在 R 被直接观察')

console.log('\n[时间] 不把后来知道的事泄漏进过去')
const beforeKnown = projectBeliefs({ ...scenario('S04-containment-carry'), at: 25 })
const afterKnown = projectBeliefs({ ...scenario('S04-containment-carry'), at: 27 })
check(!beforeKnown.source_events.includes('S04-E04') && getBelief(beforeKnown, 'A', 'location').value === 'L', 'valid_from=19 但 observed_at=27：25 秒投影仍不知道新位置')
check(afterKnown.source_events.includes('S04-E04') && getBelief(afterKnown, 'A', 'location').value === 'R', '27 秒观察完成后才允许进入投影')
const direct = projectBeliefs({ ...scenario('S01-static-persistence'), at: 12 }).objects.A.last_observation.location
check(direct.valid_from === 10.2 && direct.observed_at === 12 && direct.committed_at, 'valid_from / observed_at / committed_at 三种时间没有混成一个字段')

console.log('\n[门禁变异] 故意打坏输入，确认拒绝而非带病投影')
const mutations = [
  ['duplicate-event', (x) => { x.events.push({ ...structuredClone(x.events.at(-1)), committed_at: '2026-08-13T13:00:00Z' }) }],
  ['unknown-object', (x) => { x.events[0].payload.object = 'TYPO-A' }],
  ['attribute-domain', (x) => { x.events[0].payload.attributes.location = 'MOON' }],
  ['evidence-fingerprint-mismatch', (x) => { x.events[0].evidence.sha256 = '0'.repeat(64) }],
  ['observation-outside-evidence', (x) => { x.events[0].observed_at = 9 }],
  ['valid-from-invalid', (x) => { x.events[0].valid_from = 4 }],
  ['commit-order-invalid', (x) => { x.events[1].committed_at = '2026-08-13T11:00:00Z' }],
  ['self-containment', (x) => { x.events[2].payload.container = 'B' }],
  ['duplicate-object', (x) => { x.objects.push(structuredClone(x.objects[0])) }],
  ['duplicate-source', (x) => { x.sources.push(structuredClone(x.sources[0])) }],
  ['evidence-not-yet-available', (x) => { x.events[0].observed_at = x.events[0].evidence.interval_s[1] - 0.1 }],
]
for (const [code, mutate] of mutations) {
  const baseId = code === 'self-containment' ? 'S04-containment-carry' : 'S02-hidden-move'
  const input = structuredClone(scenario(baseId))
  mutate(input)
  check(hasCode(input, code), `打坏 ${code} 被准确检出`)
  let rejected = false
  try { projectBeliefs({ ...input, at: 42 }) } catch (error) { rejected = error instanceof EmbodiedValidationError }
  check(rejected, `  └ ${code} 使整次投影 fail-closed`)
}

console.log('\n[可重建性] 相同事件得到相同投影，输入不被修改')
const input = structuredClone(scenario('S04-containment-carry'))
const before = JSON.stringify(input)
const p1 = projectBeliefs({ ...input, at: 27 })
const p2 = projectBeliefs({ ...input, at: 27 })
check(JSON.stringify(p1) === JSON.stringify(p2), '确定性回放字节级一致')
check(JSON.stringify(input) === before, 'reducer 不修改事件真源')
const stringObjects = projectBeliefs({ ...scenario('S01-static-persistence'), objects: ['A', 'B', 'C', 'D'], at: 7 })
check(getBelief(stringObjects, 'A', 'location').value === 'M', '对象登记兼容字符串 ID 与对象描述两种写法')

console.log(`\n${fail === 0 ? '全部通过' : '存在失败'}：${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
