#!/usr/bin/env node
// 回填 —— 把项目已有的历史导进记忆包。
//
//   node adapters/memory/backfill.mjs <包路径> [--git] [--decisions <file.json>]
//
// 分两类，**刻意不混在一起**：
//
//   --git        每条提交导成一个 fact:，evidence 是 commit sha。
//                这是确定性的：机器读 git log，没有任何判断成分，谁都能复核。
//
//   --decisions  从一份 JSON 导入决策。**这些是人（或 AI）读文档后归纳出来的**，
//                不是机器提取的。所以责任者一律记为 `<who>@backfill`，
//                将来 origin why 查到它时会看到「这条是事后补记的」，
//                而不是误以为当时就是这么记录的。
//
// 这个区分不是形式主义：一个记不清自己哪些内容是补的、哪些是当时记的系统，
// 三个月后没人敢信它——而「敢不敢信」正是这套东西存在的全部理由。

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { commit, seqOf } from '../../compiler/store.mjs'

const args = process.argv.slice(2)
const pkg = args[0]
if (!pkg || pkg.startsWith('-')) {
  process.stderr.write('用法：backfill.mjs <包路径> [--git] [--decisions <file.json>]\n')
  process.exit(2)
}
const flag = (name) => args.includes(name)
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const repo = opt('--repo') ?? process.cwd()

/** git log → fact: 对象。每条提交自带 sha 作为证据，符合方言的 fact-evidence 约束。 */
function gitFacts() {
  const raw = execFileSync('git', ['log', '--reverse', '--date=short', '--format=%h\x1f%ad\x1f%s'], {
    cwd: repo, encoding: 'utf8', maxBuffer: 8 << 20,
  })
  const creates = [], changes = []
  for (const line of raw.split('\n').filter(Boolean)) {
    const [sha, date, subject] = line.split('\x1f')
    if (!sha) continue
    const id = `fact:commit-${sha}`
    creates.push({ id, type: 'fact' })
    changes.push(
      { object: id, field: 'summary', to: subject },
      { object: id, field: 'at', to: date },
      { object: id, field: 'kind', to: 'observed' },
      { object: id, field: 'evidence', to: `git:${sha}` },
    )
  }
  return { creates, changes, count: creates.length }
}

/**
 * 条目 JSON → 对象。形如 `[{ id, type, fields: {…} }]`。
 * 不为 decision 特设分支——方言的五类对象走同一条路径，
 * 缺字段由方言约束当场拦下（比如决策没写 rationale），不在这里另写一套校验。
 */
function entriesFrom(file) {
  const list = JSON.parse(readFileSync(file, 'utf8'))
  const creates = [], changes = []
  for (const e of list) {
    const id = e.id.includes(':') ? e.id : `${e.type}:${e.id}`
    creates.push({ id, type: e.type })
    for (const [field, to] of Object.entries(e.fields ?? {})) changes.push({ object: id, field, to })
  }
  return { creates, changes, count: creates.length }
}

const jobs = []
if (flag('--git')) jobs.push(['git-history', gitFacts(), 'git-log@backfill'])
const dFile = opt('--entries') ?? opt('--decisions')
if (dFile) jobs.push(['entries', entriesFrom(dFile), `${process.env.USERNAME ?? 'human'}@backfill`])

if (!jobs.length) {
  process.stderr.write('什么都没指定。加 --git 或 --entries <file.json>\n')
  process.exit(2)
}

for (const [name, batch, by] of jobs) {
  if (!batch.count) { process.stderr.write(`${name}：无内容，跳过\n`); continue }
  const r = commit(pkg, {
    transaction_id: `tx-backfill-${name}`,
    operation: 'backfill',
    target: name,
    creates: batch.creates,
    state_changes: batch.changes,
  }, { by, expectedSeq: seqOf(pkg) })

  if (!r.ok) {
    process.stderr.write(`${name} 回填被拒绝，未写入任何内容：\n`)
    for (const v of r.violations.slice(0, 10)) process.stderr.write(`  - ${v.msg}\n`)
    if (r.violations.length > 10) process.stderr.write(`  …另有 ${r.violations.length - 10} 条\n`)
    process.exit(1)
  }
  process.stderr.write(`${name}：${batch.count} 个对象，${r.receipt.seq_to - r.receipt.seq_from + 1} 条记录，责任者 ${by}\n`)
}

process.stdout.write(String(seqOf(pkg)) + '\n')
