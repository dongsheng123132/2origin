#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const spec = JSON.parse(readFileSync(join(HERE, 'benchmark.json'), 'utf8'))
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const errors = []
const warnings = []
const ids = new Set()
const addId = (id, kind) => {
  if (!id) errors.push(`${kind} is missing id`)
  else if (ids.has(id)) errors.push(`duplicate id: ${id}`)
  else ids.add(id)
}
const finite = (n) => typeof n === 'number' && Number.isFinite(n)
const inRange = (n, duration) => finite(n) && n >= 0 && n <= duration

if (spec.schema_version !== 'benxiang-embodied-state/0.1') errors.push('unsupported schema_version')
if (spec.status !== 'pilot') warnings.push(`expected pilot status, got ${spec.status}`)

const sourceById = new Map()
for (const source of spec.sources ?? []) {
  addId(source.id, 'source')
  sourceById.set(source.id, source)
  if (!/^[a-f0-9]{64}$/.test(source.sha256 ?? '')) errors.push(`${source.id}: invalid sha256`)
  if (!finite(source.duration_s) || source.duration_s <= 0) errors.push(`${source.id}: invalid duration_s`)
  if (source.role !== 'truth_master') errors.push(`${source.id}: source must be truth_master`)
}

for (const scenario of spec.scenarios ?? []) {
  addId(scenario.id, 'scenario')
  const source = sourceById.get(scenario.source)
  if (!source) { errors.push(`${scenario.id}: unknown source ${scenario.source}`); continue }
  const duration = source.duration_s
  const tr = scenario.observation_transform ?? {}
  if (tr.kind === 'digital_occlusion') {
    if (!Array.isArray(tr.interval_s) || tr.interval_s.length !== 2 || !inRange(tr.interval_s[0], duration) || !inRange(tr.interval_s[1], duration) || tr.interval_s[0] >= tr.interval_s[1]) errors.push(`${scenario.id}: invalid occlusion interval`)
    if (!Array.isArray(tr.rect_px) || tr.rect_px.length !== 4 || tr.rect_px.some((n) => !Number.isInteger(n) || n < 0)) errors.push(`${scenario.id}: invalid rect_px`)
  } else if (tr.kind !== 'natural_occlusion_only') errors.push(`${scenario.id}: unsupported observation transform ${tr.kind}`)

  const eventIds = new Set()
  for (const event of scenario.truth_events ?? []) {
    addId(event.id, 'event')
    eventIds.add(event.id)
    if (finite(event.t_s) && !inRange(event.t_s, duration)) errors.push(`${event.id}: t_s outside source`)
    if (event.interval_s && (!Array.isArray(event.interval_s) || event.interval_s.length !== 2 || !inRange(event.interval_s[0], duration) || !inRange(event.interval_s[1], duration) || event.interval_s[0] >= event.interval_s[1])) errors.push(`${event.id}: invalid interval_s`)
    if (!event.evidence?.startsWith(`${source.id}#t=`)) errors.push(`${event.id}: evidence must reference its truth master`)
    if (!event.facts || Object.keys(event.facts).length === 0) errors.push(`${event.id}: facts are empty`)
  }

  for (const question of scenario.questions ?? []) {
    addId(question.id, 'question')
    if (!inRange(question.checkpoint_s, duration)) errors.push(`${question.id}: checkpoint outside source`)
    if (!Array.isArray(question.accepted_values) || question.accepted_values.length === 0) errors.push(`${question.id}: accepted_values missing`)
    if (!Array.isArray(question.accepted_epistemic) || question.accepted_epistemic.some((x) => !['observed', 'inferred', 'unknown'].includes(x))) errors.push(`${question.id}: invalid accepted_epistemic`)
    for (const eventId of question.acceptable_evidence_events ?? []) if (!eventIds.has(eventId)) errors.push(`${question.id}: unknown evidence event ${eventId}`)
  }
}

async function sha256(path) {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(path)) h.update(chunk)
  return h.digest('hex')
}

const sourceDir = arg('source-dir')
if (sourceDir) {
  for (const source of spec.sources) {
    const path = join(sourceDir, source.file)
    if (!existsSync(path)) { errors.push(`${source.id}: media missing at ${path}`); continue }
    const actual = await sha256(path)
    if (actual !== source.sha256) errors.push(`${source.id}: fingerprint mismatch for ${basename(path)}`)
  }
} else warnings.push('media fingerprints not checked; pass --source-dir <directory> for full verification')

console.log(`Benxiang embodied-state benchmark ${spec.benchmark_id}`)
console.log(`sources=${spec.sources.length} scenarios=${spec.scenarios.length} questions=${spec.scenarios.reduce((n, s) => n + s.questions.length, 0)}`)
for (const warning of warnings) console.log(`WARN ${warning}`)
for (const error of errors) console.error(`ERROR ${error}`)
if (errors.length) process.exit(1)
console.log('OK deterministic structure and evidence gates passed')
