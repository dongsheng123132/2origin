#!/usr/bin/env node
// W2 判分：缺陷检出——把各臂在 Planted 版语料上报出的矛盾与答案集比对，计准确率/召回率。
//
//   node detect-score.mjs <arm-detections.json>
//
// arm-detections.json 形如：
//   { "arm": "...", "detections": [ { "chapter": 10, "description": "白遥用左手…" } ] }
//
// 匹配规则：章节号必须一致，且描述须命中该条注入的关键特征词之一（宽松匹配，
// 避免因措辞不同而漏判——宁可放宽也不能把「找对了但说法不同」算成漏报）。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ANSWER = JSON.parse(readFileSync(join(HERE, '..', 'world', 'planted.json'), 'utf8'))

// 每条注入的特征词（命中任一即算指认成功）
const SIGNATURES = {
  'planted:001': ['左手', '白遥'],
  'planted:002': ['林峥', '北庭', '知道', '不该'],
  'planted:003': ['正午', '午时', '月台', '开启', '时辰'],
  'planted:004': ['老陶', '钥匙', '赵七'],
  'planted:005': ['铜铃', '禽鸟', '三日前', '两次'],
  'planted:006': ['沈砚', '内应', '第七章', '过早'],
}

export function scoreW2(reported) {
  const planted = ANSWER.planted
  const traps = ANSWER.false_positive_traps
  const dets = reported.detections ?? []
  const used = new Set()

  const matched = planted.map((p) => {
    const sig = SIGNATURES[p.id] ?? []
    const hit = dets.findIndex(
      (d, i) => !used.has(i) && d.chapter === p.chapter && sig.some((s) => (d.description ?? '').includes(s))
    )
    if (hit >= 0) used.add(hit)
    return { id: p.id, chapter: p.chapter, category: p.category, difficulty: p.difficulty, found: hit >= 0 }
  })

  // 未匹配上任何注入的上报 = 误报；落在陷阱章节的额外标注出来
  const falsePositives = dets
    .map((d, i) => ({ ...d, i }))
    .filter((d) => !used.has(d.i))
    .map((d) => ({
      chapter: d.chapter,
      description: d.description,
      trap: traps.find((t) => t.chapter === d.chapter)?.id ?? null,
    }))

  const found = matched.filter((m) => m.found).length
  const recall = found / planted.length
  const precision = dets.length ? found / dets.length : 0

  const byDifficulty = {}
  for (const m of matched) {
    byDifficulty[m.difficulty] ??= { found: 0, total: 0 }
    byDifficulty[m.difficulty].total++
    if (m.found) byDifficulty[m.difficulty].found++
  }

  return {
    arm: reported.arm,
    matched,
    falsePositives,
    trapsTriggered: falsePositives.filter((f) => f.trap).length,
    recall,
    precision,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    byDifficulty,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  if (!file) {
    console.log('用法: node detect-score.mjs <arm-detections.json>')
    process.exit(1)
  }
  const r = scoreW2(JSON.parse(readFileSync(file, 'utf8')))
  console.log(`# W2 缺陷检出 · ${r.arm}\n`)
  for (const m of r.matched)
    console.log(`  ${m.found ? '✓' : '✗'} ${m.id}  ch${String(m.chapter).padStart(2)}  ${m.difficulty.padEnd(6)} ${m.category}`)
  if (r.falsePositives.length) {
    console.log('\n  误报：')
    for (const f of r.falsePositives)
      console.log(`    ch${f.chapter} ${f.description}${f.trap ? `  ← 踩中陷阱 ${f.trap}` : ''}`)
  }
  console.log(
    `\n  召回率 ${(r.recall * 100).toFixed(1)}%  准确率 ${(r.precision * 100).toFixed(1)}%  F1 ${(r.f1 * 100).toFixed(1)}%  踩陷阱 ${r.trapsTriggered}`
  )
  console.log('  分难度：', Object.entries(r.byDifficulty).map(([k, v]) => `${k} ${v.found}/${v.total}`).join('  '))
}
