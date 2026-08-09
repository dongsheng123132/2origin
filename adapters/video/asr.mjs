#!/usr/bin/env node
// 本象·video 方言 —— 语音通道
//
// n=2 实测：没有文本通道，整条管线只剩一个分镜表（docs/02-n2-真直播素材.md §2）。
// 那条 27 分钟直播里，最高价值的内容全在前 12 分钟，而那 12 分钟画面上只有
// 「一个人站在白墙前比划」——视觉通道给出的信息是零。
//
// ## 两个引擎，不是二选一
//
//   bl       百炼 fun-asr（云端）—— 准、快（27 分钟音频 27.8 秒出结果）、带句级+词级时间戳
//   whisper  本地 faster-whisper —— 离线可用，给 U 盘 / 客户机场景兜底
//
// 实测同一段 120s 音频：
//   bl:      「因为有美金汇率的原因……付款意愿老外高五倍，所以有三十五倍的市场差价」
//   whisper: 「我感觉那种都不適合 / 就是人类是还是英国年轻的 / 包括跟他原生在这个夺的」
// small 模型在这条素材上基本不可用。**默认走 bl，whisper 只在离线时兜底，并如实标注降级。**
//
// ## basis: transcribed（新增的第四档）
//
// 转写既不是 observed（我没在画面上读到），也不是 measured（模型输出会幻觉、会漏），
// 更不是 asserted（它不是判断，是有对错的事实主张）。
// 「这段文字存在」不等于「他说了这句话」——bugscope A1 的直接实例。
//
// 用法:
//   node asr.mjs <视频> [--engine bl|whisper] [--lang zh] [--out x.asr.json]

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, basename, extname } from 'node:path'
import { tmpdir } from 'node:os'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1] }
const SRC = argv.find(a => !a.startsWith('--'))
const ENGINE = arg('--engine', 'bl')
const LANG = arg('--lang', 'zh')
const OUT = arg('--out', null)

if (!SRC || !existsSync(SRC)) {
  console.error('用法: node asr.mjs <视频> [--engine bl|whisper] [--lang zh] [--out x.asr.json]')
  process.exit(2)
}

const sha256 = createHash('sha256').update(readFileSync(SRC)).digest('hex')
const duration = parseFloat(execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', SRC],
  { encoding: 'utf8' }).trim())

// 统一转 16k 单声道 mp3：ASR 引擎的标准输入，且体积小到能走上传
const mp3 = join(tmpdir(), `asr_${sha256.slice(0, 12)}.mp3`)
if (!existsSync(mp3)) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-nostdin', '-i', SRC,
    '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k', mp3],
    { stdio: ['ignore', 'pipe', 'pipe'] })
}

let segments = [], engine = {}, degraded = null

if (ENGINE === 'bl') {
  const raw = join(tmpdir(), `asr_${sha256.slice(0, 12)}.bl.json`)
  const t0 = Date.now()
  // Windows 上 bl 是 npm shim（bl.cmd）。Node 20+ 出于安全不再直接 spawn .cmd（EINVAL），
  // 也不会自动补 .cmd 后缀（ENOENT）。两个坑都要绕，所以走 cmd /c。
  const blArgs = ['speech', 'recognize', '--url', mp3, '--language', LANG, '--out', raw, '--quiet']
  const win = process.platform === 'win32'
  execFileSync(win ? 'cmd' : 'bl', win ? ['/c', 'bl', ...blArgs] : blArgs,
    { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 })
  const took = (Date.now() - t0) / 1000
  const d = JSON.parse(readFileSync(raw, 'utf8'))
  const tr = d.transcripts?.[0]
  if (!tr) { console.error('bl 返回里没有 transcripts'); process.exit(1) }
  segments = tr.sentences.map(s => ({
    t: [+(s.begin_time / 1000).toFixed(2), +(s.end_time / 1000).toFixed(2)],
    text: s.text,
    ref: `${basename(SRC)}@${sha256.slice(0, 8)}#t=${(s.begin_time / 1000).toFixed(2)},${(s.end_time / 1000).toFixed(2)}`,
  }))
  engine = {
    impl: 'bailian-cli / bl speech recognize', model: 'fun-asr', mode: 'cloud',
    transcribe_s: +took.toFixed(1),
    realtime_factor: +(duration / took).toFixed(1),
    speech_seconds: +(tr.content_duration_in_milliseconds / 1000).toFixed(1),
    uploaded: true,
  }
} else if (ENGINE === 'whisper') {
  const raw = join(tmpdir(), `asr_${sha256.slice(0, 12)}.wh.json`)
  execFileSync('python', [join(dirname(new URL(import.meta.url).pathname).replace(/^\//, ''), 'asr.py'),
    SRC, '--model', arg('--model', 'small'), '--lang', LANG, '--out', raw],
    { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 })
  const d = JSON.parse(readFileSync(raw, 'utf8'))
  segments = d.segments.map(s => ({
    t: s.t, text: s.text, ref: `${basename(SRC)}@${sha256.slice(0, 8)}#t=${s.t[0]},${s.t[1]}`,
    avg_logprob: s.avg_logprob, no_speech_prob: s.no_speech_prob,
  }))
  engine = { impl: 'faster-whisper', model: d.engine.model, mode: 'local', ...d.perf }
  degraded = '本地 whisper。实测 small 模型在中文口播直播上基本不可用（见本文件头部对照），仅作离线兜底'
} else {
  console.error(`未知引擎 ${ENGINE}，可选 bl | whisper`); process.exit(2)
}

const speechS = segments.reduce((a, s) => a + (s.t[1] - s.t[0]), 0)

const doc = {
  $schema: 'origin/dialect-video/asr/v0.1',
  source: { file: SRC, sha256, duration_s: +duration.toFixed(2) },
  engine, basis: 'transcribed',
  totals: {
    segments: segments.length,
    chars: segments.reduce((a, s) => a + s.text.length, 0),
    speech_seconds: +speechS.toFixed(1),
    speech_ratio: +(speechS / duration).toFixed(3),
  },
  limits: [
    {
      code: 'A-TRANSCRIBED-NOT-OBSERVED', kind: 'unverified', scope: 'segments[*].text',
      statement: '转写是模型输出，不是观察。「这段文字存在」不等于「他说了这句话」。',
      remedy: '对 value≥0.7 的事件，回到 ref 的时间码复听一遍再定稿',
    },
    {
      code: 'A-PRODUCT-NAMES-WRONG', kind: 'degraded', scope: 'segments[*].text',
      statement: '产品名与专有名词被转成同音词。本片实测：Codex→「刻戴斯」、OpenClaw→「龙虾」/「欧莫斯」、'
        + 'u-king.org→「UK点OR」。用关键词检索卖点段落会**整段漏掉**。',
      remedy: 'bl speech recognize --vocabulary-id <热词表ID>，把产品名注册进去后重跑',
    },
    {
      code: 'A-NO-EMOTION', kind: 'lossy', scope: 'segments[*]',
      statement: '本通道只出文字，不出情绪、语速、音量、说话人。「爆点」很大程度上是语气而非用词。',
      remedy: 'bl speech recognize --diarization 可分说话人；情绪需换腾讯云 asr '
        + '（EmotionRecognition，当前账号 UserNotRegistered，需控制台开通）',
    },
    ...(degraded ? [{
      code: 'A-LOCAL-DEGRADED', kind: 'degraded', scope: '整条转写',
      statement: degraded, remedy: '联网时改用 --engine bl',
    }] : []),
  ],
  segments,
}

const dest = OUT ?? join(dirname(SRC), basename(SRC, extname(SRC)) + '.asr.json')
writeFileSync(dest, JSON.stringify(doc, null, 2))

console.log(`源 ${SRC} ${duration.toFixed(1)}s`)
console.log(`引擎 ${engine.impl}/${engine.model} (${engine.mode})  ${engine.transcribe_s ?? '?'}s = ${engine.realtime_factor ?? '?'}x 实时`)
console.log(`${segments.length} 段 / ${doc.totals.chars} 字 / 语音占 ${(doc.totals.speech_ratio * 100).toFixed(0)}%`)
if (degraded) console.log(`⚠ ${degraded}`)
console.log(`→ ${dest}`)
