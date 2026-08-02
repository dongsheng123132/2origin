#!/usr/bin/env node
// 判官校准 + W2（缺陷检出）：让判官做一份有标准答案的卷子。
//
// Run #4 暴露的问题：两个判官在同一批文本上报出 1 处 vs 17 处，谁准无从判断。
// 解法是给它们做 Planted 版语料——6 处注入位置与内容全都已知，于是可以直接量出
// 召回率（该找的找到了多少）与准确率（报出来的有多少是真的）。
//
//   node eval/calibrate.mjs                    两个判官都跑
//   node eval/calibrate.mjs --judges hermes
//
// 注意：干净章节里判官报出的东西不能一概算错——干净语料只通过了确定性通道校验，
// 语义层面未必绝对无瑕。故此处称「非注入指认」而非「误报」，其中可能混有真问题。

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadSpec } from './replay.mjs'
import { judgeArm, crossCheck } from './judge.mjs'
import { createModel } from '../arms/lib/model.mjs'

const HERE = dirname(dirname(fileURLToPath(import.meta.url)))
const PLANTED = join(HERE, 'corpus-planted')
if (!existsSync(join(PLANTED, 'planted-manifest.json'))) {
  console.error('✗ 先跑 node tools/plant.mjs 生成 Planted 版语料')
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(join(PLANTED, 'planted-manifest.json'), 'utf8'))
const spec = loadSpec()

const chapters = spec.outline.map((ch) => ({
  chapter: ch.chapter,
  text: readFileSync(join(PLANTED, `ch${String(ch.chapter).padStart(2, '0')}.txt`), 'utf8'),
}))
const words = chapters.reduce((n, c) => n + c.text.replace(/\s/g, '').length, 0)

/** 判读是否指向某处注入：同章 + 引用与注入文本有实质重叠 */
function hits(finding, planted) {
  if (finding.chapter !== planted.chapter) return false
  const q = finding.quote ?? ''
  if (q.length < 4) return false
  const core = planted.text.replace(/[。，、：；“”"'']/g, '')
  const qc = q.replace(/[。，、：；“”"'']/g, '')
  return core.includes(qc.slice(0, 8)) || qc.includes(core.slice(0, 8))
}

const i = process.argv.indexOf('--judges')
const judges = (i >= 0 ? process.argv[i + 1] : 'hermes,bailian').split(',')

console.log(`# 判官校准 · Planted 版语料（10 章 / ${words} 字 / ${manifest.planted.length} 处已知注入）\n`)

const runs = []
for (const j of judges) {
  const model = j === 'bailian' ? createModel({ provider: 'bailian', model: 'qwen-plus' }) : createModel({ provider: 'hermes' })
  process.stdout.write(`  判读中（${j}）… `)
  const r = await judgeArm({ chapters, judgeName: j, model })
  console.log(`报出 ${r.findings.length} 处`)
  runs.push({ judge: j, ...r })
}

const score = (findings) => {
  const found = manifest.planted.filter((p) => findings.some((f) => hits(f, p)))
  const matched = findings.filter((f) => manifest.planted.some((p) => hits(f, p)))
  return {
    recall: found.length / manifest.planted.length,
    precision: findings.length ? matched.length / findings.length : 0,
    found: found.map((p) => p.id),
    missed: manifest.planted.filter((p) => !found.includes(p)).map((p) => `${p.id}(${p.difficulty})`),
    nonPlanted: findings.length - matched.length,
  }
}

console.log('\n## 各判官表现\n')
console.log('  判官        报出   命中注入   召回率   准确率   非注入指认')
for (const r of runs) {
  const s = score(r.findings)
  console.log(
    `  ${r.judge.padEnd(10)}  ${String(r.findings.length).padStart(3)}   ` +
      `${String(s.found.length).padStart(6)}/${manifest.planted.length}   ` +
      `${(s.recall * 100).toFixed(0).padStart(5)}%   ${(s.precision * 100).toFixed(0).padStart(5)}%   ${String(s.nonPlanted).padStart(6)}`
  )
}

for (const r of runs) {
  const s = score(r.findings)
  if (s.missed.length) console.log(`\n  ${r.judge} 漏掉：${s.missed.join('、')}`)
}

const { agreed, disputed } = crossCheck(runs[0].findings, runs[1]?.findings ?? [])
const sa = score(agreed)
console.log(`\n## 双方一致项（当前语义通道的采信口径）\n`)
console.log(`  共 ${agreed.length} 处，命中注入 ${sa.found.length}/${manifest.planted.length}，召回率 ${(sa.recall * 100).toFixed(0)}%，准确率 ${(sa.precision * 100).toFixed(0)}%`)
if (sa.missed.length) console.log(`  漏掉：${sa.missed.join('、')}`)
console.log(`  分歧项 ${disputed.length} 处（不计入）`)

console.log(`\n## 结论`)
const strict = sa.recall
if (strict < 0.5)
  console.log(`  ⚠ 一致口径召回率仅 ${(strict * 100).toFixed(0)}%——过严，会漏掉大半真问题。语义 CED 目前偏低估，不可用作「更少错误」的证据。`)
else console.log(`  一致口径召回率 ${(strict * 100).toFixed(0)}%，可作为语义通道的下界估计。`)

writeFileSync(
  join(HERE, 'results', 'calibration.json'),
  JSON.stringify({ words, planted: manifest.planted.length, perJudge: runs.map((r) => ({ judge: r.judge, ...score(r.findings), total: r.findings.length })), agreed: { count: agreed.length, ...sa } }, null, 2)
)
console.log(`\n已写入 results/calibration.json`)
