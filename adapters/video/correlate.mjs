#!/usr/bin/env node
// 韵律 vs 价值：相关性检验 —— 兑现 tc-asr.json 的 T-PROSODY-NOT-VALUE
//
// 本项目已经栽过一次：10s 窗的 RMS 峰值实测与价值**反相关**（docs/01）。
// 所以「句级语速 / 情绪能量 / 停顿能找爆点」这个假设必须**先测再用**。
//
// ⚠ 参照（timeline 的 value）是 basis=asserted，即同一个模型的判断。
//    这里量的是「韵律与我的判断是否一致」，不是「韵律是否客观有效」（bugscope A2）。
//
// 用法: node correlate.mjs <timeline.json> <tcasr.json>

import { readFileSync } from 'node:fs'

const [tlPath, asrPath] = process.argv.slice(2).filter(a => !a.startsWith('--'))
if (!tlPath || !asrPath) { console.error('用法: node correlate.mjs <timeline.json> <tcasr.json>'); process.exit(2) }
const tl = JSON.parse(readFileSync(tlPath, 'utf8'))
const asr = JSON.parse(readFileSync(asrPath, 'utf8'))
if (tl.source.sha256 !== asr.source.sha256) { console.error('✗ 不是同一条素材'); process.exit(1) }

const segs = asr.segments
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
const rank = xs => {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])
  const r = new Array(xs.length)
  idx.forEach(([, i], k) => { r[i] = k + 1 })
  return r
}
/** Spearman 秩相关：对单调但非线性的关系更稳，样本小时比 Pearson 可靠 */
const spearman = (a, b) => {
  const ra = rank(a), rb = rank(b), n = a.length
  const ma = mean(ra), mb = mean(rb)
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2 }
  return da && db ? num / Math.sqrt(da * db) : 0
}

const rows = []
for (const e of tl.events) {
  const inside = segs.filter(s => s.t[1] > e.t[0] && s.t[0] < e.t[1])
  if (!inside.length) continue
  const spd = inside.map(s => s.prosody.speech_speed).filter(Number.isFinite)
  const eng = inside.map(s => s.prosody.emotional_energy).filter(Number.isFinite)
  const sil = inside.map(s => s.prosody.silence_before_ms).filter(Number.isFinite)
  rows.push({
    id: e.id, value: e.value, role: e.role, n: inside.length,
    spd_mean: mean(spd), spd_max: Math.max(...spd),
    eng_mean: mean(eng), eng_max: Math.max(...eng),
    sil_max: Math.max(...sil),
    density: inside.reduce((a, s) => a + s.text.length, 0) / (e.t[1] - e.t[0]),  // 字/秒（含静默）
  })
}

const V = rows.map(r => r.value)
const METRICS = [
  ['语速均值', 'spd_mean'], ['语速峰值', 'spd_max'],
  ['情绪能量均值', 'eng_mean'], ['情绪能量峰值', 'eng_max'],
  ['最长停顿', 'sil_max'], ['话密度(字/秒)', 'density'],
]

console.log(`样本 ${rows.length} 个事件  参照 basis=asserted（非外部判据）\n`)
console.log('指标              Spearman ρ   判定')
console.log('─'.repeat(52))
const results = []
for (const [name, key] of METRICS) {
  const r = spearman(rows.map(x => x[key]), V)
  results.push([name, r])
  const verdict = Math.abs(r) < 0.3 ? '无关' : r > 0 ? (r > 0.6 ? '强正相关 ✓' : '弱正相关') : (r < -0.6 ? '强负相关 ✗' : '弱负相关')
  const bar = '█'.repeat(Math.round(Math.abs(r) * 20))
  console.log(`${name.padEnd(16)} ${r >= 0 ? ' ' : ''}${r.toFixed(3)}      ${verdict.padEnd(10)} ${bar}`)
}

console.log('\n按各指标取 top3，看落在哪些事件上：')
for (const [name, key] of METRICS) {
  const top = [...rows].sort((a, b) => b[key] - a[key]).slice(0, 3)
  console.log(`  ${name.padEnd(14)} ${top.map(t => `${t.id}(v=${t.value})`).join(' ')}`)
}

const best = results.reduce((a, b) => Math.abs(b[1]) > Math.abs(a[1]) ? b : a)
console.log('')
if (Math.abs(best[1]) < 0.3) {
  console.log(`判定：全部指标 |ρ| < 0.3，韵律与价值判断无可用关系。`)
  console.log(`      不要用韵律做价值排序——它测的是"说得激动"，不是"值得剪"。`)
  process.exit(1)
} else {
  console.log(`判定：最强指标「${best[0]}」ρ=${best[1].toFixed(3)}。`)
  console.log(`      样本 n=${rows.length}，参照是断言，仅可作为辅助线索，不能单独定价值。`)
}
