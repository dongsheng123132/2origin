#!/usr/bin/env node
// 把投影的 pick 边界吸附到 ASR 句边界上。
//
// ## 为什么需要它
//
// 直播那条素材第一次渲染出来，[120,150] 这一段把全片最强的钩子腰斩了——
// 「国内你能赚1万块钱的时候，在海外是35万」这句从 148.16s 才开始，而段落 150s 就结束。
// 成片里只剩半句。ffmpeg 不会报错，validate 也查不出来（时间码完全合法）。
//
// 手工划的 60s 粒度边界必然干这种事。而口播型素材根本不需要靠抽帧去找边界——
// **ASR 的句级时间戳就是天然的剪辑点**，比二遍精读更准也更便宜。
//
// 用法:
//   node snap.mjs <timeline.json> <asr.json> [--projection name] [--write]
//   node snap.mjs <timeline.json> <asr.json> --find "35万"      # 按台词找时间码

import { readFileSync, writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1] }
const [tlPath, asrPath] = argv.filter(a => !a.startsWith('--')).slice(0, 2)
if (!tlPath || !asrPath) {
  console.error('用法: node snap.mjs <timeline.json> <asr.json> [--projection name] [--write] [--find 台词]')
  process.exit(2)
}
const tl = JSON.parse(readFileSync(tlPath, 'utf8'))
const asr = JSON.parse(readFileSync(asrPath, 'utf8'))
if (tl.source.sha256 !== asr.source.sha256) {
  console.error(`✗ timeline 与 asr 描述的不是同一条素材：${tl.source.sha256.slice(0, 8)} vs ${asr.source.sha256.slice(0, 8)}`)
  process.exit(1)
}
const segs = asr.segments

// ── 按台词检索：给定一句话，返回它的时间码
const find = arg('--find', null)
if (find) {
  const hits = segs.filter(s => s.text.includes(find))
  if (!hits.length) { console.log(`没找到「${find}」`); process.exit(0) }
  for (const h of hits) console.log(`${h.t[0]}–${h.t[1]}s  ${h.text}`)
  process.exit(0)
}

/** 把 [a,b] 吸附到覆盖它的完整句子区间：起点往前吸到句首，终点往后吸到句尾。 */
function snap(a, b, maxDrift = 12) {
  const inside = segs.filter(s => s.t[1] > a && s.t[0] < b)
  if (!inside.length) return { t: [a, b], note: '区间内无语音，保持原样' }
  let s0 = inside[0].t[0], s1 = inside[inside.length - 1].t[1]
  // 起点：如果第一句在 a 之前就开始了，说明 a 切在句中——往前吸到句首
  if (a - s0 > maxDrift) s0 = inside.length > 1 ? inside[1].t[0] : a   // 漂太远则丢掉这半句
  // 终点：最后一句若在 b 之后才结束，往后吸到句尾
  if (s1 - b > maxDrift) s1 = inside.length > 1 ? inside[inside.length - 2].t[1] : b
  return {
    t: [+s0.toFixed(2), +s1.toFixed(2)],
    sentences: inside.length,
    drift: [+(s0 - a).toFixed(2), +(s1 - b).toFixed(2)],
    first: inside[0].text.slice(0, 24),
    last: inside[inside.length - 1].text.slice(-24),
  }
}

const only = arg('--projection', null)
const write = argv.includes('--write')
let changed = 0

for (const [name, p] of Object.entries(tl.projections ?? {})) {
  if (only && name !== only) continue
  console.log(`\n══ ${name}`)
  const out = []
  for (const [i, [a, b]] of (p.pick ?? []).entries()) {
    const r = snap(a, b)
    const moved = r.t[0] !== a || r.t[1] !== b
    if (moved) changed++
    console.log(`  第${i + 1}段 [${a},${b}] ${moved ? '→ [' + r.t.join(',') + ']' : '（不动）'}` +
      (r.sentences ? `  ${r.sentences} 句  漂移 ${r.drift?.join('/')}s` : `  ${r.note}`))
    if (r.first) console.log(`      首「${r.first}…」  尾「…${r.last}」`)
    out.push(r.t)
  }
  if (write) p.pick = out
}

if (write) {
  writeFileSync(tlPath, JSON.stringify(tl, null, 2))
  console.log(`\n已写回 ${tlPath}（${changed} 段边界被吸附）`)
} else {
  console.log(`\n${changed} 段边界会被吸附。加 --write 写回。`)
}
