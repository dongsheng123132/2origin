#!/usr/bin/env node

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inject, SCENARIOS } from './fault-inject.mjs'
import { readEvents, replay } from './replay.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_FIXTURE = join(HERE, 'fixtures', 'synthetic-day', 'events.jsonl')

const has = (report, code) => report.issues.some((x) => x.code === code)

const ORACLES = Object.freeze({
  baseline: (r) => r.metrics.errors === 0 && r.metrics.closure_rate === 1 && r.metrics.position_divergences === 0,
  'duplicate-callbacks': (r, base) => r.state_hash === base.state_hash && r.metrics.exact_duplicate_events === 2,
  'reordered-delivery': (r, base) => r.state_hash === base.state_hash && r.metrics.errors === base.metrics.errors,
  'stale-market': (r) => r.metrics.stale_intents === 1 && r.metrics.unsafe_risk_approvals === 1 && has(r, 'UNSAFE_RISK_APPROVAL'),
  'ghost-order': (r) => r.metrics.ghost_orders === 1 && has(r, 'GHOST_ORDER') && has(r, 'ORPHAN_RISK_DECISION'),
  'position-divergence': (r) => r.metrics.position_divergences === 1 && has(r, 'POSITION_DIVERGENCE'),
  'divergent-duplicate': (r) => r.metrics.divergent_duplicate_events === 1 && has(r, 'DIVERGENT_DUPLICATE'),
  'partial-unresolved': (r) => r.metrics.unresolved_intents >= 1 && has(r, 'ACTUAL_POSITION_MISSING'),
})

export function runBenchmark(events) {
  const base = replay(inject(events, 'baseline'))
  const scenarios = SCENARIOS.map((scenario) => {
    const report = scenario === 'baseline' ? base : replay(inject(events, scenario))
    return {
      scenario,
      pass: ORACLES[scenario](report, base),
      state_hash: report.state_hash,
      metrics: report.metrics,
      issue_codes: [...new Set(report.issues.map((x) => x.code))].sort(),
    }
  })
  return { ok: scenarios.every((x) => x.pass), dialect: base.state.dialect, scenarios }
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  try {
    const result = runBenchmark(readEvents(resolve(process.argv[2] ?? DEFAULT_FIXTURE)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (!result.ok) process.exitCode = 1
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`)
    process.exitCode = 1
  }
}
