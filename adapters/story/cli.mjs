#!/usr/bin/env node
// OriginWriter —— 百万字小说写作引擎 · 命令行入口。
//
//   origin-story init    <specDir> <pkg>            从世界规格建写作包
//   origin-story state   <pkg> [--task 当前任务]     世界状态投影（新会话秒恢复）
//   origin-story submit  <pkg> <chapter.json>        提交一章（正文+事务，过门禁才落盘）
//   origin-story check   <pkg> <chapter.json>        预检一章，不落盘
//   origin-story hooks   <pkg>                       伏笔图谱
//   origin-story outline <pkg>                       章节登记表
//   origin-story seq     <pkg>                       当前事务水位
//
// 输出约定与 origin CLI 一致：stdout 只出结果数据，stderr 出人看的说明，
// --json 出机器读的结构，退出码 0 成功 / 1 有错 / 2 用法错。

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initWriter, projectState, submitChapter, checkChapter, hookGraph, seqOf } from './engine.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const VERSION = (() => {
  try { return JSON.parse(readFileSync(join(HERE, '..', '..', 'package.json'), 'utf8')).version }
  catch { return '0.0.0' }
})()

const USAGE = `origin-story ${VERSION} —— 百万字小说写作引擎（Story 方言）

写作是事务性的：AI 每写一章 = 提交一个语义事务（正文 + 状态变更声明），
门禁逐条复核（禁区/约束/伏笔状态机/正文对照状态），通过才落盘。
角色不会突然用上他不知道的信息，物品不会凭空易主，伏笔不会收了又埋。

读：
  origin-story state   <pkg> [--task 任务]   世界状态投影——新会话第一件事
  origin-story hooks   <pkg>                 伏笔图谱（已埋/待收/已收）
  origin-story outline <pkg>                 章节登记表（章号/字数/提交时间）
  origin-story seq     <pkg>                 当前事务水位（提交时当 expect_seq 传回）

写（唯一）：
  origin-story init    <specDir> <pkg>       从世界规格建写作包
  origin-story submit  <pkg> <tx.json>       提交一章，过门禁才落盘
  origin-story check   <pkg> <tx.json>       预检一章，不落盘（先试后交）

选项：
  --json     结构化输出（AI 用）
  -q         只出结果
  --version / -h

事务文件形状（chapter.json）：
  { "chapter": 11, "text": "…本章正文…",
    "state_changes": [{"object":"obj:black-key","field":"holder","from":"char:zhao-qi","to":"char:lin-zheng","basis":["scene:11-07"]}],
    "creates": [{"id":"char:xx","type":"char"}],
    "assertions": ["zhao-qi-alive"], "hooks": [{"id":"hook:xx","status":"planted_unresolved"}] }

示例：
  origin-story init   world/spec.origin  novel.origin
  origin-story state  novel.origin --task "第 11 章：林峥在渡口镇找赵七"
  S=$(origin-story seq novel.origin) && origin-story submit novel.origin ch11.json --expect $S`

const flags = new Set()
const opts = {}
const args = []
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (['--task', '--expect', '--by', '--until'].includes(a)) opts[a.slice(2)] = process.argv[++i]
  else if (a.startsWith('-')) flags.add(a)
  else args.push(a)
}
const JSON_MODE = flags.has('--json')
const QUIET = flags.has('-q')
const note = (m) => { if (!QUIET && !JSON_MODE) process.stderr.write(m + '\n') }

function die(code, msg) {
  if (JSON_MODE) process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n')
  else process.stderr.write('错误：' + msg + '\n')
  process.exit(code)
}

function emit(payload, tsv) {
  if (JSON_MODE) process.stdout.write(JSON.stringify({ ok: true, ...payload }) + '\n')
  else tsv()
}

const COMMANDS = {
  init() {
    const [specDir, pkg] = args.slice(1)
    if (!specDir || !pkg) die(2, '用法：init <specDir> <pkg> [--until 章号]')
    const until = opts.until === undefined ? null : Number(opts.until)
    initWriter(pkg, specDir, { untilChapter: until })
    emit({ pkg, spec: specDir, replayed_until: until ?? 'end' }, () => note(`✓ 已建写作包 ${pkg}（来自 ${specDir}，世界重放到第 ${until ?? '全部'} 章）`))
  },

  state() {
    const pkg = args[1]
    if (!pkg) die(2, '用法：state <pkg> [--task 任务]')
    const text = projectState(pkg, { task: opts.task ?? null })
    if (JSON_MODE) process.stdout.write(JSON.stringify({ ok: true, state: text }) + '\n')
    else process.stdout.write(text + '\n')
  },

  submit() {
    const pkg = args[1]
    const src = args[2]
    if (!pkg || !src) die(2, '用法：submit <pkg> <tx.json> [--expect SEQ] [--by 责任者]')
    let tx
    try { tx = JSON.parse(readFileSync(src, 'utf8')) }
    catch (e) { die(2, `事务读取或解析失败：${e.message}`) }
    const r = submitChapter(pkg, tx, { by: opts.by ?? 'origin-writer', expect_seq: opts.expect === undefined ? null : Number(opts.expect) })
    if (!r.ok) {
      if (JSON_MODE) process.stdout.write(JSON.stringify({ ok: false, violations: r.violations, conflict: r.conflict ?? null }) + '\n')
      else {
        for (const v of r.violations) process.stdout.write(`${v.severity ?? 'error'}\t${v.code ?? '-'}\t${v.msg}\n`)
        note(`✗ 未落盘（${r.errors} 条错误）——按上面的理由重写事务再提交`)
      }
      process.exit(1)
    }
    emit({ receipt: r.receipt }, () => {
      note(`✓ 第 ${r.receipt.chapter} 章已落盘 seq ${r.receipt.seq_from}–${r.receipt.seq_to}，${r.receipt.chars} 字，正文存 ${r.receipt.text_file}`)
      for (const ref of r.receipt.changed) process.stdout.write(`changed\t${ref}\n`)
    })
  },

  check() {
    const pkg = args[1]
    const src = args[2]
    if (!pkg || !src) die(2, '用法：check <pkg> <tx.json>')
    let tx
    try { tx = JSON.parse(readFileSync(src, 'utf8')) }
    catch (e) { die(2, `事务读取或解析失败：${e.message}`) }
    const r = checkChapter(pkg, tx, { by: opts.by ?? 'origin-writer' })
    if (JSON_MODE) process.stdout.write(JSON.stringify({ ok: r.ok, violations: r.violations, errors: r.errors }) + '\n')
    else if (r.ok) note('✓ 预检通过，可以提交')
    else {
      for (const v of r.violations) process.stdout.write(`${v.severity ?? 'error'}\t${v.code ?? '-'}\t${v.msg}\n`)
      note(`✗ 预检未通过（${r.errors} 条错误）`)
      process.exit(1)
    }
  },

  hooks() {
    const pkg = args[1]
    if (!pkg) die(2, '用法：hooks <pkg>')
    const hooks = hookGraph(pkg)
    emit({ hooks }, () => {
      if (!hooks.length) return note('无伏笔。')
      note('id\tstatus\t埋设章\t回收章\t层级\tsummary')
      for (const h of hooks) process.stdout.write(`${h.id}\t${h.status}\t${h.setup_chapter ?? '-'}\t${h.payoff_chapter ?? '-'}\t${h.tier ?? '-'}\t${String(h.summary).slice(0, 40)}\n`)
      const open = hooks.filter((h) => h.status === 'planted_unresolved').length
      note(`共 ${hooks.length} 条伏笔，${open} 条待收。`)
    })
  },

  outline() {
    const pkg = args[1]
    if (!pkg) die(2, '用法：outline <pkg>')
    const path = join(pkg, 'narrative', 'chapters', 'outline.jsonl')
    if (!existsSync(path)) { emit({ chapters: [] }, () => note('尚无已提交章节。')); return }
    const rows = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
    emit({ chapters: rows }, () => {
      note('章\t字数\t提交时间\tby\ttx')
      for (const r of rows) process.stdout.write(`${r.chapter}\t${r.chars}\t${r.at}\t${r.by}\t${r.tx ?? '-'}\n`)
    })
  },

  seq() {
    const pkg = args[1]
    if (!pkg) die(2, '用法：seq <pkg>')
    emit({ seq: seqOf(pkg) }, () => process.stdout.write(String(seqOf(pkg)) + '\n'))
  },
}

if (flags.has('--version')) { process.stdout.write(VERSION + '\n'); process.exit(0) }
const wantsHelp = flags.has('-h') || flags.has('--help')
if (wantsHelp || !args.length) { process.stdout.write(USAGE + '\n'); process.exit(wantsHelp ? 0 : 2) }

const cmd = args[0]
if (!COMMANDS[cmd]) die(2, `未知子命令「${cmd}」。可用：${Object.keys(COMMANDS).join(' / ')}`)
try { COMMANDS[cmd]() } catch (e) { die(1, e.message) }
