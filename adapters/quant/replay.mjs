#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  DIALECT,
  TERMINAL_ORDER_STATUSES,
  canonical,
  digest,
  effectSemantics,
  quantLimits,
  validateEvent,
} from './dialect.mjs'

const clone = (value) => JSON.parse(JSON.stringify(value))
const errorCount = (issues) => issues.filter((x) => x.severity !== 'warning').length
const byId = (a, b) => String(a.event_id ?? '').localeCompare(String(b.event_id ?? ''), 'en')

const issue = (code, msg, details = {}, severity = 'error') => ({ severity, code, ...details, msg })

function deduplicate(events) {
  const groups = new Map()
  for (const event of events) {
    const key = typeof event?.event_id === 'string' && event.event_id ? event.event_id : `__missing__:${digest(event)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(event)
  }
  const kept = []
  const issues = []
  let exactDuplicates = 0
  let divergentDuplicates = 0
  for (const [eventId, group] of [...groups].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const variants = new Map(group.map((event) => [canonical(event), event]))
    exactDuplicates += group.length - variants.size
    if (variants.size > 1 && !eventId.startsWith('__missing__:')) {
      divergentDuplicates += variants.size - 1
      issues.push(issue('DIVERGENT_DUPLICATE', `同一 event_id=${eventId} 出现 ${variants.size} 个不同内容；全部隔离，不猜哪一个是真的`, { event_id: eventId }))
      continue
    }
    kept.push(clone([...variants.values()][0]))
  }
  // event_id 可能由本地 Recorder 生成；同一上游回调若重连后换了本地 ID，仍不能再执行一次。
  // 第二层用 source system/stream/sequence 去重。坐标相同而内容不同同样全部隔离。
  const sourceGroups = new Map()
  const withoutSourceCoordinate = []
  for (const event of kept.sort(byId)) {
    const s = event?.source
    if (!s || typeof s.system !== 'string' || typeof s.stream !== 'string' || !Number.isInteger(s.sequence)) {
      withoutSourceCoordinate.push(event)
      continue
    }
    const key = `${s.system}\u0000${s.stream}\u0000${s.sequence}`
    if (!sourceGroups.has(key)) sourceGroups.set(key, [])
    sourceGroups.get(key).push(event)
  }
  const sourceKept = [...withoutSourceCoordinate]
  let sourceDuplicates = 0
  for (const [coordinate, group] of [...sourceGroups].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const variants = new Map(group.map((event) => {
      const comparable = clone(event)
      delete comparable.event_id
      return [canonical(comparable), event]
    }))
    if (variants.size > 1) {
      divergentDuplicates += variants.size - 1
      issues.push(issue('SOURCE_SEQUENCE_CONFLICT', `同一 source coordinate=${JSON.stringify(coordinate.split('\u0000'))} 出现不同内容；全部隔离`, { source_coordinate: coordinate.replaceAll('\u0000', '/') }))
      continue
    }
    sourceDuplicates += group.length - 1
    sourceKept.push(group.sort(byId)[0])
  }
  exactDuplicates += sourceDuplicates
  return { kept: sourceKept.sort(byId), issues, exactDuplicates, sourceDuplicates, divergentDuplicates }
}

function uniqueEntities(events, kind, keyField, issues) {
  const groups = new Map()
  for (const event of events.filter((x) => x.kind === kind)) {
    const key = event.payload[keyField]
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(event)
  }
  const out = new Map()
  for (const [key, group] of [...groups].sort(([a], [b]) => String(a).localeCompare(String(b), 'en'))) {
    const variants = new Map(group.map((event) => [canonical(event.payload), event]))
    if (variants.size > 1) {
      issues.push(issue('ENTITY_CONFLICT', `${kind} 的业务 ID ${key} 有互相冲突的内容；该实体被隔离`, { entity_id: key }))
      continue
    }
    out.set(key, clone(group[0]))
  }
  return out
}

function minimumGate(intentEvent, markets, portfolios) {
  const p = intentEvent.payload
  if (p.mode === 'live') return { decision: 'REQUIRE_HUMAN', reason: 'LIVE_DISABLED_IN_DRAFT' }
  const market = markets.get(p.market_snapshot_ref)
  if (!market) return { decision: 'STATE_CONFLICT', reason: 'MARKET_SNAPSHOT_MISSING' }
  const portfolio = portfolios.get(p.portfolio_ref?.snapshot_id)
  if (!portfolio || portfolio.payload.version !== p.portfolio_ref?.version) return { decision: 'STATE_CONFLICT', reason: 'PORTFOLIO_VERSION_MISMATCH' }
  const at = Date.parse(intentEvent.occurred_at)
  if (at > Date.parse(p.expires_at) || at > Date.parse(market.payload.expires_at)) return { decision: 'EXPIRED', reason: 'STALE_MARKET_OR_INTENT' }
  if (market.payload.symbol !== p.symbol) return { decision: 'STATE_CONFLICT', reason: 'MARKET_SYMBOL_MISMATCH' }
  return { decision: 'APPROVE', reason: 'MINIMUM_GATES_PASSED' }
}

function buildOrders(events, intents, riskByIntent, fillsByOrder, issues) {
  const grouped = new Map()
  for (const event of events.filter((x) => x.kind === 'order.event')) {
    const id = event.payload.order_id
    if (!grouped.has(id)) grouped.set(id, [])
    grouped.get(id).push(event)
  }
  const orders = []
  for (const [orderId, historyRaw] of [...grouped].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const history = historyRaw.sort((a, b) => a.payload.broker_sequence - b.payload.broker_sequence || byId(a, b))
    const identity = new Set(history.map((x) => x.payload.intent_id))
    if (identity.size > 1) issues.push(issue('ORDER_IDENTITY_CONFLICT', `订单 ${orderId} 的 intent_id 发生变化`, { order_id: orderId }))
    const intentId = [...identity][0]
    const intent = intents.get(intentId)
    if (!intent) issues.push(issue('GHOST_ORDER', `订单 ${orderId} 找不到 TradeIntent ${intentId}`, { order_id: orderId, intent_id: intentId }))
    const risk = riskByIntent.get(intentId)
    if (!risk || risk.payload.decision !== 'APPROVE') issues.push(issue('ORDER_WITHOUT_APPROVAL', `订单 ${orderId} 没有可追溯的 APPROVE`, { order_id: orderId, intent_id: intentId }))

    let previous = null
    let previousSequence = null
    let previousFilled = 0
    for (const event of history) {
      const p = event.payload
      if (p.broker_sequence === previousSequence) issues.push(issue('BROKER_SEQUENCE_CONFLICT', `订单 ${orderId} 重复 broker_sequence=${p.broker_sequence}`, { order_id: orderId, event_id: event.event_id }))
      if (previous && TERMINAL_ORDER_STATUSES.has(previous) && p.status !== previous) issues.push(issue('ORDER_AFTER_TERMINAL', `订单 ${orderId} 已到终态 ${previous}，之后又出现 ${p.status}`, { order_id: orderId, event_id: event.event_id }))
      if (p.cumulative_filled_quantity < previousFilled) issues.push(issue('CUMULATIVE_FILL_DECREASED', `订单 ${orderId} 累计成交量从 ${previousFilled} 降到 ${p.cumulative_filled_quantity}`, { order_id: orderId, event_id: event.event_id }))
      previous = p.status
      previousSequence = p.broker_sequence
      previousFilled = p.cumulative_filled_quantity
    }
    const quantity = intent?.payload.quantity ?? null
    if (quantity !== null && previousFilled > quantity) issues.push(issue('OVERFILL', `订单 ${orderId} 累计成交 ${previousFilled} 超过意图数量 ${quantity}`, { order_id: orderId }))
    if (previous === 'FILLED' && quantity !== null && previousFilled !== quantity) issues.push(issue('FILLED_QUANTITY_MISMATCH', `订单 ${orderId} 标记 FILLED，但累计成交 ${previousFilled} != ${quantity}`, { order_id: orderId }))
    const fillTotal = (fillsByOrder.get(orderId) ?? []).reduce((sum, fill) => sum + fill.payload.quantity, 0)
    if (fillTotal !== previousFilled) issues.push(issue('FILL_TOTAL_MISMATCH', `订单 ${orderId} 的成交回报合计 ${fillTotal} != 委托累计成交 ${previousFilled}`, { order_id: orderId }))
    orders.push({
      order_id: orderId,
      intent_id: intentId,
      status: previous,
      cumulative_filled_quantity: previousFilled,
      fill_total: fillTotal,
      terminal: TERMINAL_ORDER_STATUSES.has(previous),
      effect_semantics: effectSemantics(previous, previousFilled),
      history: history.map((event) => ({
        event_id: event.event_id,
        broker_sequence: event.payload.broker_sequence,
        status: event.payload.status,
        cumulative_filled_quantity: event.payload.cumulative_filled_quantity,
      })),
    })
  }
  return orders
}

const sortIssues = (issues) => issues.sort((a, b) =>
  a.code.localeCompare(b.code, 'en')
  || String(a.event_id ?? a.order_id ?? a.intent_id ?? a.entity_id ?? '').localeCompare(String(b.event_id ?? b.order_id ?? b.intent_id ?? b.entity_id ?? ''), 'en')
  || a.msg.localeCompare(b.msg, 'zh-CN'))

/**
 * 从任意到达顺序的完整事件集合重建状态。列表顺序不是事实；source sequence、业务 ID 与引用才是。
 */
export function replay(inputEvents) {
  if (!Array.isArray(inputEvents)) throw new TypeError('events 必须是数组')
  const dedup = deduplicate(inputEvents)
  const issues = [...dedup.issues]
  const valid = []
  for (const event of dedup.kept) {
    const eventIssues = validateEvent(event)
    issues.push(...eventIssues)
    if (errorCount(eventIssues) === 0) valid.push(event)
  }

  const markets = uniqueEntities(valid, 'market.snapshot', 'snapshot_id', issues)
  const portfolios = uniqueEntities(valid, 'portfolio.snapshot', 'snapshot_id', issues)
  const intents = uniqueEntities(valid, 'trade.intent', 'intent_id', issues)
  const riskByIntent = uniqueEntities(valid, 'risk.decision', 'intent_id', issues)
  const fills = uniqueEntities(valid, 'fill.event', 'fill_id', issues)
  const fillsByOrder = new Map()
  for (const fill of fills.values()) {
    const id = fill.payload.order_id
    if (!fillsByOrder.has(id)) fillsByOrder.set(id, [])
    fillsByOrder.get(id).push(fill)
  }
  for (const list of fillsByOrder.values()) list.sort((a, b) => a.payload.broker_sequence - b.payload.broker_sequence || byId(a, b))

  const gateByIntent = new Map()
  for (const [intentId, decision] of riskByIntent) {
    if (!intents.has(intentId)) issues.push(issue('ORPHAN_RISK_DECISION', `risk.decision ${decision.event_id} 找不到 TradeIntent ${intentId}`, { event_id: decision.event_id, intent_id: intentId }))
  }
  for (const [intentId, intent] of intents) {
    const gate = minimumGate(intent, markets, portfolios)
    gateByIntent.set(intentId, gate)
    const recorded = riskByIntent.get(intentId)
    if (!recorded) issues.push(issue('RISK_DECISION_MISSING', `TradeIntent ${intentId} 没有 risk.decision`, { intent_id: intentId }))
    // 确定性最小闸门只规定「绝不能放行」；更严格的 REJECT / REQUIRE_HUMAN 是允许的。
    else if (gate.decision !== 'APPROVE' && recorded.payload.decision === 'APPROVE') {
      issues.push(issue('UNSAFE_RISK_APPROVAL', `TradeIntent ${intentId} 最小闸门应为 ${gate.decision}/${gate.reason}，记录却是 APPROVE`, { intent_id: intentId }))
    }
  }

  const orders = buildOrders(valid, intents, riskByIntent, fillsByOrder, issues)
  const orderMap = new Map(orders.map((order) => [order.order_id, order]))
  for (const fill of fills.values()) {
    const p = fill.payload
    const order = orderMap.get(p.order_id)
    if (!order) issues.push(issue('ORPHAN_FILL', `成交 ${p.fill_id} 找不到订单 ${p.order_id}`, { event_id: fill.event_id, order_id: p.order_id, intent_id: p.intent_id }))
    else if (order.intent_id !== p.intent_id) issues.push(issue('FILL_LINK_MISMATCH', `成交 ${p.fill_id} 的 intent_id 与订单不一致`, { event_id: fill.event_id, order_id: p.order_id }))
    const intent = intents.get(p.intent_id)
    if (intent && (intent.payload.symbol !== p.symbol || intent.payload.side !== p.side)) issues.push(issue('FILL_IDENTITY_MISMATCH', `成交 ${p.fill_id} 的 symbol/side 与 TradeIntent 不一致`, { event_id: fill.event_id, intent_id: p.intent_id }))
  }

  const baselineCandidates = [...portfolios.values()].filter((x) => x.payload.role === 'baseline').sort((a, b) => a.payload.version - b.payload.version || byId(a, b))
  const actualCandidates = [...portfolios.values()].filter((x) => x.payload.role === 'actual').sort((a, b) => b.payload.version - a.payload.version || byId(a, b))
  const baseline = baselineCandidates[0] ?? null
  const actual = actualCandidates[0] ?? null
  const expectedPositions = clone(baseline?.payload.positions ?? {})
  for (const fill of [...fills.values()].sort((a, b) => a.payload.broker_sequence - b.payload.broker_sequence || byId(a, b))) {
    const p = fill.payload
    if (!orderMap.has(p.order_id) || !intents.has(p.intent_id)) continue
    expectedPositions[p.symbol] = (expectedPositions[p.symbol] ?? 0) + (p.side === 'BUY' ? p.quantity : -p.quantity)
  }
  const actualPositions = clone(actual?.payload.positions ?? {})
  const symbols = [...new Set([...Object.keys(expectedPositions), ...Object.keys(actualPositions)])].sort()
  const divergences = symbols.flatMap((symbol) => {
    const expected = expectedPositions[symbol] ?? 0
    const observed = actualPositions[symbol] ?? 0
    return expected === observed ? [] : [{ symbol, expected, actual: observed, delta: observed - expected }]
  })
  if (!actual) issues.push(issue('ACTUAL_POSITION_MISSING', '缺少 role=actual 的账户持仓快照，无法闭合对账'))
  for (const d of divergences) issues.push(issue('POSITION_DIVERGENCE', `${d.symbol} 预期 ${d.expected}，券商快照 ${d.actual}，差 ${d.delta}`, { symbol: d.symbol }))

  const ordersByIntent = new Map()
  for (const order of orders) {
    if (!ordersByIntent.has(order.intent_id)) ordersByIntent.set(order.intent_id, [])
    ordersByIntent.get(order.intent_id).push(order)
  }
  const intentStates = [...intents.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([intentId, event]) => {
    const recorded = riskByIntent.get(intentId)?.payload.decision ?? null
    const linked = ordersByIntent.get(intentId) ?? []
    const closedByRisk = ['REJECT', 'EXPIRED', 'STATE_CONFLICT'].includes(recorded)
    const closedByOrders = recorded === 'APPROVE' && linked.length > 0 && linked.every((order) => order.terminal)
    const status = closedByRisk || closedByOrders ? 'CLOSED' : 'UNRESOLVED'
    if (status === 'UNRESOLVED') issues.push(issue('INTENT_UNRESOLVED', `TradeIntent ${intentId} 未到可核验终态`, { intent_id: intentId }, 'warning'))
    return {
      intent_id: intentId,
      strategy_ref: event.payload.strategy_ref,
      symbol: event.payload.symbol,
      side: event.payload.side,
      quantity: event.payload.quantity,
      mode: event.payload.mode,
      minimum_gate: gateByIntent.get(intentId),
      recorded_decision: recorded,
      order_ids: linked.map((order) => order.order_id).sort(),
      status,
    }
  })

  const state = {
    dialect: `${DIALECT.name}@${DIALECT.version}`,
    market_snapshots: [...markets.values()].map((x) => clone(x.payload)).sort((a, b) => a.snapshot_id.localeCompare(b.snapshot_id, 'en')),
    portfolio: {
      baseline_ref: baseline?.payload.snapshot_id ?? null,
      actual_ref: actual?.payload.snapshot_id ?? null,
      expected_positions: expectedPositions,
      actual_positions: actualPositions,
      divergences,
    },
    intents: intentStates,
    orders,
    fills: [...fills.values()].map((x) => clone(x.payload)).sort((a, b) => a.fill_id.localeCompare(b.fill_id, 'en')),
  }
  const sortedIssues = sortIssues(issues)
  const closed = intentStates.filter((x) => x.status === 'CLOSED').length
  const metrics = {
    input_events: inputEvents.length,
    accepted_events: valid.length,
    exact_duplicate_events: dedup.exactDuplicates,
    source_duplicate_events: dedup.sourceDuplicates,
    divergent_duplicate_events: dedup.divergentDuplicates,
    intents: intentStates.length,
    closed_intents: closed,
    unresolved_intents: intentStates.length - closed,
    closure_rate: intentStates.length ? closed / intentStates.length : null,
    ghost_orders: sortedIssues.filter((x) => x.code === 'GHOST_ORDER').length,
    orphan_fills: sortedIssues.filter((x) => x.code === 'ORPHAN_FILL').length,
    stale_intents: [...gateByIntent.values()].filter((x) => x.reason === 'STALE_MARKET_OR_INTENT').length,
    unsafe_risk_approvals: sortedIssues.filter((x) => x.code === 'UNSAFE_RISK_APPROVAL').length,
    position_divergences: divergences.length,
    errors: errorCount(sortedIssues),
    warnings: sortedIssues.filter((x) => x.severity === 'warning').length,
  }
  return { state_hash: digest(state), state, metrics, issues: sortedIssues, limits: quantLimits() }
}

export function readEvents(file) {
  return readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line) } catch (error) { throw new Error(`${file}:${index + 1} 不是合法 JSON：${error.message}`) }
  })
}

export const replayFile = (file) => replay(readEvents(file))

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  try {
    if (!process.argv[2]) throw new Error('用法：node adapters/quant/replay.mjs <events.jsonl>')
    process.stdout.write(`${JSON.stringify(replayFile(resolve(process.argv[2])), null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`)
    process.exitCode = 1
  }
}
