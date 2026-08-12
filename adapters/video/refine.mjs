#!/usr/bin/env node
// 高价值区间复核 —— 用视频原生 LLM 修正 ASR 的转写
//
// ## 三条通道各自擅长什么（全部实测，见 docs/05）
//
//   百炼 fun-asr    句级+词级时间戳，56.7x 实时，全片覆盖便宜   ← 骨架
//   腾讯 16k_zh     同上 + 句级韵律（语速/情绪能量/停顿/说话人）  ← 骨架+韵律
//   qwen3.5-omni    转写最准，专有名词能出英文原名，但**没有时间戳** ← 复核
//
// 同一段 16 秒的产品名实测：
//   omni  「这是 cloud code 呀、codex 啊、龙虾啊、Hermes 啊」   ✓
//   百炼  「就是他刻的呀，刻戴斯啊、龙虾啊、欧莫斯啊」          ✗
//   腾讯  「就是拉克的呀，啊虾啊，托斯啊这种场」                 ✗
//
// 所以不是三选一，是**分工**：ASR 出时间码骨架，omni 只对 value≥阈值的区间做复核。
// omni 没有时间戳这件事不再是问题——时间码由 ASR 提供，omni 只负责把字听对。
//
// 用法:
//   node refine.mjs <timeline.json> [--min-value 0.7] [--write]

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1] }
const tlPath = argv.find(a => !a.startsWith('--'))
const MIN = parseFloat(arg('--min-value', '0.7'))
const WRITE = argv.includes('--write')
if (!tlPath) { console.error('用法: node refine.mjs <timeline.json> [--min-value 0.7] [--write]'); process.exit(2) }

const tl = JSON.parse(readFileSync(tlPath, 'utf8'))
const root = dirname(resolve(tlPath))
const src = join(root, tl.source.file)
const work = mkdtempSync(join(tmpdir(), 'refine-'))
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

const targets = tl.events.filter(e => (e.value ?? 0) >= MIN)
console.log(`${tlPath}: ${targets.length} 个事件 value ≥ ${MIN}，逐个复核\n`)

let changed = 0
for (const e of targets) {
  const [a, b] = e.t
  const clip = join(work, `${e.id}.mp4`)
  // 低码率小分辨率：复核只要听清 + 看个大概，不需要画质
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-nostdin', '-ss', String(a), '-t', String(b - a),
    '-i', src, '-vf', 'scale=360:-2,fps=8', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
    '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', clip],
    { stdio: ['ignore', 'pipe', 'pipe'] })

  let text
  try {
    text = bl(['omni', '--video', clip, '--text-only', '--temperature', '0', '--message',
      '逐字写出这段视频里说话人说的话。若提到英文产品名/工具名，写英文原名，不要写成同音汉字。只输出台词，不要解释。'])
  } catch (err) {
    console.log(`  ${e.id} 复核失败：${err.message.slice(0, 80)}`)
    continue
  }

  const before = e.gist ?? ''
  console.log(`── ${e.id} [${a},${b}] value=${e.value}`)
  console.log(`   ASR : ${before.slice(0, 70)}`)
  console.log(`   omni: ${text.slice(0, 70)}`)
  if (WRITE) {
    e.gist = text.length > 160 ? text.slice(0, 160) + '…' : text
    e.gist_from = 'transcribed'
    e.evidence = [...(e.evidence ?? []),
      `qwen3.5-omni 视频复核 ${e.ref}（omni 无时间戳，时间码来自 ASR）`]
    changed++
  }
  console.log('')
}

rmSync(work, { recursive: true, force: true })

if (WRITE && changed) {
  tl.limits = tl.limits ?? []
  if (!tl.limits.some(l => l.code === 'L-OMNI-REFINED')) {
    tl.limits.push({
      code: 'L-OMNI-REFINED', kind: 'unverified', scope: `events[value≥${MIN}].gist`,
      statement: `${changed} 个高价值事件的 gist 已由 qwen3.5-omni 视频复核改写（专有名词与数字更准）。`
        + 'omni 本身没有时间戳，时间码仍来自 ASR——两条通道的对齐没有被独立验证过，'
        + '若 ASR 的区间划错，复核出来的文字会被贴到错误的时间码上。',
      remedy: '复核前先用 snap.mjs 把区间吸附到 ASR 句边界；抽样人工复听',
    })
  }
  writeFileSync(tlPath, JSON.stringify(tl, null, 2))
  console.log(`已写回 ${tlPath}（${changed} 个事件的 gist 被复核改写）`)
} else if (!WRITE) {
  console.log('加 --write 写回。')
}
