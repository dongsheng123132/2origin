#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const spec = JSON.parse(readFileSync(join(HERE, 'benchmark.json'), 'utf8'))
const responsePath = process.argv[2]
if (!responsePath) { console.error('Usage: node score.mjs <response.json>'); process.exit(2) }
const response = JSON.parse(readFileSync(resolve(responsePath), 'utf8'))
const gold = new Map()
for (const scenario of spec.scenarios) for (const q of scenario.questions) gold.set(q.id, q)
const answerById = new Map((response.answers ?? []).map((a) => [a.question_id, a]))
const eventById = new Map()
for (const scenario of spec.scenarios) for (const event of scenario.truth_events) eventById.set(event.id, event)

function evidenceInterval(event) {
  const match = /#t=([0-9.]+),([0-9.]+)/.exec(event?.evidence ?? '')
  if (match) return [Number(match[1]), Number(match[2])]
  if (Array.isArray(event?.interval_s)) return event.interval_s
  if (Number.isFinite(event?.t_s)) return [event.t_s, event.t_s + 0.75]
  return null
}

function citationValid(citation, question) {
  if (typeof citation === 'string' && question.acceptable_evidence_events.includes(citation)) return true
  const second = Number(citation)
  if (!Number.isFinite(second)) return false
  return question.acceptable_evidence_events.some((id) => {
    const interval = evidenceInterval(eventById.get(id))
    return interval && second >= interval[0] && second <= interval[1]
  })
}

let valueCorrect = 0
let epistemicCorrect = 0
let hallucinations = 0
let evidenceRequired = 0
let evidenceSupplied = 0
let evidenceValid = 0
const rows = []

for (const [id, q] of gold) {
  const a = answerById.get(id) ?? {}
  const value = String(a.value ?? '').trim()
  const epistemic = String(a.epistemic ?? '').trim().toLowerCase()
  const vc = q.accepted_values.includes(value)
  const ec = q.accepted_epistemic.includes(epistemic)
  if (vc) valueCorrect++
  if (ec) epistemicCorrect++
  if (!vc && value && value !== 'UNKNOWN') hallucinations++
  evidenceRequired++
  const cited = Array.isArray(a.evidence_events)
    ? a.evidence_events
    : (Array.isArray(a.evidence_seconds) ? a.evidence_seconds : [])
  if (cited.length) evidenceSupplied++
  const validCites = cited.filter((x) => citationValid(x, q)).length
  evidenceValid += validCites
  rows.push({ question_id: id, value, epistemic, value_correct: vc, epistemic_correct: ec, evidence_valid: validCites, evidence_cited: cited.length })
}

const total = gold.size
const totalCites = rows.reduce((n, r) => n + r.evidence_cited, 0)
const report = {
  benchmark_id: spec.benchmark_id,
  system: response.system ?? 'unspecified',
  arm: response.arm ?? 'unspecified',
  questions: total,
  state_value_accuracy: valueCorrect / total,
  epistemic_status_accuracy: epistemicCorrect / total,
  hallucination_count: hallucinations,
  evidence_coverage: evidenceSupplied / evidenceRequired,
  evidence_precision: totalCites ? evidenceValid / totalCites : 0,
  rows
}
console.log(JSON.stringify(report, null, 2))
