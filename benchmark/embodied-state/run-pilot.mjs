#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const spec = JSON.parse(readFileSync(join(HERE, 'benchmark.json'), 'utf8'))
const media = JSON.parse(readFileSync(join(HERE, 'local-sources.json'), 'utf8'))
const cli = process.platform === 'win32' ? process.execPath : 'bl'
const cliPrefix = process.platform === 'win32' ? [join(process.env.APPDATA, 'npm', 'node_modules', 'bailian-cli', 'dist', 'bailian.mjs')] : []
const armArg = process.argv.includes('--arm') ? process.argv[process.argv.indexOf('--arm') + 1] : undefined
const arms = armArg ? [armArg] : ['A0', 'A1', 'A2', 'A2G']
const allowedArms = new Set(['A0', 'A1', 'A2', 'A2G'])
for (const arm of arms) if (!allowedArms.has(arm)) throw new Error(`unknown arm ${arm}`)

function parseContent(text) {
  const envelope = JSON.parse(text)
  const content = String(envelope.content ?? '').trim()
  const stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`no JSON object in model content: ${content}`)
  return { envelope, parsed: JSON.parse(stripped.slice(start, end + 1)) }
}

function ask(videoUrl, system, message) {
  const args = ['omni', '--video', videoUrl, '--system', system, '--message', message, '--model', media.model, '--text-only', '--temperature', '0.01', '--max-tokens', '1000', '--output', 'json', '--non-interactive', '--timeout', '300']
  let lastError = ''
  for (let attempt = 1; attempt <= 4; attempt++) {
    const run = spawnSync(cli, [...cliPrefix, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
    if (run.status === 0) return parseContent(run.stdout)
    lastError = run.stderr || `bl exited ${run.status}`
    const retryable = /rate limit|quota exceeded|token-limit/i.test(lastError)
    if (!retryable || attempt === 4) break
    const waitMs = 30_000 * attempt
    console.error(`rate limited; retry ${attempt}/4 after ${waitMs / 1000}s`)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs)
  }
  throw new Error(lastError)
}

const commonSystem = `你是机器人世界状态测试器。只依据给定视频与提示中明确提供的既有状态回答。黑色区域代表传感器在该区域没有观测。禁止根据常识编造遮挡期间的动作。位置标签只有L、M、R。epistemic必须是observed、inferred或unknown：当前视频直接可见才是observed；由先前状态延续或关系推导是inferred；证据不足是unknown。evidence_seconds只能填写本视频中真正支持答案的时间点（秒）。只输出JSON。`

function answerShape(q) {
  return `问题（视频截止${q.checkpoint_s}秒）：${q.prompt}\nvalue必须使用下列规范值之一：M、L、R、UNKNOWN、A_NOT_D、INSIDE_A、OUTSIDE_A_AT_R。`
}

function normalizeAnswer(q, parsed) {
  const a = parsed.answer ?? parsed
  return {
    question_id: q.id,
    value: String(a.value ?? '').trim(),
    epistemic: String(a.epistemic ?? '').trim().toLowerCase(),
    evidence_seconds: Array.isArray(a.evidence_seconds) ? a.evidence_seconds.map(Number).filter(Number.isFinite) : [],
    explanation: String(a.explanation ?? a.evidence ?? '').trim()
  }
}

const knownObjects = new Set(spec.objects.map((o) => o.id))
const allowedFields = new Set(['exists', 'location', 'inside', 'identity_not'])
function admit(tx, store, { commit = true } = {}) {
  const errors = []
  if (!tx || typeof tx !== 'object') return { ok: false, errors: ['transaction missing'] }
  if (tx.expected_state_version !== store.version) errors.push(`version conflict: expected ${store.version}`)
  const changes = Array.isArray(tx.changes) ? tx.changes : []
  if (!changes.length) errors.push('changes missing')
  for (const [i, c] of changes.entries()) {
    const tag = `change[${i}]`
    if (!knownObjects.has(c.object)) errors.push(`${tag}: unknown object`)
    if (!allowedFields.has(c.field)) errors.push(`${tag}: unsupported field`)
    if (!['observed', 'inferred', 'unknown'].includes(c.epistemic)) errors.push(`${tag}: invalid epistemic`)
    if (!Number.isFinite(Number(c.evidence_second))) errors.push(`${tag}: evidence_second required`)
    const current = store.state[c.object]?.[c.field] ?? null
    if (JSON.stringify(c.from ?? null) !== JSON.stringify(current)) errors.push(`${tag}: stale from value`)
  }
  if (errors.length) return { ok: false, errors }
  if (commit) {
    const next = structuredClone(store.state)
    for (const c of changes) {
      next[c.object] ??= {}
      next[c.object][c.field] = c.to ?? null
      next[c.object][`${c.field}__epistemic`] = c.epistemic
      next[c.object][`${c.field}__evidence_second`] = Number(c.evidence_second)
    }
    store.state = next
    store.version++
  }
  return { ok: true, errors: [] }
}

const FIELD_DOMAINS = {
  exists: (v) => typeof v === 'boolean',
  location: (v) => ['L', 'M', 'R', 'OUTSIDE_WORKSPACE', 'UNKNOWN'].includes(v),
  inside: (v) => v === null || knownObjects.has(v),
  identity_not: (v, object) => knownObjects.has(v) && v !== object
}

function semanticAdmit(tx, store, { scenario, q, answer }) {
  const base = admit(tx, store, { commit: false })
  const errors = [...base.errors]
  const changes = Array.isArray(tx?.changes) ? tx.changes : []
  const tr = scenario.observation_transform ?? {}
  const checkpoint = q.checkpoint_s
  if (answer.value === 'UNKNOWN' && changes.some((c) => ['location', 'inside', 'identity_not'].includes(c.field) && c.to !== 'UNKNOWN')) errors.push('UNKNOWN answer may not commit a definite current world value')
  for (const [i, c] of changes.entries()) {
    const tag = `change[${i}]`
    const domain = FIELD_DOMAINS[c.field]
    if (domain && !domain(c.to ?? null, c.object)) errors.push(`${tag}: value outside ${c.field} domain`)
    const t = Number(c.evidence_second)
    if (Number.isFinite(t) && (t < 0 || t > checkpoint)) errors.push(`${tag}: evidence outside available video prefix`)
    if (c.epistemic === 'observed' && tr.kind === 'digital_occlusion' && Number.isFinite(t)) {
      const [start, end] = tr.interval_s
      if (t >= start && t <= Math.min(end, checkpoint)) errors.push(`${tag}: observed evidence lies inside digital occlusion`)
      if (t < start && checkpoint > start && checkpoint <= end) errors.push(`${tag}: pre-occlusion observation cannot be claimed as current observed state`)
    }
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)] }

  const projected = structuredClone(store.state)
  for (const c of changes) {
    projected[c.object] ??= {}
    projected[c.object][c.field] = c.to ?? null
  }
  const grounded = (() => {
    if (answer.value === 'UNKNOWN') return true
    if (['L', 'M', 'R'].includes(answer.value)) return projected.A?.location === answer.value
    if (answer.value === 'A_NOT_D') return projected.A?.identity_not === 'D' || projected.D?.identity_not === 'A'
    if (answer.value === 'INSIDE_A') return projected.B?.inside === 'A'
    if (answer.value === 'OUTSIDE_A_AT_R') return projected.B?.inside === null && projected.B?.location === 'R'
    return false
  })()
  if (!grounded) return { ok: false, errors: ['answer is not grounded by the proposed committed state'] }
  return admit(tx, store)
}

mkdirSync(join(HERE, 'results'), { recursive: true })
for (const arm of arms) {
  const out = join(HERE, 'results', `pilot-${media.model}-${arm.toLowerCase()}.json`)
  const result = { benchmark_id: spec.benchmark_id, model: media.model, arm, run_kind: 'pilot-single-run', started_at: new Date().toISOString(), status: 'in_progress', answers: [], scenarios: [], limitations: ['single run', 'staged fixed-camera videos', 'no statistical claim'] }
  for (const scenario of spec.scenarios) {
    let promptState = {}
    const store = { version: 0, state: {} }
    const scenarioLog = { scenario_id: scenario.id, turns: [] }
    for (const q of scenario.questions) {
      const videoUrl = media.clips[q.id]?.url
      if (!videoUrl) throw new Error(`missing uploaded clip ${q.id}`)
      let message
      if (arm === 'A0') {
        message = `${answerShape(q)}\n输出：{"value":"...","epistemic":"...","evidence_seconds":[0.0],"explanation":"..."}`
      } else if (arm === 'A1') {
        message = `${answerShape(q)}\n这是你在上一检查点自己维护的状态表：${JSON.stringify(promptState)}\n请依据本视频更新完整状态表。状态表不是事实来源，若与新观察冲突，以新观察为准。输出：{"answer":{"value":"...","epistemic":"...","evidence_seconds":[0.0],"explanation":"..."},"state_after":{"A":{},"B":{},"C":{},"D":{}}}`
      } else {
        const gateContract = arm === 'A2G' ? `\n字段类型严格限定：location只能是L/M/R/OUTSIDE_WORKSPACE/UNKNOWN；inside只能是A/B/C/D/null；identity_not只能是另一个对象ID；exists只能是布尔值。答案必须能从事务提交后的状态直接推出：A_NOT_D需要identity_not，INSIDE_A需要B.inside=A，OUTSIDE_A_AT_R需要B.inside=null且B.location=R。若答案是UNKNOWN，不得提交确定的当前值。遮挡前的观测不能冒充遮挡中的当前observed。` : ''
        message = `${answerShape(q)}\n当前已提交状态版本=${store.version}，状态=${JSON.stringify(store.state)}${gateContract}\n请回答并提出一次状态事务。每项change必须给object、field、from、to、epistemic、evidence_second；from必须严格等于当前已提交值，不存在的字段用null。即使状态不变，也应提交由本视频新证据支持的字段。输出：{"answer":{"value":"...","epistemic":"...","evidence_seconds":[0.0],"explanation":"..."},"transaction":{"expected_state_version":${store.version},"changes":[{"object":"A","field":"location","from":null,"to":"M","epistemic":"observed","evidence_second":2.0}]}}`
      }
      let { envelope, parsed } = ask(videoUrl, commonSystem, message)
      let answer = normalizeAnswer(q, parsed)
      const attempts = []
      if (arm === 'A2G') {
        for (let attemptNo = 1; attemptNo <= 2; attemptNo++) {
          const admission = semanticAdmit(parsed.transaction, store, { scenario, q, answer })
          attempts.push({ attempt: attemptNo, answer: structuredClone(answer), transaction: structuredClone(parsed.transaction), admission })
          if (admission.ok) break
          if (attemptNo === 2) {
            answer = { question_id: q.id, value: 'UNKNOWN', epistemic: 'unknown', evidence_seconds: [], explanation: `safe abstention after gate rejection: ${admission.errors.join('; ')}` }
            break
          }
          const correction = `${message}\n\n你上一次的候选被确定性门禁拒绝：${admission.errors.join('; ')}。请根据同一视频纠正答案和事务，不要争辩门禁，也不要虚构新证据。`
          ;({ envelope, parsed } = ask(videoUrl, commonSystem, correction))
          answer = normalizeAnswer(q, parsed)
        }
      }
      result.answers.push(answer)
      const turn = { question_id: q.id, answer, raw: parsed, request_id: envelope.request_id ?? null }
      if (arm === 'A1') {
        if (parsed.state_after && typeof parsed.state_after === 'object') promptState = parsed.state_after
        turn.state_after = structuredClone(promptState)
      }
      if (arm === 'A2' || arm === 'A2G') {
        const admission = arm === 'A2G' ? (attempts.at(-1)?.admission ?? { ok: false, errors: ['missing attempt'] }) : admit(parsed.transaction, store)
        if (arm === 'A2G') turn.attempts = attempts
        turn.admission = admission
        turn.committed_version = store.version
        turn.committed_state = structuredClone(store.state)
      }
      scenarioLog.turns.push(turn)
      result.scenarios = [...result.scenarios, scenarioLog]
      result.updated_at = new Date().toISOString()
      writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
      result.scenarios.pop()
      console.log(`${arm} ${q.id}: ${answer.value}/${answer.epistemic}${arm === 'A2' ? ` gate=${turn.admission.ok ? 'accept' : 'reject'}` : ''}`)
    }
    result.scenarios.push(scenarioLog)
  }
  result.completed_at = new Date().toISOString()
  result.status = 'complete'
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
  console.log(`saved ${out}`)
}
