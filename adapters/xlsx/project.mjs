#!/usr/bin/env node
// 本象包 → xlsx。「一源万影」的**影**这一侧。
//
//   node adapters/xlsx/project.mjs <包路径> <输出.xlsx> [--by 谁] [--no-disclosure]
//
// 到这一步，整条回路才闭合：
//
//   xlsx ──导入──▶ 本象包 ──投影──▶ xlsx
//                    │
//                    ├─ AI 提事务改一个数（校验不过一字节不写）
//                    └─ 每个值都答得出「凭什么」
//
// 有了它，「Excel 只是影子」才不是一句口号——影子**真的是从本象生成出来的**，
// 而且生成时会把丢了什么当面说清楚。
//
// ## xlsx 装不下什么（这正是投影必须披露的）
//
// 本象包里每个格子带着一串诊断结论与来源：这格曾是公式却被人填死（hardcoded_in_block）、
// 这个 SUM 漏了紧邻那行（range_gap）、这个值改过几次分别由谁改的（provenance）。
// **xlsx 一样都装不下。** 写出去之后它就是一张普通表格，和任何导出件没有区别。
//
// 有损不是问题，假装无损才是。所以投影件默认多带一张「投影披露」表，
// 把丢弃清单和来源 seq 写在里面——让拿到这份文件的人（和 AI）知道该回哪里问。

import { writeFileSync, readFileSync } from 'node:fs'
import { loadOrigin } from '../../compiler/origin.mjs'
import { appendHistory } from '../../compiler/store.mjs'
import { planProjection, disclosure, projectionRecord } from '../../compiler/project.mjs'
import { buildXlsx } from './write.mjs'

/** xlsx 这个格式**真正装得下**的字段。其余一律进丢弃清单，不偷偷带走也不假装没有。 */
export const XLSX_CARRIES = ['sheet', 'ref', 'row', 'col', 'kind', 'value', 'formula', 'label']

/** 一个本象里的格子对象 → write.mjs 认的单元格描述 */
export function toCell(o) {
  if (o._type === 'header') return `s:${o.label ?? ''}`
  if (o.kind === 'formula') {
    const isErr = typeof o.value === 'string' && o.value.startsWith('#')
    return { f: o.formula, v: o.value, ...(isErr ? { e: true } : {}) }
  }
  if (o.kind === 'input') return typeof o.value === 'number' ? o.value : Number(o.value)
  if (o.kind === 'text') {
    const isErr = typeof o.value === 'string' && o.value.startsWith('#')
    return isErr ? { v: o.value, e: true } : `s:${o.value ?? ''}`
  }
  return null
}

/**
 * 事务改过输入格之后，哪些公式格的**缓存值已经过期**。
 *
 * 这是投影这一侧最容易出人命的地方：xlsx 里每个公式格存的是「公式 + 上次算出来的值」。
 * 事务把 C5 从 75 改成 82，D5 的公式还是 `=B5-C5`，但它存的值仍是按 75 算出来的 55。
 * Excel 打开时会重算，所以**人看不见**；可任何程序读这个文件，读到的就是 55。
 *
 * 本象不重算——重算需要一个完整的公式引擎（decision:zero-deps，而且那是 pycel 干的活）。
 * 但本象**手里有依赖图**，它知道哪些格子失效了。知道而不说，就是在发一份自己知道有错的文件。
 *
 * 所以这里顺着 depends_on 反向传播，把受影响的公式格全找出来，写进披露。
 */
export function staleCells(origin) {
  const changed = new Set(
    (origin.history ?? [])
      .filter((e) => e?.event === 'state_change' && e.field === 'value')
      .map((e) => e.object),
  )
  if (!changed.size) return []

  // 反向依赖：被依赖者 → 依赖它的那些格子
  const dependents = new Map()
  for (const r of origin.relations ?? []) {
    if (r.predicate !== 'depends_on') continue
    if (!dependents.has(r.object)) dependents.set(r.object, [])
    dependents.get(r.object).push(r.subject)
  }

  const stale = new Set()
  const queue = [...changed]
  const seen = new Set(changed)
  while (queue.length) {
    for (const up of dependents.get(queue.shift()) ?? []) {
      if (seen.has(up)) continue
      seen.add(up)
      if (origin.state?.[up]?.kind === 'formula') stale.add(up)
      queue.push(up)
    }
  }
  return [...stale].sort()
}

/**
 * 把本象包投影成一份 xlsx。
 * @returns { buffer, plan } —— plan 里带着丢弃清单，调用方有义务处理它
 */
export function projectToXlsx(origin, { id = 'xlsx-projection', includeDisclosure = true } = {}) {
  const plan = planProjection(origin, {
    id, format: 'xlsx',
    select: ['sheet:*', 'cell:*', 'header:*'],
    carries: XLSX_CARRIES,
  })

  // 缓存值过期的公式格：知道而不说，等于发一份自己知道有错的文件
  const stale = staleCells(origin)
  if (stale.length)
    plan.dropped.push({
      code: 'stale-cached-value',
      what: `${stale.length} 个公式格的缓存值已过期`,
      count: stale.length,
      why: '事务改了它们依赖的输入格，而本象不重算公式（Excel 打开时会重算，但程序直接读到的是旧值）',
      sample: stale.slice(0, 5),
    })
  plan.lossless = plan.dropped.length === 0

  // 表的顺序取 sheet 对象在包里的出场顺序——objects.jsonl 是出生证明，顺序即原始顺序
  const order = origin.objects.filter((o) => o.type === 'sheet').map((o) => o.name)
  const bySheet = new Map(order.map((n) => [n, {}]))

  for (const oid of plan.selected) {
    const o = plan.objects[oid]
    if (o._type !== 'cell' && o._type !== 'header') continue
    const name = o.sheet
    if (!bySheet.has(name)) { bySheet.set(name, {}); order.push(name) }
    const cell = toCell(o)
    if (cell !== null) bySheet.get(name)[o.ref] = cell
  }

  const sheets = order.map((name) => ({ name, rows: bySheet.get(name) ?? {} }))

  // 披露表：跟着文件走，而不是留在生成它的那台机器上
  if (includeDisclosure) {
    sheets.push({
      name: '投影披露',
      rows: [
        ['s:这份文件是本象包的投影，不是本体'],
        [],
        ...disclosure(plan).split('\n').map((line) => [`s:${line}`]),
        [],
        ['s:来源 seq', plan.at_seq],
        ['s:对象数', plan.selected.length],
        ['s:无损', `s:${plan.lossless ? '是' : '否'}`],
      ],
    })
  }

  return { buffer: buildXlsx(sheets), plan }
}

// ── CLI ─────────────────────────────────────────────────────────
if (process.argv[1]?.includes('project.mjs') && process.argv[1]?.includes('xlsx')) {
  const [dir, out] = process.argv.slice(2)
  if (!dir || !out) {
    process.stderr.write('用法：project.mjs <包路径> <输出.xlsx> [--by 谁] [--no-disclosure]\n')
    process.exit(2)
  }
  const opt = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d }
  const origin = loadOrigin(dir)
  const { buffer, plan } = projectToXlsx(origin, { includeDisclosure: !process.argv.includes('--no-disclosure') })
  writeFileSync(out, buffer)

  // 投影事件入包：这份发出去的文件是从哪个版本的世界生成的，包里查得到。
  // 没有这一条，投影件流出去就与本象失联了，和普通导出没有区别。
  appendHistory(dir, [projectionRecord(plan, { by: opt('--by', 'xlsx-project'), output: out })])

  process.stderr.write(`投影 ${plan.selected.length} 个对象 → ${out}（来源 seq ${plan.at_seq}）\n`)
  if (!plan.lossless) {
    process.stderr.write('⚠ 这是一份有损投影，以下信息没能带走：\n')
    for (const d of plan.dropped) process.stderr.write(`   · ${d.what}（${d.count}）——${d.why}\n`)
  }
  process.stdout.write(out + '\n')
}
