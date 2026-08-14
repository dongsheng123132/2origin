const clone = (value) => JSON.parse(JSON.stringify(value))

const find = (events, eventId) => events.find((event) => event.event_id === eventId)

export const SCENARIOS = Object.freeze([
  'baseline',
  'duplicate-callbacks',
  'reordered-delivery',
  'stale-market',
  'ghost-order',
  'position-divergence',
  'divergent-duplicate',
  'partial-unresolved',
])

/** 只改输入事件，不给重放器任何场景暗示。 */
export function inject(events, scenario) {
  const out = clone(events)
  if (scenario === 'baseline') return out
  if (scenario === 'duplicate-callbacks') {
    out.splice(7, 0, clone(find(out, 'evt-fill-1')), clone(find(out, 'evt-order-partial')))
    return out
  }
  if (scenario === 'reordered-delivery') {
    return [...out.filter((_, i) => i % 2), ...out.filter((_, i) => i % 2 === 0)].reverse()
  }
  if (scenario === 'stale-market') {
    const intent = find(out, 'evt-intent-buy')
    intent.occurred_at = '2026-08-14T09:31:05.000+08:00'
    intent.received_at = '2026-08-14T09:31:05.100+08:00'
    return out
  }
  if (scenario === 'ghost-order') return out.filter((event) => event.event_id !== 'evt-intent-buy')
  if (scenario === 'position-divergence') {
    find(out, 'evt-portfolio-actual').payload.positions['510300.SH'] = 1490
    return out
  }
  if (scenario === 'divergent-duplicate') {
    const bad = clone(find(out, 'evt-fill-1'))
    bad.payload.quantity = 999
    out.push(bad)
    return out
  }
  if (scenario === 'partial-unresolved') {
    return out.filter((event) => !['evt-fill-2', 'evt-order-filled', 'evt-portfolio-actual'].includes(event.event_id))
  }
  throw new Error(`未知故障场景 ${scenario}；可选：${SCENARIOS.join(', ')}`)
}
