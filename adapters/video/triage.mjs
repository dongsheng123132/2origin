#!/usr/bin/env node
// 本象·video 方言 —— 粗筛层（triage）
//
// 它要解决的唯一问题：**成本**。
// 100 小时素材按 5s 抽帧 = 72,000 帧 = 约 3,600 张联系表，VLM 读不起。
// 粗筛层用纯 ffmpeg 的确定性信号把素材排序，只把预算内的窗口送去精读。
//
// 但粗筛层本身是 bugscope A4 的重灾区：
//   一个静默丢掉 95% 素材的筛子，产出的 timeline 看起来和读全片的 timeline 一模一样。
// 所以本模块有一条硬规矩：
//   **dropped 是主要产物，不是副产品。** 丢了什么、按什么理由丢的、丢的那段测到了什么，
//   全部写进 triage.json，可复核到原片时间码。
//   （同 本象协议 投影层：「dropped 是 plan() 的主要产物」）
//
// 所有信号 basis=measured（ffmpeg 算的，可复算）。
// 排序权重 basis=asserted（我拍脑袋定的），已在 limits 里声明。
//
// 用法:
//   node triage.mjs src.mp4 --budget 12            # 只出 12 个候选窗口
//   node triage.mjs src.mp4 --window 10 --json

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1] }
const SRC = argv.find(a => !a.startsWith('--') && !argv[argv.indexOf(a) - 1]?.startsWith('--'))
  ?? argv.find(a => !a.startsWith('--'))
const W = parseFloat(arg('--window', '10'))
const BUDGET = parseInt(arg('--budget', '12'), 10)
const OUT = arg('--out', 'triage.json')

if (!SRC || !existsSync(SRC)) {
  console.error('用法: node triage.mjs <video> [--window 10] [--budget 12] [--out triage.json]')
  process.exit(2)
}

const ff = (args) => {
  try {
    return execFileSync('ffmpeg', ['-v', 'error', '-nostdin', ...args],
      { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) { return (e.stdout ?? '') + (e.stderr ?? '') }
}
const ffErr = (args) => {
  try {
    execFileSync('ffmpeg', ['-v', 'info', '-nostdin', ...args],
      { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] })
    return ''
  } catch (e) { return (e.stderr ?? '') }
}

// ── 0 · 真源与新鲜度（引用优先 ④）
const duration = parseFloat(execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', SRC],
  { encoding: 'utf8' }).trim())
const sha256 = createHash('sha256').update(readFileSync(SRC)).digest('hex')

// ── 1 · 信号采集（全部 measured，可复算）

/** ametadata/metadata print 的输出是成对行：`frame:N ... pts_time:T` + `key=value` */
const parsePairs = (text) => {
  const rows = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length - 1; i++) {
    const m = lines[i].match(/pts_time:([0-9.]+)/)
    if (!m) continue
    const v = lines[i + 1].match(/=(-?[0-9.]+)\s*$/)
    if (v) rows.push({ t: parseFloat(m[1]), v: parseFloat(v[1]) })
  }
  return rows
}

// 1a 镜头切换
const shots = parsePairs(ff([
  '-i', SRC, '-an', '-vf', "select='gt(scene,0.25)',metadata=print:file=-", '-f', 'null', '-',
])).map(r => ({ t: r.t, score: r.v }))

// 1b 逐秒响度
const rms = parsePairs(ff([
  '-i', SRC, '-vn', '-af',
  'aresample=8000,asetnsamples=8000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
  '-f', 'null', '-',
]))

// 1c 静音区间（→ 语音活动）
const silence = []
{
  const txt = ffErr(['-i', SRC, '-vn', '-af', 'silencedetect=n=-32dB:d=0.4', '-f', 'null', '-'])
  let start = null
  for (const line of txt.split(/\r?\n/)) {
    const s = line.match(/silence_start:\s*(-?[0-9.]+)/)
    if (s) { start = parseFloat(s[1]); continue }
    const e = line.match(/silence_end:\s*([0-9.]+)/)
    if (e && start != null) { silence.push([start, parseFloat(e[1])]); start = null }
  }
  if (start != null) silence.push([start, duration])
}

// 1d 黑场 / 静止画面（废镜头）
const black = []
{
  const txt = ffErr(['-i', SRC, '-an', '-vf', 'blackdetect=d=0.4:pic_th=0.98:pix_th=0.10', '-f', 'null', '-'])
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/black_start:\s*([0-9.]+)\s+black_end:\s*([0-9.]+)/)
    if (m) black.push([parseFloat(m[1]), parseFloat(m[2])])
  }
}
const freeze = []
{
  const txt = ffErr(['-i', SRC, '-an', '-vf', 'freezedetect=n=-55dB:d=3', '-f', 'null', '-'])
  let start = null
  for (const line of txt.split(/\r?\n/)) {
    const s = line.match(/freeze_start:\s*([0-9.]+)/)
    if (s) { start = parseFloat(s[1]); continue }
    const e = line.match(/freeze_end:\s*([0-9.]+)/)
    if (e && start != null) { freeze.push([start, parseFloat(e[1])]); start = null }
  }
  if (start != null) freeze.push([start, duration])
}

// ── 2 · 分窗统计
const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1))
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0 }
const rmsMedian = median(rms.map(r => r.v).filter(Number.isFinite))

const nW = Math.ceil(duration / W)
const windows = []
for (let i = 0; i < nW; i++) {
  const s = i * W, e = Math.min((i + 1) * W, duration)
  const span = e - s
  const silentS = silence.reduce((a, [x, y]) => a + overlap(s, e, x, y), 0)
  const blackS = black.reduce((a, [x, y]) => a + overlap(s, e, x, y), 0)
  const freezeS = freeze.reduce((a, [x, y]) => a + overlap(s, e, x, y), 0)
  const inWin = rms.filter(r => r.t >= s && r.t < e).map(r => r.v).filter(Number.isFinite)
  const peak = inWin.length ? Math.max(...inWin) : -99
  windows.push({
    id: `w${String(i).padStart(3, '0')}`,
    t: [+s.toFixed(1), +e.toFixed(1)],
    ref: `${SRC}@${sha256.slice(0, 8)}#t=${s.toFixed(1)},${e.toFixed(1)}`,
    measured: {
      speech_ratio: +(1 - silentS / span).toFixed(3),
      pause_count: silence.filter(([x, y]) => overlap(s, e, x, y) > 0).length,
      shot_cuts: shots.filter(sh => sh.t >= s && sh.t < e).length,
      rms_peak_db: +peak.toFixed(1),
      rms_rel_db: +(peak - rmsMedian).toFixed(1),
      dead_ratio: +((blackS + freezeS) / span).toFixed(3),
    },
  })
}

// ── 3 · 排序（权重是断言，见 limits T-WEIGHTS-ASSERTED）
const clamp01 = x => Math.max(0, Math.min(1, x))
for (const w of windows) {
  const m = w.measured
  const parts = {
    speech: clamp01(m.speech_ratio) * 0.40,                       // 有人说话 = 有信息
    rhythm: clamp01(m.pause_count / 6) * 0.15,                    // 停顿多 = 讲解节奏密
    cut: clamp01(m.shot_cuts / 2) * 0.20,                         // 画面换了 = 新内容
    energy: clamp01((m.rms_rel_db + 3) / 8) * 0.25,               // 声音比全片中位高 = 情绪起
  }
  const penalty = m.dead_ratio * 0.9                              // 黑场/静止 = 废镜头
  w.score = +Math.max(0, Object.values(parts).reduce((a, b) => a + b, 0) - penalty).toFixed(3)
  w.score_parts = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, +v.toFixed(3)]))
  if (penalty > 0) w.score_parts.dead_penalty = +(-penalty).toFixed(3)
}

// ── 4 · 按预算提升，其余全部进 dropped（第七要素：说出自己丢了什么）
const ranked = [...windows].sort((a, b) => b.score - a.score)
const kept = ranked.slice(0, BUDGET).sort((a, b) => a.t[0] - b.t[0])
const keptIds = new Set(kept.map(w => w.id))
const dropped = windows.filter(w => !keptIds.has(w.id)).map(w => ({
  id: w.id, t: w.t, ref: w.ref, score: w.score,
  reason: w.measured.dead_ratio > 0.5 ? 'dead-footage'
    : w.measured.speech_ratio < 0.3 ? 'low-speech'
      : 'below-budget-cutoff',
  measured: w.measured,
}))

const cut = kept.length ? kept.reduce((a, w) => Math.min(a, w.score), 1) : 0
const keptS = kept.reduce((a, w) => a + (w.t[1] - w.t[0]), 0)

const doc = {
  $schema: 'origin/dialect-video/triage/v0.1',
  source: { file: SRC, sha256, duration_s: +duration.toFixed(2) },
  params: { window_s: W, budget_windows: BUDGET, score_cutoff: +cut.toFixed(3) },
  signals_basis: 'measured',
  ranking_basis: 'asserted',
  totals: {
    windows: windows.length,
    kept: kept.length,
    dropped: dropped.length,
    kept_seconds: +keptS.toFixed(1),
    dropped_seconds: +(duration - keptS).toFixed(1),
    kept_ratio: +(keptS / duration).toFixed(3),
    shots_detected: shots.length,
    silence_intervals: silence.length,
    rms_median_db: +rmsMedian.toFixed(1),
  },
  candidates: kept,
  dropped,
  limits: [
    {
      code: 'T-WEIGHTS-ASSERTED', kind: 'unverified', scope: 'candidates[*].score',
      statement: '排序权重（speech .40 / energy .25 / cut .20 / rhythm .15）是手工拍的，没有在任何标注集上调过。信号本身是 measured，排序是 asserted。',
      remedy: '用一批人工标注过爆点的素材做一次召回/精确率评估，再定权重',
    },
    {
      code: 'T-RECALL-UNKNOWN', kind: 'unverified', scope: 'dropped[*]',
      statement: `本次丢弃 ${dropped.length} 个窗口共 ${(duration - keptS).toFixed(1)}s。丢弃的召回损失没有被独立测量——被丢的那些里有没有高价值内容，本模块不知道。`,
      remedy: '对 dropped 抽样精读做召回验证；或先用大预算跑一遍全量作为参照',
    },
    {
      code: 'T-NO-SEMANTICS', kind: 'undetectable', scope: '整个粗筛层',
      statement: '本层只有声学与像素信号，不理解内容。一段安静的、无镜头切换的、音量平稳的画面，若恰好是全片最关键的一句话，本层必然把它排到末尾。',
      remedy: '这是粗筛层的本性，不可修；靠预算留冗余 + 对 dropped 抽样复核兜底',
    },
    {
      code: 'T-SCREENCAST-BIAS', kind: 'degraded', scope: 'measured.shot_cuts',
      statement: '录屏素材的画面变化是渐进的（滚动、弹窗），scene 检测几乎不触发；本片 295s 只测到少量切换。cut 这一维在录屏类素材上近似失效。',
      remedy: '录屏类改用帧差 / OCR 文本变化率替代 scene 检测',
    },
  ],
}

writeFileSync(OUT, JSON.stringify(doc, null, 2))

if (argv.includes('--json')) { console.log(JSON.stringify(doc, null, 2)); process.exit(0) }

const naiveSheets = Math.ceil(duration / 5 / 20)
const triagedSheets = Math.ceil(kept.reduce((a, w) => a + (w.t[1] - w.t[0]), 0) / 5 / 20)
console.log(`源: ${SRC}  ${duration.toFixed(1)}s  ${sha256.slice(0, 12)}…`)
console.log(`信号: ${shots.length} 次镜头切换 · ${silence.length} 段静音 · 响度中位 ${rmsMedian.toFixed(1)}dB`)
console.log(`分窗: ${windows.length} 个 ${W}s 窗，预算 ${BUDGET}，截断分 ${cut.toFixed(3)}`)
console.log('')
console.log('── 候选（送去精读）')
for (const w of kept) {
  const m = w.measured
  console.log(`  ${w.t[0]}–${w.t[1]}s  score=${w.score.toFixed(3)}  ` +
    `speech=${m.speech_ratio} cuts=${m.shot_cuts} rms=${m.rms_rel_db > 0 ? '+' : ''}${m.rms_rel_db}dB`)
}
console.log('')
console.log(`── 丢弃 ${dropped.length} 个窗口 / ${(duration - keptS).toFixed(1)}s（明细在 ${OUT} 的 dropped 段，可复核到原片时间码）`)
const byReason = {}
for (const d of dropped) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1
for (const [r, n] of Object.entries(byReason)) console.log(`  ${r}: ${n} 个`)
console.log('')
console.log(`── 成本：全量 ${naiveSheets} 张联系表 → 粗筛后 ${triagedSheets} 张（${((1 - triagedSheets / naiveSheets) * 100).toFixed(0)}% 省下）`)
console.log(`   按同比例外推 100 小时：${Math.ceil(360000 / 5 / 20)} 张 → 约 ${Math.ceil(360000 * (keptS / duration) / 5 / 20)} 张`)
console.log('')
console.log(`⚠ ${doc.limits.length} 条边界已写进 ${OUT}。特别注意 T-RECALL-UNKNOWN：丢弃的召回损失尚未测量。`)
