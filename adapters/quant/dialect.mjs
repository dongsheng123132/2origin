// Benxiang Quant Dialect v0.1-draft
//
// 它表示的是「交易系统当时知道什么、决定了什么、实际发生了什么」，不是价格预测模型。
// 模型只能产生 trade.intent；risk.decision 与 broker/account 事件来自确定性系统。

import { createHash } from 'node:crypto'
import { limit } from '../../compiler/limits.mjs'

export const DIALECT = Object.freeze({
  name: 'benxiang.quant',
  version: '0.1-draft',
  object: 'instrument, portfolio snapshot, trade intent, order, fill and risk decision',
  reference: 'source fingerprint plus event time, receive time, sequence, watermark and state version',
  projection: 'replayable order ledger, expected position, broker position and reconciliation report',
  transaction: 'a model may submit TradeIntent; only a deterministic gate may authorize execution',
  validation: 'shape, reference, freshness, state-version, idempotency, lifecycle and reconciliation gates',
})

export const EVENT_KINDS = Object.freeze([
  'market.snapshot',
  'portfolio.snapshot',
  'trade.intent',
  'risk.decision',
  'order.event',
  'fill.event',
])

export const ORDER_STATUSES = Object.freeze([
  'SUBMITTED',
  'ACKNOWLEDGED',
  'PARTIALLY_FILLED',
  'CANCEL_REQUESTED',
  'FILLED',
  'CANCELLED',
  'REJECTED',
])

export const TERMINAL_ORDER_STATUSES = new Set(['FILLED', 'CANCELLED', 'REJECTED'])
export const RISK_DECISIONS = Object.freeze([
  'APPROVE',
  'REJECT',
  'REQUIRE_HUMAN',
  'EXPIRED',
  'STATE_CONFLICT',
])

export const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex')

const issue = (code, msg, severity = 'error', eventId = null) => ({
  severity,
  code,
  ...(eventId ? { event_id: eventId } : {}),
  msg,
})

const validDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0
const positiveInteger = (value) => Number.isInteger(value) && value > 0
const nonNegativeInteger = (value) => Number.isInteger(value) && value >= 0

const REQUIRED_PAYLOAD = Object.freeze({
  'market.snapshot': ['snapshot_id', 'symbol', 'price', 'expires_at'],
  'portfolio.snapshot': ['snapshot_id', 'version', 'role', 'positions'],
  'trade.intent': ['intent_id', 'strategy_ref', 'market_snapshot_ref', 'portfolio_ref', 'symbol', 'side', 'quantity', 'expires_at', 'mode'],
  'risk.decision': ['intent_id', 'decision'],
  'order.event': ['order_id', 'intent_id', 'status', 'broker_sequence', 'cumulative_filled_quantity'],
  'fill.event': ['fill_id', 'order_id', 'intent_id', 'symbol', 'side', 'quantity', 'price', 'broker_sequence'],
})

/**
 * 事件形状校验。JSON Schema 是公开契约；这里是零依赖、可执行的同口径闸门。
 */
export function validateEvent(event) {
  const out = []
  const id = event?.event_id ?? null
  if (!event || typeof event !== 'object' || Array.isArray(event)) return [issue('EVENT_NOT_OBJECT', '事件必须是对象')]
  if (!nonEmpty(id)) out.push(issue('EVENT_ID_REQUIRED', '缺少非空 event_id'))
  if (!EVENT_KINDS.includes(event.kind)) out.push(issue('EVENT_KIND_UNKNOWN', `未知 kind=${JSON.stringify(event.kind)}`, 'error', id))
  if (!validDate(event.occurred_at)) out.push(issue('OCCURRED_AT_INVALID', 'occurred_at 必须是 ISO 时间', 'error', id))
  if (!validDate(event.received_at)) out.push(issue('RECEIVED_AT_INVALID', 'received_at 必须是 ISO 时间', 'error', id))
  if (validDate(event.occurred_at) && validDate(event.received_at) && Date.parse(event.received_at) < Date.parse(event.occurred_at)) {
    out.push(issue('CLOCK_INVERSION', 'received_at 早于 occurred_at；保留事件但要求检查时钟', 'warning', id))
  }
  if (!event.source || typeof event.source !== 'object') out.push(issue('SOURCE_REQUIRED', '缺少 source', 'error', id))
  else {
    if (!nonEmpty(event.source.system)) out.push(issue('SOURCE_SYSTEM_REQUIRED', 'source.system 不能为空', 'error', id))
    if (!nonEmpty(event.source.stream)) out.push(issue('SOURCE_STREAM_REQUIRED', 'source.stream 不能为空', 'error', id))
    if (!positiveInteger(event.source.sequence)) out.push(issue('SOURCE_SEQUENCE_INVALID', 'source.sequence 必须是正整数', 'error', id))
  }
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    out.push(issue('PAYLOAD_REQUIRED', 'payload 必须是对象', 'error', id))
    return out
  }

  for (const field of REQUIRED_PAYLOAD[event.kind] ?? []) {
    if (!(field in event.payload)) out.push(issue('PAYLOAD_FIELD_REQUIRED', `${event.kind} 缺少 payload.${field}`, 'error', id))
  }

  const p = event.payload
  if (event.kind === 'market.snapshot') {
    if (!(typeof p.price === 'number' && p.price > 0)) out.push(issue('MARKET_PRICE_INVALID', 'price 必须大于 0', 'error', id))
    if (!validDate(p.expires_at)) out.push(issue('MARKET_EXPIRY_INVALID', 'expires_at 必须是 ISO 时间', 'error', id))
  }
  if (event.kind === 'portfolio.snapshot') {
    if (!nonNegativeInteger(p.version)) out.push(issue('PORTFOLIO_VERSION_INVALID', 'version 必须是非负整数', 'error', id))
    if (!['baseline', 'actual'].includes(p.role)) out.push(issue('PORTFOLIO_ROLE_INVALID', 'role 只能是 baseline / actual', 'error', id))
    if (!p.positions || typeof p.positions !== 'object' || Array.isArray(p.positions)) out.push(issue('POSITIONS_INVALID', 'positions 必须是 symbol → quantity 对象', 'error', id))
    else if (Object.values(p.positions).some((quantity) => !Number.isFinite(quantity))) out.push(issue('POSITION_QUANTITY_INVALID', '持仓数量必须是有限数值', 'error', id))
  }
  if (event.kind === 'trade.intent') {
    if (!['BUY', 'SELL'].includes(p.side)) out.push(issue('INTENT_SIDE_INVALID', 'side 只能是 BUY / SELL', 'error', id))
    if (!positiveInteger(p.quantity)) out.push(issue('INTENT_QUANTITY_INVALID', 'quantity 必须是正整数', 'error', id))
    if (!['replay', 'paper', 'live'].includes(p.mode)) out.push(issue('INTENT_MODE_INVALID', 'mode 只能是 replay / paper / live', 'error', id))
    if (!validDate(p.expires_at)) out.push(issue('INTENT_EXPIRY_INVALID', 'intent expires_at 必须是 ISO 时间', 'error', id))
    if (!p.portfolio_ref || typeof p.portfolio_ref !== 'object' || !nonEmpty(p.portfolio_ref.snapshot_id) || !nonNegativeInteger(p.portfolio_ref.version)) {
      out.push(issue('PORTFOLIO_REF_INVALID', 'portfolio_ref 必须含 snapshot_id 与非负 version', 'error', id))
    }
  }
  if (event.kind === 'risk.decision' && !RISK_DECISIONS.includes(p.decision)) out.push(issue('RISK_DECISION_INVALID', `未知 decision=${JSON.stringify(p.decision)}`, 'error', id))
  if (event.kind === 'order.event') {
    if (!ORDER_STATUSES.includes(p.status)) out.push(issue('ORDER_STATUS_INVALID', `未知 status=${JSON.stringify(p.status)}`, 'error', id))
    if (!positiveInteger(p.broker_sequence)) out.push(issue('BROKER_SEQUENCE_INVALID', 'broker_sequence 必须是正整数', 'error', id))
    if (!nonNegativeInteger(p.cumulative_filled_quantity)) out.push(issue('CUMULATIVE_FILL_INVALID', 'cumulative_filled_quantity 必须是非负整数', 'error', id))
  }
  if (event.kind === 'fill.event') {
    if (!['BUY', 'SELL'].includes(p.side)) out.push(issue('FILL_SIDE_INVALID', 'fill side 只能是 BUY / SELL', 'error', id))
    if (!positiveInteger(p.quantity)) out.push(issue('FILL_QUANTITY_INVALID', 'fill quantity 必须是正整数', 'error', id))
    if (!(typeof p.price === 'number' && p.price > 0)) out.push(issue('FILL_PRICE_INVALID', 'fill price 必须大于 0', 'error', id))
    if (!positiveInteger(p.broker_sequence)) out.push(issue('BROKER_SEQUENCE_INVALID', 'broker_sequence 必须是正整数', 'error', id))
  }
  return out
}

/** 交易不是文件编辑：撤单只是请求，成交后只能用新交易补偿，不能回滚历史成交。 */
export function effectSemantics(status, filledQuantity = 0) {
  if (status === 'FILLED') return 'compensatable'
  if (filledQuantity > 0) return 'compensatable_partial'
  if (['SUBMITTED', 'ACKNOWLEDGED', 'CANCEL_REQUESTED', 'PARTIALLY_FILLED'].includes(status)) return 'cancel_may_be_attempted'
  return 'terminal_without_fill'
}

export const quantLimits = () => [
  limit('quant-no-alpha-claim', 'undetectable', 'strategy.performance',
    '本方言不判断策略是否赚钱，也不生成买卖建议；合成交易日只有状态真值，没有市场 Alpha。',
    '收益研究必须另建带 point-in-time 数据、成本、基线和预注册判据的实验。'),
  limit('quant-synthetic-only', 'unverified', 'benchmark.external-validity',
    'v0.1-draft 只在合成事件上验过，尚未证明能覆盖任一券商或交易所的全部回报语义。',
    '由券商接口工程师提供脱敏事件夹具，并逐字段映射后重跑同一判据。'),
  limit('quant-no-broker-adapter', 'uncovered', 'execution.live',
    '当前没有 QMT 或其他券商写适配器；仓库中不存在可触发真实报单的代码。',
    '先实现只读 Recorder，经脱敏回放验证后再单独评审写通道。'),
  limit('quant-cancel-not-rollback', 'degraded', 'order.cancel',
    'CANCEL_REQUESTED 不代表撤单成功；请求与确认之间仍可能成交，已成交部分不可回滚。',
    '持续接收委托与成交回报，以券商终态和账户对账为准；反向交易只能记为补偿事务。'),
  limit('quant-not-compliance-certification', 'unverified', 'regulatory.compliance',
    '通过本方言校验不代表满足程序化交易报告、券商准入或交易所规则。',
    '任何实盘前由账户所属券商和合规人员确认适用义务，并把批准凭据作为外部前置条件。'),
  limit('quant-position-model-narrow', 'uncovered', 'portfolio.reconciliation',
    'v0.1 只按单一账户的 baseline 持仓加减成交数量；未建模费用、分红、拆并股、ETF 申赎、转托管、期权行权、期货结算与资金划转。',
    '真实券商夹具先把每类非成交持仓变化登记成独立事件，再扩展多账户和现金对账。'),
]
