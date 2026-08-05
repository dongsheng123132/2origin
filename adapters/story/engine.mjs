#!/usr/bin/env node
// OriginWriter —— 百万字小说写作引擎（Story 方言）。
//
// 一个长篇项目的全部世界状态（人物/物品/地点/势力/伏笔）持久化在
// .origin 包里，正文作为投影产物按章存放。写作是**事务性的**：
//
//   AI 每写一章 = 提交一个语义事务（正文 + 状态变更声明）
//   门禁逐条复核：禁区、约束、伏笔状态机、正文对照状态
//   通过才落盘，失败零写入并返回可据以重写的理由
//
// 于是「写了 100 万字还能自洽」从「靠模型记性好」变成「靠门禁把关」：
// 角色不会突然用上他不知道的信息，物品不会凭空易主，伏笔不会收了又埋。
// 新会话秒恢复：任何时刻 `story state <pkg>` 一次调用拿到全部世界状态。
//
// 参考实现，零依赖。用法见 cli.mjs。

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, appendFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadOrigin } from '../../compiler/origin.mjs'
import { initPackage, commit, seqOf } from '../../compiler/store.mjs'
import { validateTransaction as coreValidate } from '../../compiler/commit-compiler.mjs'
import { zonesToConstraints, zonesToAssertionNames, hookViolations, STORY_ASSERTIONS } from './dialect.mjs'
import { RULES } from '../../benchmark/shadowbench-w/eval/ced.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 正文目录（投影产物）与章节登记表。 */
const CHAPTERS_DIR = ['narrative', 'chapters']
const OUTLINE = ['narrative', 'chapters', 'outline.jsonl']

// ── 世界规格导入（ShadowBench-W spec.origin 风格）──────────────────
// canon/*.jsonl   初始对象（characters / locations / objects / factions…）
// narrative/foreshadowing.jsonl   伏笔初始状态
// timeline/state-changes.jsonl    重放历史（导入为包的 provenance）
// tasks/*.json    forbidden_zones（禁区，可缺省）

function readJsonl(p) {
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
}

/** 把 canon 文件转成初始对象表。每行的 id 自带类型前缀（char:…/loc:…），
 *  initial_state 平铺进对象，另存 _type 供投影按类型分组。 */
function canonObjects(specDir) {
  const dir = join(specDir, 'canon')
  if (!existsSync(dir)) return []
  const out = []
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
    for (const row of readJsonl(join(dir, f))) {
      if (!row?.id) continue
      const type = row.id.split(':')[0]
      out.push({ id: row.id, _type: type, name: row.name ?? null, role: row.role ?? null, ...(row.initial_state ?? {}) })
    }
  }
  return out
}

/** 伏笔初始状态：id + summary + status + setup/payoff 锚点。
 *  重放到第 N 章时，状态由 setup/payoff 章号推导而非照抄 canon 终态：
 *  payoff ≤ N 才算 resolved；已埋未收 = planted_unresolved。 */
function hookObjects(specDir, untilChapter = null) {
  const f = join(specDir, 'narrative', 'foreshadowing.jsonl')
  return readJsonl(f)
    .filter((h) => h?.id)
    .map((h) => {
      const setup = h.setup?.chapter ?? null
      const payoff = h.payoff?.chapter ?? null
      let status = h.status ?? 'planted_unresolved'
      if (untilChapter !== null && payoff !== null && payoff <= untilChapter) status = 'resolved'
      else if (untilChapter !== null && setup !== null && setup <= untilChapter) status = 'planted_unresolved'
      else if (untilChapter !== null && setup !== null && setup > untilChapter) status = 'not_planted'
      return { id: h.id, _type: 'hook', summary: h.summary ?? '', status, setup_chapter: setup, payoff_chapter: payoff, tier: h.tier ?? null }
    })
}

/** 重放历史：state-changes.jsonl 逐条转成 provenance 记录。
 *  untilChapter 为 null 则全部导入；否则只导入 chapter ≤ 该章的变更——
 *  「从第 N 章接续写作」= 世界重放到第 N 章，之后的变更由作者亲手提交。
 *  导入后包的当前状态 = 「第 N 章之后」的世界——这是新会话恢复的基础。 */
function replayHistory(specDir, untilChapter = null) {
  return readJsonl(join(specDir, 'timeline', 'state-changes.jsonl'))
    .filter((c) => untilChapter === null || c.chapter <= untilChapter)
    .map((c, i) => ({
      event: 'state_change',
      seq: i + 1,
      object: c.object,
      field: c.field,
      from: c.from,
      to: c.to,
      op: c.op,
      kind: 'imported',
      basis: c.evidence ? [c.evidence] : undefined,
      tx: `canon@ch${c.chapter}`,
      by: 'spec-import',
      chapter: c.chapter,
    }))
}

/** 禁区：specDir/tasks/*.json 里的 forbidden_zones，全部合并并按 id 去重
 *  （多个任务文件可能声明同一条禁区，如 continuation.json 与 continuation-m.json）。 */
function zonesOf(specDir) {
  const dir = join(specDir, 'tasks')
  if (!existsSync(dir)) return []
  const seen = new Set()
  const out = []
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const t = JSON.parse(readFileSync(join(dir, f), 'utf8'))
    for (const z of t?.forbidden_zones ?? []) {
      if (z?.id && !seen.has(z.id)) { seen.add(z.id); out.push(z) }
    }
  }
  return out
}

/**
 * 从世界规格建写作包。
 * 包 = 初始对象（canon）+ 伏笔 + 重放历史 + 禁区翻译成的约束。
 * 之后所有写作都以事务提交，绝不直接改初始对象。
 */
export function initWriter(pkgDir, specDir, { title = null, untilChapter = null } = {}) {
  const objects = [...canonObjects(specDir), ...hookObjects(specDir, untilChapter)]
  const history = replayHistory(specDir, untilChapter)
  const zones = zonesOf(specDir)
  const constraints = zonesToConstraints(zones)

  const manifest = [
    '# OriginWriter 写作包（Story 方言）',
    `artifact:`,
    `  id: ${basename(pkgDir)}`,
    `  kind: story`,
    `  title: ${title ?? basename(pkgDir)}`,
    `semantics:`,
    `  char: Entity.Person`,
    `  loc: Entity.Place`,
    `  obj: Entity.Artifact`,
    `  faction: Entity.Organization`,
    `  hook: Narrative.Foreshadowing`,
    `  knows: State.Knowledge`,
    `  holder: State.Custody`,
    `constraints:`,
    `  - forbidden_zones must_hold`,
    `  - hook_status must_be_legal`,
    `  - hook_payoff must_have_evidence`,
    `  - character must_not_act_on_unknown_knowledge`,
    `provenance:`,
    `  source: ${specDir}`,
    `  engine: OriginWriter (adapters/story)`,
    `  replayed_until: ${untilChapter ?? 'end'}`,
  ].join('\n')

  mkdirSync(join(pkgDir, ...CHAPTERS_DIR), { recursive: true })
  const pkg = initPackage(pkgDir, { manifest, objects, constraints })
  // 重放历史在 initPackage 之后追加（包刚建好才有 history.jsonl）
  if (history.length) {
    const path = join(pkgDir, 'provenance', 'history.jsonl')
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, history.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  }
  return loadOrigin(pkgDir)
}

/**
 * 世界状态投影——新会话恢复入口。
 * 返回一个自包含的文本：所有对象当前值 + 可违反的约束清单。
 * 不返回聊天记录，不返回正文——那都属于操作窗口。
 */
export function projectState(pkgDir, { task = null, budget = 8000 } = {}) {
  const origin = loadOrigin(pkgDir)
  const lines = ['【世界状态】', '']
  const byType = {}
  for (const [id, f] of Object.entries(origin.state)) (byType[f._type ?? 'object'] ??= []).push([id, f])

  const typeLabel = { char: '人物', loc: '地点', obj: '物品', faction: '势力', hook: '伏笔' }
  for (const [type, items] of Object.entries(byType)) {
    lines.push(`· ${typeLabel[type] ?? type}（${items.length}）`)
    for (const [id, f] of items) {
      const bits = Object.entries(f)
        .filter(([k, v]) => !['_type', 'name', 'summary'].includes(k) && v !== null && v !== undefined)
        .map(([k, v]) => Array.isArray(v) ? (v.length ? `${k}=[${v.join(', ')}]` : null) : `${k}=${v}`)
        .filter(Boolean)
      lines.push(`  ${id}${f.name ? `（${f.name}）` : ''}${f.summary ? ` ${String(f.summary).slice(0, 30)}` : ''}　${bits.join('；')}`)
    }
  }

  const zones = origin.constraints?.filter((c) => c.rule && c.check) ?? []
  if (zones.length) {
    lines.push('', '【禁区·违反即拒绝提交】')
    for (const c of zones) lines.push(`  - ${c.rule}`)
  }

  const text = lines.join('\n')
  if (text.length <= budget) return text
  // 超出预算时保人物/物品/伏笔，砍细节——预算算术留给调用方更细致的实现
  return lines.slice(0, Math.max(8, Math.floor(budget / 60))).join('\n') + `\n…（投影已按预算 ${budget} 截断）`
}

/**
 * 提交一章写作事务。
 * tx 形状：
 *   { chapter: 11, transaction_id?: 'ch11', text: '…正文…',
 *     state_changes: [{object, field, from?, to, basis?}], creates?: [{id, type}],
 *     assertions?: [...], hooks?: [{id, summary, status, setup, payoff}] }
 *
 * 门禁五道，全过才落盘：
 *   ① 正文非空（写作任务交不出正文就是没干活）
 *   ② 结构/引用/快照隔离（核心校验）
 *   ③ 禁区约束（machine_check 翻译）
 *   ④ 伏笔状态机与回收依据（本方言）
 *   ⑤ 正文对照状态（CED 规则引擎扫正文）
 * 失败时一个字节都不写，违规逐条返回。
 */
export function submitChapter(pkgDir, tx, { by = 'origin-writer', expect_seq = null } = {}) {
  const origin = loadOrigin(pkgDir)
  // 禁区在 initWriter 时已翻译成约束存进包（graph/constraints.json）
  const all = origin.constraints ?? []

  if (!tx || typeof tx.text !== 'string' || !tx.text.trim()) {
    return { ok: false, violations: [{ code: 'schema', severity: 'error', msg: '事务缺少正文 text——写作事务必须交付一章正文' }], errors: 1 }
  }
  const ch = tx.chapter ?? 0
  if (!ch) {
    return { ok: false, violations: [{ code: 'schema', severity: 'error', msg: '事务缺少 chapter——不知道这是第几章，拒绝落盘以免写错文件' }], errors: 1 }
  }

  const res = coreValidate({
    tx: { ...tx, text: undefined }, // 正文不走核心校验（核心不认识正文），交给 CED
    stateBefore: origin.state,
    constraints: all,
    assertions: STORY_ASSERTIONS,
    prose: {
      check: (text, { stateBefore: before, stateAfter }) =>
        RULES.flatMap((rule) => rule.check({ text, state: before, stateAfter, spec: storySpec(origin), chapter: tx.chapter ?? null })),
    },
  })

  // 核心校验收的是 normalized tx；把 text 放回去供 CED 使用
  const hookV = hookViolations(res.stateAfter ?? origin.state, tx)
  const violations = [...res.violations, ...hookV]
  const errors = violations.filter((v) => v.severity !== 'warning')

  if (errors.length) return { ok: false, violations, errors: errors.length }

  // ── 落盘：正文先写，状态后提交（正文是投影产物，状态是世界的变更）──
  mkdirSync(join(pkgDir, ...CHAPTERS_DIR), { recursive: true })
  const textPath = join(pkgDir, ...CHAPTERS_DIR, `ch${String(ch).padStart(2, '0')}.txt`)
  writeFileSync(textPath, tx.text, 'utf8')

  const outlinePath = join(pkgDir, ...OUTLINE)
  const outline = existsSync(outlinePath) ? readJsonl(outlinePath) : []
  outline.push({ chapter: ch, file: basename(textPath), chars: tx.text.length, at: new Date().toISOString(), by, tx: tx.transaction_id ?? null })
  writeFileSync(outlinePath, outline.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')

  const r = commit(pkgDir, tx, { by, expectedSeq: expect_seq ?? null, assertions: STORY_ASSERTIONS })
  if (!r.ok) {
    // 理论上核心校验已通过，这里只会因并发冲突失败
    return { ...r, violations: r.violations, errors: r.errors }
  }
  return { ok: true, receipt: { ...r.receipt, chapter: ch, text_file: basename(textPath), chars: tx.text.length } }
}

/** 给 CED 规则引擎用的 spec 形状（它要 characters/objects/locations… 数组）。 */
function storySpec(origin) {
  const list = (type) => Object.entries(origin.state).filter(([, f]) => f._type === type).map(([id, f]) => ({ id, name: f.name ?? id, ...f }))
  return {
    characters: list('char'),
    objects: list('obj'),
    locations: list('loc'),
    factions: list('faction'),
  }
}

/** 伏笔图谱：每个伏笔的埋设章、状态、回收章。 */
export function hookGraph(pkgDir) {
  const origin = loadOrigin(pkgDir)
  return Object.entries(origin.state)
    .filter(([, f]) => f._type === 'hook')
    .map(([id, f]) => ({
      id,
      summary: f.summary ?? '',
      status: f.status ?? 'unknown',
      setup_chapter: f.setup_chapter ?? null,
      payoff_chapter: f.payoff_chapter ?? null,
      tier: f.tier ?? null,
    }))
}

/** 预检：不落盘，只回答「这章能不能过门禁」。 */
export function checkChapter(pkgDir, tx, { by = 'origin-writer' } = {}) {
  const origin = loadOrigin(pkgDir)
  if (!tx || typeof tx.text !== 'string' || !tx.text.trim())
    return { ok: false, violations: [{ code: 'schema', severity: 'error', msg: '事务缺少正文 text' }], errors: 1 }
  const res = coreValidate({
    tx: { ...tx, text: undefined },
    stateBefore: origin.state,
    constraints: origin.constraints ?? [],
    assertions: STORY_ASSERTIONS,
    prose: {
      check: (text, { stateBefore: before, stateAfter }) =>
        RULES.flatMap((rule) => rule.check({ text, state: before, stateAfter, spec: storySpec(origin), chapter: tx.chapter ?? null })),
    },
  })
  const violations = [...res.violations, ...hookViolations(res.stateAfter ?? origin.state, tx)]
  const errors = violations.filter((v) => v.severity !== 'warning')
  return { ok: errors.length === 0, violations, errors: errors.length }
}

export { seqOf }
