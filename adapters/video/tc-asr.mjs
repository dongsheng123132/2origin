#!/usr/bin/env node
// 腾讯云 ASR 通道 —— 带韵律（语速 / 情绪能量 / 停顿 / 说话人）
//
// ## 为什么值得单独接一条
//
// 百炼 fun-asr 只出文字。而「爆点」在很大程度上**是语气不是用词**——
// 这条通道缺席时，value 只能是模型对文本的断言。
//
// 腾讯 CreateRecTask 的 ResultDetail 每句带四个测量值：
//   SpeechSpeed       语速（字/秒）
//   EmotionalEnergy   情绪能量
//   SilenceTime       句前停顿（ms）
//   SpeakerId         说话人
//
// 关键区别：这些是**跟语义单元对齐**的，不是固定窗口的声学统计。
// 本项目第一版粗筛用的是 10 秒窗的原始 RMS 峰值，实测与价值**反相关**
// （最响的窗口是「一个没装上」那段负面素材，见 docs/01）。句级韵律是另一回事。
//
// ## 分块
//
// CreateRecTask 的 Data 上限 5MB。27 分钟 64kbps mp3 是 12.7MB，必须切。
// 切点按固定时长，**会切断句子**——这条写进 limits，不假装没有。
//
// 用法:
//   node tc-asr.mjs <视频> [--chunk 300] [--out x.tcasr.json]

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, basename, extname } from 'node:path'
import { tmpdir } from 'node:os'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1] }
const SRC = argv.find(a => !a.startsWith('--'))
const CHUNK = parseFloat(arg('--chunk', '300'))
const OUT = arg('--out', null)

if (!SRC || !existsSync(SRC)) {
  console.error('用法: node tc-asr.mjs <视频> [--chunk 300] [--out x.tcasr.json]')
  process.exit(2)
}

const sha256 = createHash('sha256').update(readFileSync(SRC)).digest('hex')
const duration = parseFloat(execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', SRC],
  { encoding: 'utf8' }).trim())

// tccli 走 python，不认 git-bash 的 /d/... 路径，也不喜欢中文目录 —— 全部落到 ASCII 临时目录
const work = join(tmpdir(), `tcasr_${sha256.slice(0, 12)}`)
mkdirSync(work, { recursive: true })
const winPath = p => p.replace(/\\/g, '/')

const tccli = (args) => {
  const r = execFileSync('cmd', ['/c', 'tccli', ...args],
    { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] })
  const m = r.match(/\{[\s\S]*\}/)
  if (!m) throw new Error(`tccli 返回里没有 JSON:\n${r.slice(0, 300)}`)
  return JSON.parse(m[0])
}

const nChunks = Math.ceil(duration / CHUNK)
console.log(`源 ${SRC} ${duration.toFixed(1)}s → ${nChunks} 块 × ${CHUNK}s`)

// ── 提交
const tasks = []
for (let i = 0; i < nChunks; i++) {
  const start = i * CHUNK
  const mp3 = join(work, `c${i}.mp3`)
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-nostdin', '-ss', String(start), '-t', String(CHUNK),
    '-i', SRC, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k', mp3],
    { stdio: ['ignore', 'pipe', 'pipe'] })
  const buf = readFileSync(mp3)
  if (buf.length > 5 * 1024 * 1024) {
    console.error(`块 ${i} 有 ${(buf.length / 1048576).toFixed(1)}MB，超过 CreateRecTask 的 5MB 上限——减小 --chunk`)
    process.exit(1)
  }
  const params = join(work, `c${i}.json`)
  writeFileSync(params, JSON.stringify({
    EngineModelType: '16k_zh', ChannelNum: 1, ResTextFormat: 3, SourceType: 1,
    Data: buf.toString('base64'), DataLen: buf.length,
    EmotionRecognition: 1, EmotionalEnergy: 1, SpeakerDiarization: 1,
    ConvertNumMode: 1, FilterModal: 0, FilterDirty: 0,
  }))
  const r = tccli(['asr', 'CreateRecTask', '--cli-input-json', `file://${winPath(params)}`])
  tasks.push({ i, start, id: r.Data.TaskId, size: buf.length })
  console.log(`  块 ${i} [${start}s+] ${(buf.length / 1048576).toFixed(1)}MB → TaskId ${r.Data.TaskId}`)
}

// ── 轮询
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const done = []
for (const t of tasks) {
  for (let k = 0; k < 60; k++) {
    const r = tccli(['asr', 'DescribeTaskStatus', '--TaskId', String(t.id)])
    const d = r.Data
    if (d.StatusStr === 'success') { done.push({ ...t, data: d }); break }
    if (d.StatusStr === 'failed') { console.error(`块 ${t.i} 失败: ${d.ErrorMsg}`); break }
    sleep(5000)
  }
}
if (done.length !== tasks.length) console.error(`⚠ ${tasks.length - done.length} 块未成功，结果不完整`)

// ── 合并（加上分块时间偏移）
const segments = []
for (const t of done) {
  for (const s of (t.data.ResultDetail ?? [])) {
    segments.push({
      t: [+(t.start + s.StartMs / 1000).toFixed(2), +(t.start + s.EndMs / 1000).toFixed(2)],
      text: s.FinalSentence,
      ref: `${basename(SRC)}@${sha256.slice(0, 8)}#t=${(t.start + s.StartMs / 1000).toFixed(2)},${(t.start + s.EndMs / 1000).toFixed(2)}`,
      prosody: {
        speech_speed: s.SpeechSpeed,               // 字/秒
        emotional_energy: s.EmotionalEnergy,
        silence_before_ms: s.SilenceTime,
        speaker: s.SpeakerId,
        emotion: s.EmotionType ?? [],
        words: s.WordsNum,
      },
      chunk: t.i,
    })
  }
}
segments.sort((a, b) => a.t[0] - b.t[0])

const speechS = segments.reduce((a, s) => a + (s.t[1] - s.t[0]), 0)
const spds = segments.map(s => s.prosody.speech_speed).filter(Number.isFinite)
const engs = segments.map(s => s.prosody.emotional_energy).filter(Number.isFinite)
const med = xs => { const q = [...xs].sort((a, b) => a - b); return q.length ? q[q.length >> 1] : null }

const doc = {
  $schema: 'origin/dialect-video/asr/v0.1',
  source: { file: SRC, sha256, duration_s: +duration.toFixed(2) },
  engine: {
    impl: 'tccli asr CreateRecTask', model: '16k_zh', mode: 'cloud',
    res_text_format: 3, emotion: true, diarization: true,
    chunks: nChunks, chunk_s: CHUNK, chunks_ok: done.length,
  },
  basis: 'transcribed',
  prosody_basis: 'measured',
  totals: {
    segments: segments.length,
    chars: segments.reduce((a, s) => a + s.text.length, 0),
    speech_seconds: +speechS.toFixed(1),
    speech_ratio: +(speechS / duration).toFixed(3),
    speakers: [...new Set(segments.map(s => s.prosody.speaker))].length,
    speech_speed_median: med(spds),
    emotional_energy_median: med(engs),
    emotion_typed_segments: segments.filter(s => s.prosody.emotion.length).length,
  },
  limits: [
    {
      code: 'T-CHUNK-CUTS-SENTENCES', kind: 'lossy', scope: 'segments 边界',
      statement: `音频按固定 ${CHUNK}s 切成 ${nChunks} 块提交（CreateRecTask 的 Data 上限 5MB）。`
        + `切点落在句中时，该句会被拆成两条不完整的记录，语速与情绪能量也随之失真。`
        + `受影响的位置：${tasks.slice(1).map(t => t.start + 's').join(' ')}`,
      remedy: '改用 Url 方式提交整段（需要 COS），或按静音点切而不是按固定时长',
    },
    {
      code: 'T-PROSODY-NOT-VALUE', kind: 'unverified', scope: 'segments[*].prosody',
      statement: '语速/情绪能量/停顿是 measured，但「韵律高 = 爆点」这个映射本身没有被验证过。'
        + '本项目上一次用声学信号猜价值（10s 窗 RMS）实测与价值反相关。'
        + '句级韵律是否更好，必须单独测，不能假定。',
      remedy: '拿它跟已有 timeline 的 value 做相关性检验（correlate.mjs）',
    },
    {
      code: 'T-TRANSCRIBED-NOT-OBSERVED', kind: 'unverified', scope: 'segments[*].text',
      statement: '转写是模型输出。本引擎实测把「优质一点」听成「荧光点」、「能说」听成「李说」。',
      remedy: '对高价值事件回到 ref 复听',
    },
  ],
  segments,
}

const dest = OUT ?? join(dirname(SRC), basename(SRC, extname(SRC)) + '.tcasr.json')
writeFileSync(dest, JSON.stringify(doc, null, 2))
rmSync(work, { recursive: true, force: true })

console.log('')
console.log(`${segments.length} 段 / ${doc.totals.chars} 字 / 语音占 ${(doc.totals.speech_ratio * 100).toFixed(0)}%`)
console.log(`说话人 ${doc.totals.speakers} 个 · 语速中位 ${doc.totals.speech_speed_median} 字/秒 · 情绪能量中位 ${doc.totals.emotional_energy_median?.toFixed(2)}`)
console.log(`带情绪标签的句子 ${doc.totals.emotion_typed_segments} 条`)
console.log(`→ ${dest}`)
