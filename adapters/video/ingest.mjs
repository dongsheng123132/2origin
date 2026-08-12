#!/usr/bin/env node
// 把平台回传的逐秒留存，变成 basis=measured 的估值 —— 整个体系唯一的接地点
//
// ## 为什么这是最重要的一个脚本
//
// 校验器每次都报「100% 的估值是不可复核的断言」。那不是标注不够努力，
// 是**缺了构成"价值"的另一半——受众**。这个脚本补上那一半。
//
// ## 但留存本身也是代理（先过 A6 的 Q0）
//
// X = 留存率，Y = 内容价值。举反例：
//
//   1. **位置效应压倒内容**。留存曲线单调递减，第一段永远最高。
//      直接拿各段留存排序，量的是位置不是内容。
//      → 修法：用**相对流失速率**（该段每秒掉多少人 ÷ 全片平均），不用绝对留存。
//   2. **结尾 CTA 留存低，但那是唯一转化点**。留存低 ≠ 没价值。
//      → 修法：CTA 段的 measured 估值只作参考，转化要另测（本脚本测不了）。
//   3. **前 1–2 秒的高留存来自平台强制曝光**，用户还没反应过来。
//      → 修法：默认丢弃前 2 秒（--skip-head）。
//
// 三条全部写进产出的 limits，不假装没有。
//
// 用法:
//   node ingest.mjs <timeline.json> --projection douyin_60s --retention data.csv [--write]
//
//   data.csv 格式（抖音/视频号后台可导出，或从留存曲线读点）：
//     second,pct
//     0,100
//     1,96.2
//     ...

import { readFileSync, writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1] }
const tlPath = argv.find(a => !a.startsWith('--'))
const PROJ = arg('--projection', null)
const DATA = arg('--retention', null)
const SKIP = parseFloat(arg('--skip-head', '2'))
const SRC_LABEL = arg('--source', '平台后台逐秒留存')
const WRITE = argv.includes('--write')

if (!tlPath || !PROJ || !DATA) {
  console.error('用法: node ingest.mjs <timeline.json> --projection <name> --retention <csv> [--write]')
  process.exit(2)
}
const tl = JSON.parse(readFileSync(tlPath, 'utf8'))
const p = tl.projections?.[PROJ]
if (!p) { console.error(`没有投影 ${PROJ}`); process.exit(1) }
if (!p.audience) { console.error(`投影 ${PROJ} 没声明 audience，无法归属估值`); process.exit(1) }

// ── 读留存
const rows = readFileSync(DATA, 'utf8').trim().split(/\r?\n/).slice(1)
  .map(l => l.split(/[,\t]/).map(Number)).filter(r => r.length >= 2 && Number.isFinite(r[0]))
  .sort((a, b) => a[0] - b[0])
if (rows.length < 5) { console.error('留存数据点太少（<5），不做推断'); process.exit(1) }
const ret = new Map(rows.map(([s, v]) => [s, v]))
const at = s => {
  if (ret.has(s)) return ret.get(s)
  const before = rows.filter(r => r[0] <= s).pop(), after = rows.find(r => r[0] >= s)
  if (!before) return after?.[1] ?? null
  if (!after) return before[1]
  const [s0, v0] = before, [s1, v1] = after
  return s1 === s0 ? v0 : v0 + (v1 - v0) * (s - s0) / (s1 - s0)
}

// ── 输出时间 → 源时间：pick 顺序即拼接顺序
const total = p.pick.reduce((a, [s, e]) => a + (e - s), 0)
const map = []          // {out0, out1, src0, src1}
let cur = 0
for (const [s, e] of p.pick) { map.push({ out0: cur, out1: cur + (e - s), src0: s, src1: e }); cur += e - s }

// ── 全片平均流失速率（跳过头部曝光噪声）
const head = at(SKIP), tail = at(Math.min(total, rows[rows.length - 1][0]))
const span = Math.max(1e-6, total - SKIP)
const avgDrop = (head - tail) / span          // 每秒掉多少个百分点
if (!(avgDrop > 0)) console.error('⚠ 全片流失速率 ≤0，数据可能有问题，结果不可信')

console.log(`投影 ${PROJ}（受众 ${p.audience}）  ${p.pick.length} 段 / ${total.toFixed(1)}s`)
console.log(`留存 ${rows[0][1].toFixed(1)}% → ${tail.toFixed(1)}%   平均流失 ${avgDrop.toFixed(2)} 点/秒（已跳过前 ${SKIP}s）\n`)
console.log('段  源区间           留存      流失/秒   相对留住   我的断言   偏差')
console.log('─'.repeat(74))

const news = []
for (const [i, m] of map.entries()) {
  const a0 = Math.max(m.out0, SKIP)
  if (m.out1 - a0 < 1) { console.log(`${i + 1}  ${m.src0}-${m.src1}s  （落在跳过区，不评）`); continue }
  const v0 = at(a0), v1 = at(m.out1)
  const drop = (v0 - v1) / (m.out1 - a0)
  // 相对留住：0.5 = 与全片平均一致；>0.5 留得比平均好
  const hold = avgDrop > 0 ? Math.max(0, Math.min(1, 0.5 * (1 + (avgDrop - drop) / avgDrop))) : 0.5

  // 该段覆盖了哪些事件（按时间重叠取主要那个）
  const ovl = tl.events.map(e => ({ e, o: Math.max(0, Math.min(e.t[1], m.src1) - Math.max(e.t[0], m.src0)) }))
    .filter(x => x.o > 0).sort((a, b) => b.o - a.o)
  const ev = ovl[0]?.e
  const prior = tl.appraisals.find(x => x.event === ev?.id && x.audience === p.audience && x.basis === 'asserted')
  const delta = prior ? hold - prior.value : null

  console.log(
    `${i + 1}  ${String(m.src0).padStart(6)}-${String(m.src1).padEnd(7)} ` +
    `${v0.toFixed(1)}→${v1.toFixed(1)}%  ${drop.toFixed(2)}     ${hold.toFixed(2)}      ` +
    `${prior ? prior.value.toFixed(2) : '  — '}      ${delta == null ? '' : (delta >= 0 ? '+' : '') + delta.toFixed(2)}` +
    `  ${ev?.id ?? ''}`)

  if (ev) news.push({
    event: ev.id, audience: p.audience, value: +hold.toFixed(3), basis: 'measured',
    by: SRC_LABEL, as_of: new Date(readFileSync(DATA).length && Date.parse('2026-08-09')).toISOString().slice(0, 10),
    reason: `投影 ${PROJ} 第 ${i + 1} 段实测：留存 ${v0.toFixed(1)}%→${v1.toFixed(1)}%，` +
      `流失 ${drop.toFixed(2)} 点/秒 vs 全片平均 ${avgDrop.toFixed(2)}`,
    evidence: [`${DATA} 第 ${a0.toFixed(0)}–${m.out1.toFixed(0)} 秒`, `投影 ${PROJ} pick[${i}] → ${ev.ref}`],
  })
}

const wrong = news.filter(n => {
  const prior = tl.appraisals.find(x => x.event === n.event && x.audience === n.audience && x.basis === 'asserted')
  return prior && Math.abs(prior.value - n.value) > 0.25
})
console.log('')
console.log(`产出 ${news.length} 条 basis=measured 的估值` +
  (wrong.length ? `，其中 ${wrong.length} 条与我的断言偏差 >0.25：${wrong.map(w => w.event).join(' ')}` : ''))

if (WRITE) {
  tl.appraisals.push(...news)          // 追加，不删旧断言 —— A5 要的可对比记录
  tl.limits.push({
    code: `M-RETENTION-${PROJ.toUpperCase()}`, kind: 'unverified',
    scope: `appraisals[audience=${p.audience}, basis=measured]`,
    statement: '留存率本身是代理，不是价值（A6）。三条已知失效域：'
      + '① 留存曲线单调递减，位置效应压倒内容——本脚本已用「相对流失速率」校正，但校正不完美；'
      + `② 结尾 CTA 段留存必然低，而那是唯一转化点，它的 measured 分不代表没价值；`
      + `③ 前 ${SKIP} 秒留存受平台强制曝光影响，已丢弃。`
      + '此外本次只有一条投放的数据，无法区分内容效应与账号/时段/推荐随机性。',
    remedy: '同一版本多次投放取中位；转化另用下单数据测；跨版本比较用 A/B 而非绝对值',
  })
  writeFileSync(tlPath, JSON.stringify(tl, null, 2))
  console.log(`已写回 ${tlPath}（追加 ${news.length} 条 measured，旧断言保留）`)
} else {
  console.log('加 --write 写回。')
}
