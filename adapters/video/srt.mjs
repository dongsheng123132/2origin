#!/usr/bin/env node
// 两段式字幕 —— ASR 出时间码，视频原生 LLM 修低频词
//
// ## 剪映那类工具为什么专有名词必错
//
// 纯 ASR 做的是「声学证据 + 语言模型先验」的解码。而**值钱的词恰好是低频词**——
// 产品名、人名、价格、领域术语。信息论上，信息量大的词就是先验概率低的词，
// 于是语言模型先验在这些词上**帮倒忙**：把听不确定的低频词"纠正"成高频词。
//
// 实测（同一段音频）：
//   ASR    「有美金会议的原因」「就是他刻的呀，刻戴斯啊、龙虾啊、欧莫斯啊」
//   omni   「有美金汇率的原因」「这是 cloud code 呀、codex 啊、龙虾啊、Hermes 啊」
//
// 要听对「美金汇率」，必须先理解这句在讲汇率差价——那是 LLM 干的活，不是声学解码。
//
// ## 但 omni 没有时间戳，所以只能让它改字
//
// **ASR 定骨架，omni 独立听写，对齐交给确定性算法。**
// 时间码全程由 ASR 提供，omni 无权碰——它连自己的话在第几秒都不知道。
//
// 第一版不是这么做的：我把 ASR 文本连编号一起喂给它要求"逐行校对"，两个问题同时出现——
//   ① 它完全无视编号，返回连续段落（12 块全部对不上，0 条改写）
//   ② 产出比独立听写时**更差**：「cloud code / codex / Hermes」退化成
//      「克拉克的 / 科德斯 / 泡沫斯」。**错文把它锚住了。**
// 结论：不要给它看 ASR 的原文。切句用 LCS 字符对齐，见 alignMap()。
//
// ## 纯音频自动跳过
//
// omni 的核心优势是**读屏幕**（黑屏对照实测：codex→codebase、Hermes→homeos）。
// 没有画面通道它退化成"另一个 ASR"，实测 46% 改动只是标点、实质改动有对有错。
// 所以启动时先测画面通道有没有信息，没有就跳过——`--force-refine` 可强开。
//
// 用法:
//   node srt.mjs <视频> [--asr x.asr.json] [--chunk 120] [--hint "产品名"] [--out x.srt]
//                       [--no-refine | --force-refine]

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, basename, extname } from 'node:path'
import { tmpdir } from 'node:os'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1] }
const SRC = argv.find(a => !a.startsWith('--'))
const CHUNK = parseFloat(arg('--chunk', '120'))
const NOREFINE = argv.includes('--no-refine')
const HINT = arg('--hint', '')          // 专有名词提示，例如 "U-King, ClawX, OpenClaw, Codex, Hermes"
if (!SRC || !existsSync(SRC)) {
  console.error('用法: node srt.mjs <视频> [--asr x.asr.json] [--chunk 120] [--hint "产品名,人名"] [--out x.srt] [--no-refine]')
  process.exit(2)
}
const base = join(dirname(SRC), basename(SRC, extname(SRC)))
const ASR = arg('--asr', base + '.asr.json')
const OUT = arg('--out', base + '.srt')

if (!existsSync(ASR)) {
  console.error(`缺 ${ASR} —— 先跑 node asr.mjs ${SRC} --engine bl`)
  process.exit(1)
}
const asr = JSON.parse(readFileSync(ASR, 'utf8'))
const segs = asr.segments.filter(s => s.text?.trim())
console.log(`${SRC}  ${asr.source.duration_s}s  ASR ${segs.length} 句`)

const win = process.platform === 'win32'
const bl = (args) => {
  const out = execFileSync(win ? 'cmd' : 'bl', win ? ['/c', 'bl', ...args] : args,
    { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] })
  const m = out.match(/\{[\s\S]*\}$/m)
  if (!m) throw new Error('bl 返回里没有 JSON')
  const j = JSON.parse(m[0])
  if (j.error) throw new Error(j.error.message)
  return (j.content ?? '').trim()
}

/** 最长公共子序列对齐：给出 a 的每个位置在 b 里的对应位置。
 *  两条通道听的是同一段音频，文本高度相似，所以字符级 LCS 足够。
 *  **对齐全程不经模型**——模型只负责听，切句由算法负责。这样它没有机会把时间码搞错。 */
function alignMap(a, b) {
  const n = a.length, m = b.length
  if (!n || !m) return { pos: new Array(n + 1).fill(0), matched: 0 }
  const dp = new Int32Array((n + 1) * (m + 1))
  const W = m + 1
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i * W + j] = a[i - 1] === b[j - 1]
        ? dp[(i - 1) * W + j - 1] + 1
        : Math.max(dp[(i - 1) * W + j], dp[i * W + j - 1])
    }
  }
  const pos = new Array(n + 1).fill(0)
  let i = n, j = m
  pos[n] = m
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { i--; j--; pos[i] = j }
    else if (dp[(i - 1) * W + j] >= dp[i * W + j - 1]) { i--; pos[i] = j }
    else j--
  }
  while (i >= 0) { pos[i] = j; i-- }
  return { pos, matched: dp[n * W + m] }
}

/** 画面通道有没有信息？
 *
 *  spec 里写着「纯音频素材默认关掉 omni 复核」，但这条规矩一度只存在于文档里——
 *  代码照样对黑屏占位视频跑复核。文档与实现各说各话，正是本项目自己反对的双份账本。
 *  这里把它变成代码：整段抽 20 帧求时间差分，接近零就是纯音频/静止画面。 */
function visualIsBlank() {
  try {
    const txt = execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', SRC,
      '-vf', `fps=20/${Math.max(1, asr.source.duration_s)},scale=160:-2,tblend=all_mode=difference,` +
             `signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,
      '-an', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'pipe'] })
    const vals = [...txt.matchAll(/=([0-9.]+)/g)].map(m => parseFloat(m[1])).filter(Number.isFinite)
    if (!vals.length) return null
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    return { blank: mean < 1.0, mean: +mean.toFixed(3), frames: vals.length }
  } catch { return null }
}

let fixed = 0
let blankNote = null
if (!NOREFINE) {
  const v = visualIsBlank()
  if (v?.blank && !argv.includes('--force-refine')) {
    blankNote = `画面通道无信息（${v.frames} 帧时间差分均值 ${v.mean} ≈ 0），按 spec 跳过 omni 复核。`
    console.log(`⚠ ${blankNote}`)
    console.log('  纯音频上 omni 退化成"另一个 ASR"：实测 46% 改动只是标点，实质改动有对有错。')
    console.log('  确实要跑请加 --force-refine。')
  } else if (v && !v.blank) {
    console.log(`画面通道有信息（时间差分均值 ${v.mean}），启用 omni 复核`)
  }
}
if (!NOREFINE && !blankNote) {
  const work = mkdtempSync(join(tmpdir(), 'srt-'))
  const nChunk = Math.ceil(asr.source.duration_s / CHUNK)
  for (let c = 0; c < nChunk; c++) {
    const a = c * CHUNK, b = Math.min((c + 1) * CHUNK, asr.source.duration_s)
    const mine = segs.filter(s => s.t[0] >= a && s.t[0] < b)
    if (!mine.length) continue
    const clip = join(work, `c${c}.mp4`)
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-nostdin', '-ss', String(a), '-t', String(b - a),
      '-i', SRC, '-vf', 'scale=360:-2,fps=6', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
      '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', clip],
      { stdio: ['ignore', 'pipe', 'pipe'] })

    // ⚠ 不给它看 ASR 的原文。
    // 第一版把 ASR 文本连编号一起喂进去要它"逐行校对"，结果两个问题同时出现：
    //   ① 它完全无视编号，返回连续段落（12 块全部对不上，0 条改写）
    //   ② 产出比独立转写时**更差**——「cloud code / codex / Hermes」退化成
    //      「克拉克的 / 科德斯 / 泡沫斯」。错文把它锚住了。
    // 所以：让它独立听写，对齐交给确定性算法。
    const prompt =
      '逐字写出这段视频里说话人说的话。要求：\n' +
      '1. 只输出台词，不要任何解释、标题、编号\n' +
      '2. 英文产品名/工具名写英文原名，不要写成同音汉字\n' +
      '3. 数字按听到的写\n' +
      (HINT ? `4. 这段视频可能涉及这些专有名词，供参考：${HINT}\n` : '')
    try {
      const raw = bl(['omni', '--video', clip, '--text-only', '--temperature', '0', '--message', prompt])
        .replace(/\s+/g, '')
      const asrText = mine.map(s => s.text).join('')
      const bounds = []                       // ASR 各句在拼接串里的结束位置
      let acc = 0
      for (const s of mine) { acc += s.text.length; bounds.push(acc) }

      const map = alignMap(asrText, raw)      // ASR 位置 → omni 位置（确定性，无模型参与）
      const sim = map.matched / Math.max(1, Math.min(asrText.length, raw.length))
      if (sim < 0.45) {
        console.log(`  块 ${c} 对齐相似度 ${sim.toFixed(2)} 过低，整块保留 ASR 原文`)
        continue                              // 对不齐就不敢用——宁可不改，绝不错位
      }
      let prev = 0, n = 0
      mine.forEach((s, i) => {
        const cut = map.pos[bounds[i]] ?? raw.length
        const piece = raw.slice(prev, cut).trim()
        prev = cut
        // 长度差太大说明这句没对上，单句跳过而不是整块放弃
        if (piece && Math.abs(piece.length - s.text.length) <= Math.max(4, s.text.length * 0.6)
            && piece !== s.text) { s.refined = piece; fixed++; n++ }
      })
      console.log(`  块 ${c} [${a}-${b}s] ${mine.length} 句，相似度 ${sim.toFixed(2)}，改了 ${n} 句`)
    } catch (e) {
      console.log(`  块 ${c} 复核失败，保留 ASR 原文：${String(e.message).slice(0, 60)}`)
    }
  }
  rmSync(work, { recursive: true, force: true })
}

const ts = s => {
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec.toFixed(3).padStart(6, '0').replace('.', ',')}`
}
const srt = segs.map((s, i) =>
  `${i + 1}\n${ts(s.t[0])} --> ${ts(s.t[1])}\n${s.refined ?? s.text}\n`).join('\n')
writeFileSync(OUT, srt, 'utf8')

// 改动清单单独存一份：字幕本身是投影，改了什么必须能回溯（引用优先 ④）
const diff = segs.filter(s => s.refined).map(s => ({ t: s.t, ref: s.ref, asr: s.text, refined: s.refined }))
writeFileSync(OUT.replace(/\.srt$/, '.diff.json'), JSON.stringify({
  source: asr.source, engine_asr: asr.engine, engine_refine: (NOREFINE || blankNote) ? null : 'qwen3.5-omni via bl omni',
  skipped_reason: blankNote,
  total: segs.length, changed: fixed,
  limits: [{
    code: 'S-REFINE-UNVERIFIED', kind: 'unverified', scope: 'refined 行',
    statement: `omni 改写了 ${fixed}/${segs.length} 句。改对了没有**没有独立验证**——`
      + '两条通道都可能错（实测过一次：字幕写「海报」ASR 听成「还是」，无法判定谁对）。'
      + '行数对不上的块整块保留 ASR 原文，宁可不改也不错位。',
    remedy: '对关键段落人工复听；或用第三条通道投票',
  }],
  changes: diff,
}, null, 2), 'utf8')

console.log('')
console.log(`${segs.length} 条字幕，其中 ${fixed} 条被复核改写（${(fixed / segs.length * 100).toFixed(0)}%）`)
console.log(`→ ${OUT}`)
console.log(`→ ${OUT.replace(/\.srt$/, '.diff.json')}（改动清单，可回溯）`)
