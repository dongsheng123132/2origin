#!/usr/bin/env node
// 状态重放器：ground truth 的唯一来源。
//   某章状态 = canon 初始状态 + fold(chapter ≤ N 的 state-changes)
// 用途：① 校验世界规格自洽 ② W3 判分的基准状态 ③ 为各实验臂生成任务上下文
//
//   node replay.mjs --validate          校验规格自洽性
//   node replay.mjs --chapter 10        输出第 10 章末的世界状态
//   node replay.mjs --chapter 10 --json 同上，纯 JSON 输出

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SPEC = join(dirname(fileURLToPath(import.meta.url)), '..', 'world', 'spec.origin')

const readJsonl = (rel) =>
  readFileSync(join(SPEC, rel), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l, i) => {
      try {
        return JSON.parse(l)
      } catch (e) {
        throw new Error(`${rel} 第 ${i + 1} 行 JSON 解析失败: ${e.message}`)
      }
    })

export function loadSpec() {
  return {
    characters: readJsonl('canon/characters.jsonl'),
    objects: readJsonl('canon/objects.jsonl'),
    locations: readJsonl('canon/locations.jsonl'),
    rules: readJsonl('canon/world-rules.jsonl'),
    events: readJsonl('timeline/events.jsonl'),
    changes: readJsonl('timeline/state-changes.jsonl'),
    hooks: readJsonl('narrative/foreshadowing.jsonl'),
    outline: readJsonl('chapters/outline.jsonl'),
  }
}

/** 折叠到第 upto 章末的世界状态 */
export function replay(spec, upto = Infinity) {
  const state = {}
  for (const e of [...spec.characters, ...spec.objects]) {
    state[e.id] = { ...(e.initial_state ?? {}) }
    if (Array.isArray(state[e.id].knows)) state[e.id].knows = [...state[e.id].knows]
  }

  const problems = []
  for (const c of spec.changes.filter((c) => c.chapter <= upto).sort((a, b) => a.seq - b.seq)) {
    const obj = state[c.object]
    if (!obj) {
      problems.push(`seq ${c.seq}: 对象 ${c.object} 不存在于 canon`)
      continue
    }
    if (c.op === 'append') {
      if (!Array.isArray(obj[c.field])) obj[c.field] = []
      if (obj[c.field].includes(c.to)) problems.push(`seq ${c.seq}: ${c.object}.${c.field} 重复追加 ${c.to}`)
      obj[c.field].push(c.to)
    } else {
      // 关键校验：变更的 from 必须接得上当前值，否则规格有断链
      if ('from' in c && JSON.stringify(obj[c.field]) !== JSON.stringify(c.from)) {
        problems.push(
          `seq ${c.seq}: ${c.object}.${c.field} 断链——声明 from=${JSON.stringify(c.from)}，实际为 ${JSON.stringify(obj[c.field])}`
        )
      }
      obj[c.field] = c.to
    }
  }
  // 持有物是派生视图，不是独立存储——保管链的唯一真相在 obj:*.holder
  for (const o of spec.objects) {
    const h = state[o.id]?.holder
    if (h && state[h]) (state[h]._carries ??= []).push(o.id)
  }
  return { state, problems }
}

/** 规格自洽性校验 */
function validate(spec) {
  const errors = []
  const ids = new Set([...spec.characters, ...spec.objects].map((e) => e.id))
  const eventIds = new Set(spec.events.map((e) => e.id))
  const chapters = new Set(spec.outline.map((c) => c.chapter))

  // 单一真相守卫：持有关系只许存在于 obj:*.holder，角色侧不得另记一份
  // （首次跑校验即抓到此类断链：老陶已交出黑钥匙，角色侧 carries 仍留着一把）
  for (const ch of spec.characters) {
    if ('carries' in (ch.initial_state ?? {}))
      errors.push(`character ${ch.id}: 不得在角色侧存 carries——保管链唯一真相是 obj:*.holder，持有物由重放派生`)
  }

  // 状态变更的引用完整性
  for (const c of spec.changes) {
    if (!ids.has(c.object)) errors.push(`state-change seq ${c.seq}: 未知对象 ${c.object}`)
    if (!eventIds.has(c.valid_from)) errors.push(`state-change seq ${c.seq}: 未知事件 ${c.valid_from}`)
    if (!chapters.has(c.chapter)) errors.push(`state-change seq ${c.seq}: 章节 ${c.chapter} 不在大纲中`)
    if (!/^scene:\d{2}-\d{2}$/.test(c.evidence ?? '')) errors.push(`state-change seq ${c.seq}: evidence 格式不合法 (${c.evidence})`)
  }
  // 事件与章节的一致性
  for (const e of spec.events) {
    if (!chapters.has(e.chapter)) errors.push(`event ${e.id}: 章节 ${e.chapter} 不在大纲中`)
    for (const p of e.participants ?? []) if (!ids.has(p)) errors.push(`event ${e.id}: 未知参与者 ${p}`)
  }
  // 大纲引用的事件与状态变更
  const changeSeqs = new Set(spec.changes.map((c) => c.seq))
  for (const ch of spec.outline) {
    for (const ev of ch.events ?? []) if (!eventIds.has(ev)) errors.push(`chapter ${ch.chapter}: 未知事件 ${ev}`)
    for (const s of ch.allowed_state_changes ?? []) if (!changeSeqs.has(s)) errors.push(`chapter ${ch.chapter}: 未知变更 seq ${s}`)
  }
  // 伏笔埋设点
  for (const h of spec.hooks) {
    if (!eventIds.has(h.setup?.event)) errors.push(`hook ${h.id}: 埋设事件 ${h.setup?.event} 不存在`)
  }
  // 重放断链
  errors.push(...replay(spec).problems)
  return errors
}

const args = process.argv[1] === fileURLToPath(import.meta.url) ? process.argv.slice(2) : ['--noop']
if (args.includes('--noop')) {
  // 作为模块被导入，不执行 CLI
} else if (args.includes('--validate')) {
  const errors = validate(loadSpec())
  if (errors.length) {
    console.error('✗ 规格校验未通过：')
    for (const e of errors) console.error('  -', e)
    process.exit(1)
  }
  console.log('✓ 世界规格自洽（引用完整、状态链无断裂）')
} else if (args.includes('--chapter')) {
  const n = Number(args[args.indexOf('--chapter') + 1])
  const { state, problems } = replay(loadSpec(), n)
  if (args.includes('--json')) {
    console.log(JSON.stringify(state, null, 2))
  } else {
    console.log(`# 第 ${n} 章末世界状态\n`)
    for (const [id, s] of Object.entries(state)) {
      if (!Object.keys(s).length) continue
      console.log(id)
      for (const [k, v] of Object.entries(s)) console.log(`    ${k}: ${JSON.stringify(v)}`)
    }
    if (problems.length) console.error('\n⚠ 重放问题：\n' + problems.map((p) => '  - ' + p).join('\n'))
  }
} else {
  console.log('用法: node replay.mjs --validate | --chapter <N> [--json]')
}
