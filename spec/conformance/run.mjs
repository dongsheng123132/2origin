#!/usr/bin/env node
// 一致性测试运行器——本象协议的合规判定入口。
//
// 这个文件存在的理由，就是「协议」与「一个碰巧能跑的程序」的分界线：
// 在它之前，本仓库只能证明**这一份 JS 实现**自洽（npm run verify）；
// 别人用 Python 或 Rust 写一份，无从证明对不对，那叫参考实现，不叫协议。
// 有了它，任何语言的实现只要实现一个适配器，就能自证合规——
// 测试向量是数据，不是代码，不依赖任何宿主语言。
//
//   node spec/conformance/run.mjs                      # 测参考实现
//   node spec/conformance/run.mjs --adapter "python3 my_adapter.py"
//   node spec/conformance/run.mjs --json               # 机器可读
//   node spec/conformance/run.mjs --level core         # 只测某一级
//
// 遵循 ai-cli-design：stdout 只出数据，stderr 出说明，退出码 0 合规 / 1 不合规 / 2 用法错。

import { spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const VECTORS = join(HERE, 'vectors')
const ROOT = join(HERE, '..', '..')

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const asJson = argv.includes('--json')
const verbose = argv.includes('--v')
const onlyLevel = flag('--level')
const onlyChapter = flag('--chapter')
const adapterCmd = flag('--adapter', `node ${join(ROOT, 'compiler', 'conformance-adapter.mjs')}`)

if (argv.includes('--help') || argv.includes('-h')) {
  console.error(`用法: run.mjs [--adapter "<命令>"] [--level core|full] [--chapter <前缀>] [--json] [--v]

适配器契约（任何语言实现均可）：
  stdin  ← {"version":1,"cases":[{"id":"…","op":"…","input":{…}},…]}
  stdout → {"results":[{"id":"…","output":{…}},…]}
  实现不了的 op 请回 {"id":"…","unsupported":true}——如实报告，不要瞎猜。
详见 spec/conformance/README.md`)
  process.exit(2)
}

// ── 装载测试向量 ────────────────────────────────────────────────────────
const files = readdirSync(VECTORS).filter((f) => f.endsWith('.json')).sort()
const chapters = []
for (const f of files) {
  const ch = JSON.parse(readFileSync(join(VECTORS, f), 'utf8'))
  if (onlyChapter && !f.startsWith(onlyChapter)) continue
  const cases = (ch.cases ?? []).filter((c) => !onlyLevel || (c.level ?? ch.level ?? 'core') === onlyLevel)
  if (cases.length) chapters.push({ file: f, ...ch, cases })
}
const allCases = chapters.flatMap((ch) => ch.cases.map((c) => ({ ...c, chapter: ch.title, file: ch.file })))
if (!allCases.length) {
  console.error('✗ 没有匹配的测试向量')
  process.exit(2)
}

// ── 驱动适配器 ──────────────────────────────────────────────────────────
const request = { version: 1, cases: allCases.map((c) => ({ id: c.id, op: c.op, input: c.input })) }

const raw = await new Promise((resolve, reject) => {
  const child = spawn(adapterCmd, { shell: true, stdio: ['pipe', 'pipe', 'inherit'] })
  let out = ''
  child.stdout.on('data', (d) => (out += d))
  child.on('error', reject)
  child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`适配器退出码 ${code}`))))
  child.stdin.end(JSON.stringify(request))
}).catch((e) => {
  console.error(`✗ 适配器无法运行：${e.message}\n   命令：${adapterCmd}`)
  process.exit(2)
})

let parsed
try {
  parsed = JSON.parse(raw)
} catch {
  console.error(`✗ 适配器输出不是合法 JSON（前 200 字）：\n${String(raw).slice(0, 200)}`)
  process.exit(2)
}
const byId = new Map((parsed.results ?? parsed).map((r) => [r.id, r]))

// ── 比对 ────────────────────────────────────────────────────────────────
// expect 是**子集断言**：只比对 expect 里写出来的键，没写的不管。
// 这样新增可选字段不会让既有向量集体失效——但写出来的键必须完全相等，
// 不做「包含即通过」的模糊匹配，否则断言会在不知不觉中变松。
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
  }
  return v
}
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))

function diffKeys(expect, got) {
  const bad = []
  for (const k of Object.keys(expect)) {
    // codes / warnings 的产出顺序不属于协议约定，比对前排序；其余一律按原样比
    const e = Array.isArray(expect[k]) && (k === 'codes' || k === 'warnings') ? [...expect[k]].sort() : expect[k]
    const g = Array.isArray(got?.[k]) && (k === 'codes' || k === 'warnings') ? [...got[k]].sort() : got?.[k]
    if (!eq(e, g)) bad.push({ key: k, want: e, got: g })
  }
  return bad
}

const results = []
for (const c of allCases) {
  const r = byId.get(c.id)
  if (!r) results.push({ ...c, status: 'missing' })
  else if (r.unsupported) results.push({ ...c, status: 'unsupported' })
  else if (r.error) results.push({ ...c, status: 'error', detail: r.error })
  else {
    const bad = diffKeys(c.expect ?? {}, r.output ?? {})
    results.push({ ...c, status: bad.length ? 'fail' : 'pass', bad })
  }
}

const count = (s) => results.filter((r) => r.status === s).length
const passed = count('pass')
const failed = count('fail') + count('missing') + count('error')
const skipped = count('unsupported')

// ── 报告 ────────────────────────────────────────────────────────────────
if (asJson) {
  console.log(JSON.stringify({
    adapter: adapterCmd,
    total: results.length, passed, failed, unsupported: skipped,
    conformant: failed === 0 && skipped === 0,
    results: results.map(({ id, chapter, spec, status, bad, detail }) => ({ id, chapter, spec, status, bad, detail })),
  }, null, 2))
  process.exit(failed ? 1 : 0)
}

console.error(`适配器：${adapterCmd}`)
for (const ch of chapters) {
  const mine = results.filter((r) => r.file === ch.file)
  const bad = mine.filter((r) => r.status !== 'pass')
  console.log(`\n${ch.title}　${mine.length - bad.length}/${mine.length}`)
  for (const r of mine) {
    if (r.status === 'pass') {
      if (verbose) console.log(`  ✓ ${r.id}`)
      continue
    }
    const mark = { fail: '✗', missing: '?', error: '!', unsupported: '⊘' }[r.status]
    console.log(`  ${mark} ${r.id}　${r.why ?? ''}${r.spec ? `　[${r.spec}]` : ''}`)
    if (r.status === 'unsupported') console.log('      适配器声明未实现该 op')
    if (r.detail) console.log(`      适配器报错：${r.detail}`)
    for (const b of r.bad ?? []) {
      console.log(`      ${b.key}：\n        期望 ${JSON.stringify(b.want)}\n        实得 ${JSON.stringify(b.got)}`)
    }
  }
}

console.log(`\n合计 ${results.length} 项：通过 ${passed}，失败 ${failed}${skipped ? `，未实现 ${skipped}` : ''}`)
if (failed) {
  console.error('\n✗ 不合规——上列各项即为与协议的偏差')
  process.exit(1)
}
if (skipped) {
  console.error(`\n⚠ 部分合规：${skipped} 项适配器声明未实现。未实现不等于通过，不得据此声称合规。`)
  process.exit(1)
}
console.error('\n✓ 合规：全部一致性向量通过')
