#!/usr/bin/env node
// 量刑：把「判几个月」写成一串带依据的语义事务。
//
//   node adapters/law/import.mjs 判决书.txt pkg.origin --staged
//   node adapters/law/sentence.mjs pkg.origin --declare 7 --by 承办法官-李
//   node compiler/cli.mjs why pkg.origin case:xxx.调节比例合计
//
// ## 为什么非要走事务，不能一次算完
//
// 一次算完，包里只留下一个数字「宣告刑七个月」。问「凭什么是七个月」，
// 答案永远只有一句：凭导入。而判决书今天给出的正是这个答案——
// 「综合考虑本案情节，依法从轻处罚」，中间量一个不留，谁也无法复算。
//
// 走事务则每一步都留下 { from, to, kind: derived, basis: [法条, 证据, 情节] }，
// `origin why` 直接吐出从基准刑到宣告刑的完整链条。这才是「有据可查」的字面形态。
//
// 调节方法用指导意见规定的**同向相加、逆向相减**（不是连乘），
// 最后一步在 20% 幅度内确定宣告刑——超出幅度时提交编译器当场拒绝，一个字节都不写。

import { loadOrigin } from '../../compiler/origin.mjs'
import { commit } from '../../compiler/store.mjs'
import { seqOf } from '../../compiler/store.mjs'
import { FACTORS, DECLARED_TOLERANCE } from './dialect.mjs'

const r2 = (n) => Math.round(n * 100) / 100
const r4 = (n) => Math.round(n * 10000) / 10000

/**
 * 逐个情节调节基准刑，最后按 declared 确定宣告刑。
 * @returns { steps: [...每步的提交回执], ok, rejected }  被拒时 rejected 带违规理由
 */
export function runSentencing(dir, { declared, by = 'sentencing', log = () => {} }) {
  const origin = loadOrigin(dir)
  const caseId = Object.keys(origin.state).find((id) => id.startsWith('case:'))
  if (!caseId) throw new Error('包里没有 case: 对象——先用 import.mjs 导入判决书')

  const base = origin.state[caseId]?.基准刑月
  if (!Number.isFinite(base)) throw new Error(`${caseId}.基准刑月 缺失——量刑评议表没提供基准刑，无法复算`)

  const factors = Object.entries(origin.state)
    .filter(([id, o]) => id.startsWith('factor:') && Number.isFinite(o?.ratio))
    .map(([id, o]) => ({ id, ...o }))

  const steps = []
  // 字段还不存在时不要声明 from——声明 0 而实际是 undefined 会被记成一次「模型记忆偏差」，
  // 把干净的量刑链染上一条假的偏差记录，偏差率这个指标就不能用了。
  let hasAcc = '调节比例合计' in (origin.state[caseId] ?? {})
  let acc = origin.state[caseId]?.调节比例合计 ?? 0

  // ── 逐个情节：同向相加、逆向相减 ──
  for (const f of factors) {
    const next = r4(acc + f.ratio)
    const need = FACTORS[f.name]?.requires_law
    const tx = {
      transaction_id: `tx-量刑-${f.id.replace('factor:', '')}`,
      operation: `适用量刑情节「${f.name}」${f.ratio < 0 ? '从宽' : '从严'} ${Math.abs(f.ratio * 100).toFixed(0)}%`,
      target: caseId,
      state_changes: [{
        object: caseId, field: '调节比例合计', ...(hasAcc ? { from: acc } : {}), to: next,
        kind: 'derived',
        // 依据三件套：认定了哪个情节、凭哪份证据、依哪条法——缺一条这一步就说不清
        basis: [f.id, ...(f.basis ?? []), need, 'guide:法发2021-21/3'].filter(Boolean),
      }],
    }
    const res = commit(dir, tx, { by, expectedSeq: seqOf(dir) })
    if (!res.ok) return { ok: false, rejected: { step: f.id, violations: res.violations }, steps }
    steps.push({ factor: f.id, name: f.name, ratio: f.ratio, acc: next, receipt: res.receipt })
    acc = next
    hasAcc = true
    log(`  ${f.name.padEnd(6)} ${(f.ratio * 100).toFixed(0).padStart(4)}%  → 合计 ${(acc * 100).toFixed(0)}%`)
  }

  // ── 最后一步：调节后刑期 + 宣告刑 + 偏离，同一个事务里提交 ──
  // 三个值必须一起落地：偏离是宣告刑合法性的唯一判据，分开提交就会出现
  // 「宣告刑已经写进去了、偏离还没算」的中间态，那一刻门禁是空的。
  const adjusted = r2(base * (1 + acc))
  const deviation = adjusted > 0 ? r4(Math.abs(declared - adjusted) / adjusted) : null
  const tx = {
    transaction_id: 'tx-量刑-宣告',
    operation: `确定宣告刑：调节后 ${adjusted} 月，在 ${DECLARED_TOLERANCE * 100}% 幅度内确定为 ${declared} 月`,
    target: caseId,
    state_changes: [
      { object: caseId, field: '调节后月', to: adjusted, kind: 'derived', basis: [`${caseId}.基准刑月`, `${caseId}.调节比例合计`, 'guide:法发2021-21/3'] },
      { object: caseId, field: '宣告刑月', to: declared, kind: 'asserted', basis: ['law:刑法/61'] },
      { object: caseId, field: '宣告刑偏离', to: deviation, kind: 'derived', basis: [`${caseId}.调节后月`, `${caseId}.宣告刑月`] },
    ],
  }
  const res = commit(dir, tx, { by, expectedSeq: seqOf(dir) })
  if (!res.ok) return { ok: false, rejected: { step: '宣告刑', violations: res.violations }, steps, adjusted, deviation }
  steps.push({ factor: '—', name: '宣告刑', acc, receipt: res.receipt })
  return { ok: true, steps, base, acc, adjusted, declared, deviation, caseId }
}

// ── CLI ─────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith('sentence.mjs')) {
  const dir = process.argv.slice(2).find((a) => !a.startsWith('--') && !/^\d+$/.test(a))
  const di = process.argv.indexOf('--declare')
  const bi = process.argv.indexOf('--by')
  if (!dir || di < 0) {
    process.stderr.write('用法：sentence.mjs <包路径> --declare <宣告刑月数> [--by 责任者]\n')
    process.exit(2)
  }
  const declared = Number(process.argv[di + 1])
  const by = bi >= 0 ? process.argv[bi + 1] : '承办法官'

  let r
  try { r = runSentencing(dir, { declared, by, log: (m) => process.stderr.write(m + '\n') }) }
  catch (e) { process.stderr.write('错误：' + e.message + '\n'); process.exit(1) }

  if (!r.ok) {
    for (const v of r.rejected.violations) process.stdout.write(`${v.severity ?? 'error'}\t${v.code ?? '-'}\t${v.msg}\n`)
    process.stderr.write(`✗ 「${r.rejected.step}」未落盘——前 ${r.steps.length} 步已提交，本步一个字节都没写。按上面的理由改后重提。\n`)
    process.exit(1)
  }
  process.stdout.write(`基准刑\t${r.base}\t月\n调节比例合计\t${(r.acc * 100).toFixed(0)}\t%\n调节后\t${r.adjusted}\t月\n宣告刑\t${r.declared}\t月\n偏离\t${(r.deviation * 100).toFixed(1)}\t%\n`)
  process.stderr.write(`✓ 量刑链已落盘 ${r.steps.length} 步，责任者 ${by}\n  查依据：node compiler/cli.mjs why ${dir} ${r.caseId}.调节比例合计\n`)
}
