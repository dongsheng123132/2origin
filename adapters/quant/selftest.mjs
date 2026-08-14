#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkLimits } from '../../compiler/limits.mjs'
import { effectSemantics, quantLimits, validateEvent } from './dialect.mjs'
import { inject } from './fault-inject.mjs'
import { runBenchmark } from './benchmark.mjs'
import { readEvents, replay } from './replay.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixtures', 'synthetic-day', 'events.jsonl')
let pass = 0
let fail = 0
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}`) }
}
const eq = (got, want, name) => ok(JSON.stringify(got) === JSON.stringify(want), `${name}${JSON.stringify(got) === JSON.stringify(want) ? '' : `（实为 ${JSON.stringify(got)}，应为 ${JSON.stringify(want)}）`}`)
const has = (report, code) => report.issues.some((x) => x.code === code)

const events = readEvents(FIXTURE)

console.log('\n一 · 公开契约')
for (const name of ['event-envelope', 'trade-intent', 'order-event', 'fill-event']) {
  const schema = JSON.parse(readFileSync(join(HERE, 'schemas', `${name}.schema.json`), 'utf8'))
  ok(schema.$schema?.includes('2020-12') && schema.title?.includes('Benxiang Quant'), `${name}.schema.json 可解析且声明方言`)
}
eq(checkLimits(quantLimits()), [], '机器可读 limits 自身合规')
eq(validateEvent(events[0]), [], '合成行情事件通过零依赖形状闸门')
ok(validateEvent({ kind: 'fill.event', payload: {} }).filter((x) => x.severity === 'error').length > 5, '残缺成交不会被当成合法事件')

console.log('\n二 · 健康交易日')
const base = replay(events)
eq(base.metrics.errors, 0, '健康交易日零 error')
eq(base.metrics.closure_rate, 1, '两个 TradeIntent 全部闭合')
eq(base.state.portfolio.expected_positions['510300.SH'], 1500, '两笔成交只合计一次，预期持仓 1500')
eq(base.state.portfolio.actual_positions['510300.SH'], 1500, '券商快照持仓 1500')
eq(base.state.orders[0].effect_semantics, 'compensatable', '已成交不是 rollback，只能补偿')

console.log('\n三 · 故障注入')
const duplicated = replay(inject(events, 'duplicate-callbacks'))
eq(duplicated.state_hash, base.state_hash, '重复回调不改变业务状态哈希')
eq(duplicated.metrics.exact_duplicate_events, 2, '重复回调被明确计数，不是静默吞掉')
const reordered = replay(inject(events, 'reordered-delivery'))
eq(reordered.state_hash, base.state_hash, '到达顺序打乱，完整事件集重放仍收敛')
const sourceRetry = JSON.parse(JSON.stringify(events))
const retriedFill = JSON.parse(JSON.stringify(sourceRetry.find((event) => event.event_id === 'evt-fill-1')))
retriedFill.event_id = 'evt-fill-1-local-retry'
sourceRetry.push(retriedFill)
const sourceDeduped = replay(sourceRetry)
eq(sourceDeduped.state_hash, base.state_hash, '本地 event_id 改变但上游 source sequence 相同，仍不重复记仓')
eq(sourceDeduped.metrics.source_duplicate_events, 1, '跨本地 ID 的上游重复被单独计数')
const stale = replay(inject(events, 'stale-market'))
ok(has(stale, 'UNSAFE_RISK_APPROVAL') && stale.metrics.stale_intents === 1, '过期行情仍被 APPROVE 会被抓住')
const ghost = replay(inject(events, 'ghost-order'))
ok(has(ghost, 'GHOST_ORDER') && ghost.metrics.ghost_orders === 1, '找不到 TradeIntent 的幽灵订单会被抓住')
const divergence = replay(inject(events, 'position-divergence'))
ok(has(divergence, 'POSITION_DIVERGENCE') && divergence.metrics.position_divergences === 1, '本地推导与券商快照分歧会被抓住')
const divergentDuplicate = replay(inject(events, 'divergent-duplicate'))
ok(has(divergentDuplicate, 'DIVERGENT_DUPLICATE') && divergentDuplicate.metrics.divergent_duplicate_events === 1, '同 event_id 不同内容全部隔离，不猜真值')
const partial = replay(inject(events, 'partial-unresolved'))
ok(has(partial, 'ACTUAL_POSITION_MISSING') && partial.metrics.unresolved_intents >= 1, '部分成交后崩溃不会伪装成闭合')

console.log('\n四 · 重启与动作语义')
const dir = mkdtempSync(join(tmpdir(), 'benxiang-quant-'))
try {
  const persisted = join(dir, 'events.jsonl')
  const cut = Math.floor(events.length / 2)
  writeFileSync(persisted, `${events.slice(0, cut).map(JSON.stringify).join('\n')}\n`, 'utf8')
  writeFileSync(persisted, `${events.slice(cut).map(JSON.stringify).join('\n')}\n`, { encoding: 'utf8', flag: 'a' })
  eq(replay(readEvents(persisted)).state_hash, base.state_hash, '进程中断后从追加日志全量重放，状态一致')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
eq(effectSemantics('ACKNOWLEDGED', 0), 'cancel_may_be_attempted', '已报订单只可尝试撤单')
eq(effectSemantics('CANCEL_REQUESTED', 200), 'compensatable_partial', '撤单请求期间已有成交，按部分补偿处理')
eq(effectSemantics('CANCELLED', 0), 'terminal_without_fill', '零成交撤单是无市场成交终态')

console.log('\n五 · 公开基准')
const bench = runBenchmark(events)
ok(bench.ok, '八个公开场景全部命中预先写好的判据')
eq(bench.scenarios.filter((x) => x.pass).length, 8, '场景数与通过数都由机器现算')

console.log(`\n合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`)
if (fail) process.exitCode = 1
else console.log('✓ Benxiang Quant Dialect v0.1-draft 自测通过')
