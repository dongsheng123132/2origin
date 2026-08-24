import { EVENT_CONTRACT, EVENT_TYPES, OBJECT_ATTRIBUTE_FIELDS } from './dialect.mjs'

const SHA256 = /^[a-f0-9]{64}$/i
const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const clone = (v) => structuredClone(v)

export class EmbodiedValidationError extends Error {
  constructor(findings) {
    super(findings.map((f) => `${f.code}: ${f.message}`).join('\n'))
    this.name = 'EmbodiedValidationError'
    this.findings = findings
  }
}

function refObjects(event) {
  const p = event.payload ?? {}
  if (event.type === 'identity_distinct') return Array.isArray(p.objects) ? p.objects : []
  return [p.object, p.container].filter(Boolean)
}

function validatePayload(event, objectIds, places) {
  const findings = []
  const payload = event.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return [{ severity: 'error', code: 'payload-missing', event: event.event_id, message: 'payload must be an object' }]
  }
  for (const field of EVENT_CONTRACT[event.type] ?? []) {
    if (!(field in payload)) findings.push({ severity: 'error', code: 'payload-field-missing', event: event.event_id, message: `${event.type}.${field} is required` })
  }
  for (const id of refObjects(event)) {
    if (!objectIds.has(id)) findings.push({ severity: 'error', code: 'unknown-object', event: event.event_id, message: `unknown persistent object ${id}` })
  }
  if (event.type === 'object_observed') {
    const attrs = payload.attributes
    if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs) || Object.keys(attrs).length === 0) {
      findings.push({ severity: 'error', code: 'attributes-missing', event: event.event_id, message: 'object_observed.attributes must be a non-empty object' })
    } else {
      for (const [field, value] of Object.entries(attrs)) {
        if (!OBJECT_ATTRIBUTE_FIELDS.includes(field)) findings.push({ severity: 'error', code: 'attribute-unsupported', event: event.event_id, message: `unsupported observed attribute ${field}` })
        if (field === 'exists' && typeof value !== 'boolean') findings.push({ severity: 'error', code: 'attribute-domain', event: event.event_id, message: 'exists must be boolean' })
        if (field === 'location' && !places.has(value)) findings.push({ severity: 'error', code: 'attribute-domain', event: event.event_id, message: `unknown place ${value}` })
      }
    }
  }
  if (event.type === 'identity_distinct') {
    const ids = payload.objects
    if (!Array.isArray(ids) || ids.length !== 2 || ids[0] === ids[1]) findings.push({ severity: 'error', code: 'identity-pair-invalid', event: event.event_id, message: 'identity_distinct requires two different persistent object IDs' })
  }
  if (event.type === 'put_inside' && payload.object === payload.container) findings.push({ severity: 'error', code: 'self-containment', event: event.event_id, message: 'an object cannot contain itself' })
  if (event.type === 'removed_from' && !places.has(payload.location)) findings.push({ severity: 'error', code: 'attribute-domain', event: event.event_id, message: `unknown removal location ${payload.location}` })
  return findings
}

/** Validate an append-only event log without consulting benchmark answers. */
export function validateEvents({ objects = [], places = [], sources = [], events = [] }) {
  const findings = []
  const objectIds = new Set()
  for (const object of objects) {
    const id = typeof object === 'string' ? object : object?.id
    if (!EVENT_ID.test(id ?? '')) findings.push({ severity: 'error', code: 'object-id-invalid', object: id, message: 'persistent object ID is missing or unstable' })
    else if (objectIds.has(id)) findings.push({ severity: 'error', code: 'duplicate-object', object: id, message: `duplicate persistent object ${id}` })
    else objectIds.add(id)
  }
  const placeIds = new Set()
  for (const place of places) {
    const id = typeof place === 'string' ? place : place?.id
    if (!EVENT_ID.test(id ?? '')) findings.push({ severity: 'error', code: 'place-id-invalid', place: id, message: 'place ID is missing or unstable' })
    else if (placeIds.has(id)) findings.push({ severity: 'error', code: 'duplicate-place', place: id, message: `duplicate place ${id}` })
    else placeIds.add(id)
  }
  const sourceById = new Map()
  for (const source of sources) {
    if (!EVENT_ID.test(source?.id ?? '')) findings.push({ severity: 'error', code: 'source-id-invalid', source: source?.id, message: 'source ID is missing or unstable' })
    else if (sourceById.has(source.id)) findings.push({ severity: 'error', code: 'duplicate-source', source: source.id, message: `duplicate evidence source ${source.id}` })
    else sourceById.set(source.id, source)
    if (!SHA256.test(source?.sha256 ?? '')) findings.push({ severity: 'error', code: 'source-fingerprint-invalid', source: source?.id, message: 'source sha256 must contain 64 hex characters' })
    if (!isFiniteNumber(source?.duration_s) || source.duration_s <= 0) findings.push({ severity: 'error', code: 'source-duration-invalid', source: source?.id, message: 'source duration_s must be positive' })
  }
  const eventIds = new Set()
  let previousCommit = -Infinity

  for (const event of events) {
    const tag = event?.event_id ?? '(missing)'
    if (!EVENT_ID.test(tag)) findings.push({ severity: 'error', code: 'event-id-invalid', event: tag, message: 'event_id is missing or unstable' })
    else if (eventIds.has(tag)) findings.push({ severity: 'error', code: 'duplicate-event', event: tag, message: `duplicate event_id ${tag}` })
    else eventIds.add(tag)

    if (!EVENT_TYPES.includes(event?.type)) findings.push({ severity: 'error', code: 'event-type-unsupported', event: tag, message: `unsupported event type ${event?.type}` })
    if (!isFiniteNumber(event?.observed_at) || event.observed_at < 0) findings.push({ severity: 'error', code: 'observed-at-invalid', event: tag, message: 'observed_at must be a non-negative sensor time' })
    if (!isFiniteNumber(event?.valid_from) || event.valid_from < 0 || (isFiniteNumber(event?.observed_at) && event.valid_from > event.observed_at)) findings.push({ severity: 'error', code: 'valid-from-invalid', event: tag, message: 'valid_from must be non-negative and not after observed_at' })
    const committed = Date.parse(event?.committed_at)
    if (!Number.isFinite(committed)) findings.push({ severity: 'error', code: 'committed-at-invalid', event: tag, message: 'committed_at must be an ISO timestamp' })
    else {
      if (committed < previousCommit) findings.push({ severity: 'error', code: 'commit-order-invalid', event: tag, message: 'append log committed_at moved backwards' })
      previousCommit = committed
    }

    const evidence = event?.evidence
    const source = sourceById.get(evidence?.source_id)
    if (!source) findings.push({ severity: 'error', code: 'evidence-source-unknown', event: tag, message: `unknown evidence source ${evidence?.source_id}` })
    if (!SHA256.test(evidence?.sha256 ?? '')) findings.push({ severity: 'error', code: 'evidence-fingerprint-invalid', event: tag, message: 'evidence sha256 must contain 64 hex characters' })
    if (source && String(source.sha256).toLowerCase() !== String(evidence?.sha256).toLowerCase()) findings.push({ severity: 'error', code: 'evidence-fingerprint-mismatch', event: tag, message: 'evidence fingerprint does not match source registry' })
    const interval = evidence?.interval_s
    if (!Array.isArray(interval) || interval.length !== 2 || !interval.every(isFiniteNumber) || interval[0] < 0 || interval[0] > interval[1]) {
      findings.push({ severity: 'error', code: 'evidence-interval-invalid', event: tag, message: 'evidence.interval_s must be [start,end]' })
    } else {
      if (source && isFiniteNumber(source.duration_s) && interval[1] > source.duration_s) findings.push({ severity: 'error', code: 'evidence-outside-source', event: tag, message: 'evidence interval exceeds source duration' })
      if (isFiniteNumber(event?.observed_at) && (event.observed_at < interval[0] || event.observed_at > interval[1])) findings.push({ severity: 'error', code: 'observation-outside-evidence', event: tag, message: 'observed_at must lie inside its evidence interval' })
      if (isFiniteNumber(event?.observed_at) && interval[1] > event.observed_at) findings.push({ severity: 'error', code: 'evidence-not-yet-available', event: tag, message: 'evidence interval cannot extend beyond observed_at' })
      if (isFiniteNumber(event?.valid_from) && event.valid_from < interval[0]) findings.push({ severity: 'error', code: 'validity-before-evidence', event: tag, message: 'valid_from cannot precede the supporting evidence' })
    }
    if (EVENT_TYPES.includes(event?.type)) findings.push(...validatePayload(event, objectIds, placeIds))
  }
  return findings
}

function observationRecord(value, event) {
  return {
    value: clone(value),
    observed_at: event.observed_at,
    valid_from: event.valid_from,
    committed_at: event.committed_at,
    support_until: event.evidence.interval_s[1],
    event_id: event.event_id,
    evidence: clone(event.evidence),
  }
}

function unknownBelief(at, reason, basedOn = []) {
  return { value: null, status: 'unknown', valid_at: at, reason, based_on: [...new Set(basedOn)] }
}

function beliefFromRecord(record, at, reason = 'last direct observation persists') {
  if (!record) return unknownBelief(at, 'no supporting observation')
  const status = at <= record.support_until ? 'observed' : 'inferred'
  return {
    value: clone(record.value),
    status,
    valid_at: at,
    reason: status === 'observed' ? 'directly visible in the supporting interval' : reason,
    based_on: [record.event_id],
  }
}

function blankObject(object) {
  return {
    id: object.id,
    kind: object.kind ?? 'object',
    track_ids: Array.isArray(object.track_ids) ? [...object.track_ids] : [],
    last_observation: {},
    current_belief: {},
    invalidations: {},
  }
}

/**
 * Replay events up to `at` and build a disposable belief projection.
 * Event truth remains the source; this projection can always be rebuilt.
 */
export function projectBeliefs({ objects = [], places = [], sources = [], events = [], at }) {
  if (!isFiniteNumber(at) || at < 0) throw new EmbodiedValidationError([{ severity: 'error', code: 'projection-time-invalid', message: 'projection time must be a non-negative number' }])
  const findings = validateEvents({ objects, places, sources, events })
  const errors = findings.filter((f) => f.severity === 'error')
  if (errors.length) throw new EmbodiedValidationError(errors)

  const normalizedObjects = objects.map((object) => typeof object === 'string' ? { id: object } : object)
  const states = Object.fromEntries(normalizedObjects.map((object) => [object.id, blankObject(object)]))
  const contact = new Set()
  const visibleEvents = events
    .filter((event) => event.valid_from <= at && event.observed_at <= at)
    .sort((a, b) => a.valid_from - b.valid_from || a.observed_at - b.observed_at || Date.parse(a.committed_at) - Date.parse(b.committed_at) || a.event_id.localeCompare(b.event_id))

  const invalidate = (objectId, field, event, reason) => {
    states[objectId].invalidations[field] = { event_id: event.event_id, at: event.valid_from, reason }
  }
  const observe = (objectId, field, value, event) => {
    states[objectId].last_observation[field] = observationRecord(value, event)
    delete states[objectId].invalidations[field]
  }

  for (const event of visibleEvents) {
    const p = event.payload
    switch (event.type) {
      case 'object_observed':
        for (const [field, value] of Object.entries(p.attributes)) observe(p.object, field, value, event)
        observe(p.object, 'visibility', 'visible', event)
        break
      case 'contact_started':
        contact.add(p.object)
        observe(p.object, 'contact', p.actor, event)
        break
      case 'contact_ended':
        contact.delete(p.object)
        observe(p.object, 'contact', null, event)
        break
      case 'occlusion_started':
        observe(p.object, 'visibility', 'occluded', event)
        if (contact.has(p.object)) invalidate(p.object, 'location', event, 'object was contacted before becoming occluded; current location is not justified')
        break
      case 'occlusion_ended':
        observe(p.object, 'visibility', 'unconfirmed', event)
        break
      case 'track_lost':
        observe(p.object, 'visibility', 'lost', event)
        invalidate(p.object, 'location', event, 'perception track was lost')
        break
      case 'put_inside':
        observe(p.object, 'inside', p.container, event)
        invalidate(p.object, 'location', event, 'global location is derived through its container')
        break
      case 'removed_from':
        observe(p.object, 'inside', null, event)
        observe(p.object, 'location', p.location, event)
        break
      case 'identity_distinct':
        observe(p.objects[0], 'identity_not', p.objects[1], event)
        observe(p.objects[1], 'identity_not', p.objects[0], event)
        break
    }
  }

  for (const state of Object.values(states)) {
    const fields = new Set([...Object.keys(state.last_observation), ...Object.keys(state.invalidations)])
    for (const field of fields) {
      const invalidation = state.invalidations[field]
      const record = state.last_observation[field]
      if (invalidation && (!record || invalidation.at >= record.valid_from)) state.current_belief[field] = unknownBelief(at, invalidation.reason, [record?.event_id, invalidation.event_id].filter(Boolean))
      else state.current_belief[field] = beliefFromRecord(record, at)
    }
  }

  // Containment is a rule-backed relation: a hidden contained object's global location follows its container.
  for (const state of Object.values(states)) {
    const inside = state.current_belief.inside
    if (!inside || inside.value === null || inside.status === 'unknown') continue
    const container = states[inside.value]
    const containerLocation = container?.current_belief.location
    if (!containerLocation || containerLocation.status === 'unknown') {
      state.current_belief.location = unknownBelief(at, 'container location is unknown', [...inside.based_on, ...(containerLocation?.based_on ?? [])])
      continue
    }
    state.current_belief.location = {
      value: containerLocation.value,
      status: 'inferred',
      valid_at: at,
      reason: `derived by inside(${state.id},${container.id}) and ${container.id}.location`,
      based_on: [...new Set([...inside.based_on, ...containerLocation.based_on])],
    }
  }

  const projection = {
    schema_version: 'benxiang-embodied-belief/0.1',
    at,
    objects: Object.fromEntries(Object.entries(states).map(([id, state]) => [id, {
      id: state.id,
      kind: state.kind,
      last_observation: state.last_observation,
      current_belief: state.current_belief,
    }])),
    source_events: visibleEvents.map((event) => event.event_id),
    limitations: ['projection contains semantic state only; geometry and control remain external'],
  }
  return projection
}

export function getBelief(projection, objectId, field) {
  return projection?.objects?.[objectId]?.current_belief?.[field] ?? unknownBelief(projection?.at ?? null, 'object or field absent from projection')
}
