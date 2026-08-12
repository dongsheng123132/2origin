#!/usr/bin/env node
// 联系表构建器 —— 视频送进 VLM 的唯一入口
//
// ## 为什么烧的是格号，不是时间戳
//
// 上一版把时间戳烧进画面：`drawtext=text='%{eif\:trunc(t*5)\:d}s'`。
// 那个 `t*5` 是**第二个时间公式**，和驱动抽帧的 `fps=1/5` 各算各的。两者一旦不一致，
// 产出的联系表看起来完全正常，下游据此写出的所有时间码全错，而管线一声不吭
// （bugscope A4：缺席不会自己发声）。
//
// 本版的结构性修法：**画面里只烧格号 `%{n}`**——那是抽帧后帧的序号，是计数器不是公式；
// 格号→时间的映射只存在于 manifest 里，由驱动抽帧的同一个 stride 常量算出。
// **一个公式，一个真源。** 第二份公式不存在，就无从失配（引用优先 §1）。

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1] }
const SRC = argv.find(a => !a.startsWith('--'))
const STRIDE = parseFloat(arg('--stride', '15'))   // 抽帧间隔（秒）——唯一的时间常量
const COLS = parseInt(arg('--cols', '8'), 10)
const ROWS = parseInt(arg('--rows', '6'), 10)
const CELL = parseInt(arg('--cell', '240'), 10)    // 单格宽度（像素）
const DIR = arg('--dir', 'sheets')
const START = parseFloat(arg('--start', '0'))      // 只处理某个区间（第二遍精读用）
const END = arg('--end', null)

if (!SRC || !existsSync(SRC)) {
  console.error('用法: node sheet.mjs <video> [--stride 15] [--cols 8] [--rows 6] [--cell 240] [--start S --end E]')
  process.exit(2)
}
mkdirSync(DIR, { recursive: true })

const duration = parseFloat(execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', SRC],
  { encoding: 'utf8' }).trim())
const sha256 = createHash('sha256').update(readFileSync(SRC)).digest('hex')
const end = END != null ? parseFloat(END) : duration
const perSheet = COLS * ROWS

// ── 自动裁掉「全程不变」的区域（贴片 / 黑边 / 台标）
//
// 直播素材常有固定贴片压掉三成画面高度，全程一个像素不变。它占的是**联系表的像素预算**，
// 也就是真金白银的 token。这一步测出哪些横条在时间上完全静止，把它们裁掉。
// basis=measured：用整段素材的时间差分图算出来的，证据记进 manifest。
function autoCrop(bands = 20, floorTol = 0.15) {
  const map = join(DIR, '_diffmap.png')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-nostdin', ...trimArgs, '-i', SRC,
    '-vf', `fps=1/${STRIDE},scale=200:-2,tblend=all_mode=difference,tmix=frames=100`,
    '-frames:v', '1', '-update', '1', map], { stdio: ['ignore', 'pipe', 'pipe'] })
  const [mw, mh] = execFileSync('ffprobe',
    ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', map],
    { encoding: 'utf8' }).trim().split(',').map(Number)

  const h = Math.max(1, Math.floor(mh / bands))
  const vals = []
  for (let k = 0; k < bands; k++) {
    const txt = execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', map,
      '-vf', `crop=${mw}:${h}:0:${k * h},signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,
      '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    vals.push(parseFloat(txt.match(/=([0-9.]+)/)?.[1] ?? '0'))
  }
  // 静止 = 贴近全片最小值。取最长的连续「非静止」区间。
  const lo = Math.min(...vals), hi = Math.max(...vals)
  if (hi - lo < 1) return null                       // 通篇一样活跃，没得裁
  const live = vals.map(v => (v - lo) / (hi - lo) > floorTol)
  let best = null, cur = null
  live.forEach((on, i) => {
    if (on && !cur) cur = { a: i, b: i }
    else if (on) cur.b = i
    else if (cur) { if (!best || cur.b - cur.a > best.b - best.a) best = cur; cur = null }
  })
  if (cur && (!best || cur.b - cur.a > best.b - best.a)) best = cur
  if (!best) return null
  const y0 = best.a / bands, y1 = (best.b + 1) / bands
  if (y1 - y0 > 0.92) return null                    // 几乎没裁掉什么，不值得
  return { y0, y1, bands: vals.map(v => +v.toFixed(2)), kept_bands: [best.a, best.b] }
}

const trimArgs = (START > 0 || end < duration) ? ['-ss', String(START), '-to', String(end)] : []
const pattern = join(DIR, `sheet_%02d.jpg`)
const keepIdx = argv.indexOf('--keep-y')
const auto = keepIdx >= 0
  ? { y0: parseFloat(argv[keepIdx + 1]), y1: parseFloat(argv[keepIdx + 2]), bands: null, kept_bands: null, manual: true }
  : argv.includes('--auto-crop') ? autoCrop() : null
const cropFilter = auto ? `crop=iw:ih*${(auto.y1 - auto.y0).toFixed(4)}:0:ih*${auto.y0.toFixed(4)},` : ''

execFileSync('ffmpeg', [
  '-v', 'error', '-y', '-nostdin', ...trimArgs, '-i', SRC,
  '-vf', [
    `fps=1/${STRIDE}`,
    ...(cropFilter ? [cropFilter.slice(0, -1)] : []),
    `scale=${CELL}:-2`,
    // 只烧格号：%{n} 是抽帧后的帧序号，直接计数，不是时间公式
    `drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf':text='%{n}':x=4:y=4:fontsize=${Math.round(CELL / 9)}:fontcolor=yellow:box=1:boxcolor=black@0.75`,
    `tile=${COLS}x${ROWS}:margin=3:padding=3:color=black`,
  ].join(','),
  '-fps_mode', 'passthrough', '-q:v', '4', pattern,
], { stdio: ['ignore', 'pipe', 'pipe'] })

// 格号 → 时间：由驱动抽帧的同一个 STRIDE 算出，别处没有第二份公式
const n = Math.ceil((end - START) / STRIDE)
const cells = []
for (let i = 0; i < n; i++) {
  cells.push({
    n: i,
    sheet: Math.floor(i / perSheet),
    row: Math.floor((i % perSheet) / COLS),
    col: (i % perSheet) % COLS,
    t: +(START + i * STRIDE).toFixed(2),
    ref: `${SRC}@${sha256.slice(0, 8)}#t=${(START + i * STRIDE).toFixed(2)}`,
  })
}
const sheets = [...new Set(cells.map(c => c.sheet))]
  .map(s => join(DIR, `sheet_${String(s + 1).padStart(2, '0')}.jpg`))

const manifest = {
  $schema: 'origin/dialect-video/sheets/v0.1',
  source: { file: SRC, sha256, duration_s: +duration.toFixed(2) },
  params: { stride_s: STRIDE, cols: COLS, rows: ROWS, cell_px: CELL, range: [START, +end.toFixed(2)] },
  crop: auto ? {
    basis: auto.manual ? 'declared' : 'measured',
    keep_y: [+auto.y0.toFixed(4), +auto.y1.toFixed(4)],
    dropped_height_ratio: +(1 - (auto.y1 - auto.y0)).toFixed(4),
    method: `整段素材 ${STRIDE}s 抽帧后逐帧差分求均值，按 20 条横带测时间活跃度，取最长连续活跃段`,
    evidence_band_yavg: auto.bands,
    kept_bands: auto.kept_bands,
    statement: `裁掉了画面上下共 ${((1 - (auto.y1 - auto.y0)) * 100).toFixed(0)}% 高度——这些区域在整段素材上时间差分为基线值（全程不变：贴片/黑边/台标）。` +
      `⚠ 本方法按「时间活跃度」裁，而活跃度不等于重要性——两者是影子与对象的关系。` +
      `已实测的失败模式：直播素材里主播摄像头小窗面积小、变化幅度远小于全屏滚动的文档，` +
      `因而被判为低活跃并裁掉，表情与手势这条情绪通道随之丢失。` +
      `同理，静态但重要的信息（固定价格牌、常驻字幕条、台标里的品牌名）也会被连带裁掉。`,
    override: '需要保住某个区域时用 --keep-y <y0> <y1> 手动指定，不要依赖本测量',
  } : null,
  reading_guide:
    `画面左上角的黄色数字是格号（0 起）。格号→时间: t = ${START} + n × ${STRIDE}。` +
    `按行优先排列，每张 ${COLS}×${ROWS}=${perSheet} 格。画面里没有时间戳——刻意的，见 sheet.mjs 头部注释。`,
  coverage: {
    frames: n,
    sheets: sheets.length,
    span_s: +(end - START).toFixed(1),
    blind_window_s: STRIDE,
    statement: `抽帧间隔 ${STRIDE}s，短于 ${STRIDE}s 的事件可能整个落在两格之间。` +
      `本表覆盖了区间内 100% 的时长（无盲丢），但时间分辨率为 ${STRIDE}s。`,
  },
  cells,
  sheets,
}
writeFileSync(join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))

console.log(`源 ${SRC} ${duration.toFixed(1)}s ${sha256.slice(0, 12)}…`)
console.log(`抽帧 ${n} 格 @ ${STRIDE}s → ${sheets.length} 张 ${COLS}×${ROWS} 联系表`)
console.log(`覆盖 ${(end - START).toFixed(1)}s（100% 时长，无盲丢），时间分辨率 ${STRIDE}s`)
console.log(sheets.join('\n'))
console.log(`manifest: ${join(DIR, 'manifest.json')}`)
