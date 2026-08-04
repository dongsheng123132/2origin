#!/usr/bin/env node
// origin —— 本象包的命令行入口。
//
// 协议把「证据链」当作核心承诺，那么「这个值凭什么是这个值」就必须是**一条命令**，
// 而不是一段需要写代码才能读出来的内部结构。子命令各对应一个问题：
//
//   origin status   <pkg>              这个包里有什么？
//   origin why      <pkg> <obj.field>  这个值凭什么是这个值？
//   origin history  <pkg> [过滤]       都改过什么、谁改的？
//   origin replay   <pkg> [--until]    某一刻的世界长什么样？
//   origin diagnose <pkg>              这个包现在健不健康？
//   origin limits   <pkg>              这个包保证不了什么？
//   origin commit   <pkg> <tx.json>    把一个语义事务落进去（唯一的写入口）
//
// **写入只有 commit 一条路**：校验不过则一字节不写，理由原样返回给调用方重写；
// 通过则只往 provenance/history.jsonl 追加，绝不覆写 graph/objects.jsonl。
//
// 输出遵循 ai-cli-design：stdout 只出结果数据（默认 TSV，可 grep/awk），
// stderr 出人看的说明，--json 出机器读的结构，退出码 0 成功 / 1 有错 / 2 用法错。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadOrigin } from './origin.mjs'
import { normalizeId } from './commit-compiler.mjs'
import { why, historyOf, diagnose, replay, parseRef } from './provenance.mjs'
import { checkLimits, relevantLimits, renderLimits } from './limits.mjs'
import { commit, seqOf } from './store.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const VERSION = (() => {
  try { return JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version }
  catch { return '0.0.0' }
})()

const USAGE = `origin ${VERSION} —— 本象包检视与提交

读：
  origin status   <pkg>                     包概览
  origin why      <pkg> <object.field>      这个值凭什么是这个值
  origin history  <pkg> [--object ID] [--field F] [--tx ID] [--by WHO] [--limit N]
  origin replay   <pkg> [--until <seq|tx>]  重放到某一刻的完整状态
  origin diagnose <pkg>                     包体检（有 error 时退出码 1）
  origin limits   <pkg> [--scope 前缀*]     这个包保证不了什么（接手陌生包先问它）
  origin seq      <pkg>                     当前 seq 水位

写（唯一）：
  origin commit   <pkg> <tx.json|-> [--by WHO] [--expect SEQ]
                                            校验不过则一字节不写，理由走 stdout

选项：
  --json          结构化输出（AI 用）
  -q, --quiet     只出结果，不出说明
  -v, --verbose   多出过程信息
  --version       版本号
  -h, --help      本帮助

示例：
  origin why spec/examples/sales-2026.origin projection:revenue-trend.chart
  origin diagnose spec/examples/sales-2026.origin && echo healthy
  S=$(origin seq pkg) && origin commit pkg tx.json --expect $S --by agent-a`

// ── 输出层 ──────────────────────────────────────────────────────
const flags = new Set()
const opts = {}
const args = []
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (['--object', '--field', '--tx', '--by', '--limit', '--until', '--expect', '--scope'].includes(a)) opts[a.slice(2)] = process.argv[++i]
  else if (a.startsWith('-')) flags.add(a)
  else args.push(a)
}
const JSON_MODE = flags.has('--json')
const QUIET = flags.has('-q') || flags.has('--quiet')
const VERBOSE = flags.has('-v') || flags.has('--verbose')

/** 人看的说明一律走 stderr——stdout 必须能被 AI 直接当数据吃。 */
const note = (msg) => { if (!QUIET && !JSON_MODE) process.stderr.write(msg + '\n') }
const trace = (msg) => { if (VERBOSE) process.stderr.write('· ' + msg + '\n') }
const row = (...cells) => process.stdout.write(cells.map(fmt).join('\t') + '\n')

function fmt(v) {
  if (v === undefined) return '-'
  if (v === null) return 'null'
  return typeof v === 'string' ? v : JSON.stringify(v)
}

function emit(payload, tsv) {
  if (JSON_MODE) process.stdout.write(JSON.stringify({ ok: true, ...payload }) + '\n')
  else tsv()
}

function die(code, msg) {
  if (JSON_MODE) process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n')
  else process.stderr.write('错误：' + msg + '\n')
  process.exit(code)
}

// ── 子命令 ──────────────────────────────────────────────────────
const COMMANDS = {
  status(origin) {
    const d = diagnose(origin)
    const changes = origin.history.filter((e) => e.event === 'state_change')
    const last = changes[changes.length - 1] ?? null
    emit(
      { pkg: origin.dir, artifact: origin.manifest.artifact?.id ?? null, objects: d.objects, relations: d.relations, constraints: d.constraints, changes: d.changes, last_change: last },
      () => {
        row('artifact', origin.manifest.artifact?.id ?? '-')
        row('objects', d.objects)
        row('relations', d.relations)
        row('constraints', `${d.constraints.enforceable}/${d.constraints.total} 可机器判定`)
        row('changes', d.changes)
        if (last) row('last_change', `${last.object}.${last.field}`, last.tx ?? '-', last.at ?? '-')
      },
    )
  },

  why(origin) {
    const raw = args[2]
    if (!raw) die(2, '缺少 <object.field>，例：origin why <pkg> obj:black-key.holder')
    const parsed = parseRef(raw)
    if (!parsed) die(2, `「${raw}」不是合法引用，应形如 object.field`)

    // 协议自己的第 7 条原则（ID 必须自带归一化层）也适用于人和 AI 敲的命令行：
    // 写 black-key.holder 而不是 obj:black-key.holder，不该被判为「查无此对象」。
    const object = normalizeId(parsed.object, origin.ids)
    if (object !== parsed.object) trace(`ID 归一化 ${parsed.object} → ${object}`)
    if (!origin.ids.has(object)) die(1, `未知对象 ${parsed.object}`)

    const r = why({ state: origin.initial, history: origin.history, object, field: parsed.field })
    emit({ ...r }, () => {
      note(`${r.ref} 当前值：${fmt(r.value)}` + (r.explained ? `（经 ${r.chain.length} 次事务改动）` : '（无事务记录）'))
      if (!r.explained) return note('该值直接来自包的初始对象表，未经任何事务——所以它「凭」的是导入，不是推演。')
      // basis 是「凭什么」里的**凭**——applyTransaction 一直在记，此前只有 --json 看得到。
      // 一条 why 不带依据，等于把问题答了一半。
      note('seq\tat\tby\ttx\tfrom\tto\tkind\tbasis')
      for (const c of r.chain) row(c.seq, c.at, c.by, c.tx, c.from, c.to, c.kind + (('claimed_from' in c) ? `(声称前值 ${fmt(c.claimed_from)})` : ''), (c.basis ?? []).join(' '))
    })
  },

  history(origin) {
    const rows = historyOf(origin.history, {
      object: opts.object ? normalizeId(opts.object, origin.ids) : undefined,
      field: opts.field, tx: opts.tx, by: opts.by,
      limit: opts.limit ? Number(opts.limit) : 0,
    })
    emit({ count: rows.length, changes: rows }, () => {
      if (!rows.length) return note('无匹配的状态变更记录。')
      note('seq\tat\tby\ttx\tref\tfrom\tto')
      for (const c of rows) row(c.seq, c.at, c.by, c.tx, `${c.object}.${c.field}`, c.from, c.to)
    })
  },

  diagnose(origin) {
    const d = diagnose(origin)
    const errors = d.findings.filter((f) => f.severity === 'error').length
    if (JSON_MODE) process.stdout.write(JSON.stringify({ ok: d.ok, ...d }) + '\n')
    else {
      note(`对象 ${d.objects}｜关系 ${d.relations}｜约束 ${d.constraints.enforceable}/${d.constraints.total} 可判定｜变更 ${d.changes}`)
      for (const f of d.findings) row(f.severity, f.code, f.msg)
      note(d.ok ? '✓ 无 error 级问题' : `✗ ${errors} 个 error 级问题`)
    }
    // 体检发现 error 即非零退出——可直接串进 CI：origin diagnose pkg && next-step
    process.exit(d.ok ? 0 : 1)
  },

  /** 唯一会写盘的子命令。校验不过则一个字节都不写，违规原因走 stdout 供 AI 直接重写。 */
  commit(origin) {
    const src = args[2]
    if (!src) die(2, '缺少事务文件路径（用 - 从 stdin 读）')
    let tx
    try { tx = JSON.parse(src === '-' ? readFileSync(0, 'utf8') : readFileSync(src, 'utf8')) }
    catch (e) { die(2, `事务读取或解析失败：${e.message}`) }

    const r = commit(origin.dir, tx, {
      by: opts.by ?? `cli@${process.env.USERNAME ?? process.env.USER ?? 'local'}`,
      expectedSeq: opts.expect === undefined ? null : Number(opts.expect),
    })

    if (!r.ok) {
      if (JSON_MODE) process.stdout.write(JSON.stringify({ ok: false, error: r.conflict ? 'write-conflict' : 'validation-failed', violations: r.violations, conflict: r.conflict ?? null }) + '\n')
      else {
        for (const v of r.violations) row(v.severity ?? 'error', v.code ?? '-', v.msg)
        note(`✗ 未落盘（${r.errors} 条错误）——按上面的理由重写事务再提交`)
      }
      process.exit(1)
    }
    emit({ receipt: r.receipt }, () => {
      note(`✓ 已落盘 seq ${r.receipt.seq_from}–${r.receipt.seq_to}，责任者 ${r.receipt.by}`)
      for (const ref of r.receipt.changed) row('changed', ref)
      for (const w of r.receipt.warnings) row('warning', w.code ?? '-', w.msg)
    })
  },

  /**
   * 第七要素：这个包保证不了什么。
   *
   * 单列成一条命令而不是塞进 status，是因为它的读者不一样：status 回答
   * 「这里面有什么」，limits 回答「哪些地方别信我」。**接一个陌生包时应当先问后者。**
   * `--scope` 按范围过滤，省得把全部边界塞进模型上下文挤掉正事。
   */
  limits(origin) {
    const list = relevantLimits(origin.limits ?? [], opts.scope ?? null)
    const bad = checkLimits(origin.limits ?? [])
    emit({ limits: list, total: (origin.limits ?? []).length, malformed: bad }, () => {
      process.stdout.write(renderLimits(list) + '\n')
      for (const b of bad) row(b.severity, b.code, b.msg)
    })
  },

  /** seq 水位。提交前读一次，落盘时用 --expect 传回即可发现有人插队。 */
  seq(origin) {
    const n = seqOf(origin.dir)
    emit({ seq: n }, () => row(n))
  },

  replay(origin) {
    const state = replay(origin.state, origin.history, { until: opts.until ? (/^\d+$/.test(opts.until) ? Number(opts.until) : opts.until) : null })
    emit({ until: opts.until ?? null, state }, () => {
      for (const [id, fields] of Object.entries(state))
        for (const [k, v] of Object.entries(fields ?? {})) if (k !== '_type') row(`${id}.${k}`, v)
    })
  },
}

// ── 主流程 ──────────────────────────────────────────────────────
if (flags.has('--version')) { process.stdout.write(VERSION + '\n'); process.exit(0) }
if (flags.has('-h') || flags.has('--help') || !args.length) { process.stdout.write(USAGE + '\n'); process.exit(args.length ? 0 : 2) }

const [cmd, pkg] = args
if (!COMMANDS[cmd]) die(2, `未知子命令「${cmd}」。可用：${Object.keys(COMMANDS).join(' / ')}`)
if (!pkg) die(2, `子命令 ${cmd} 需要一个 .origin 包路径`)

let origin
try {
  origin = loadOrigin(pkg)
  trace(`已加载 ${pkg}：${origin.objects.length} 对象 / ${origin.history.length} 条事件`)
} catch (e) {
  die(1, `无法加载包 ${pkg}：${e.message}`)
}
if (!origin.objects.length) die(1, `${pkg} 里没有对象——不是本象包，或 graph/objects.jsonl 缺失`)

try {
  COMMANDS[cmd](origin)
} catch (e) {
  die(1, e.message)
}
