#!/usr/bin/env node
// 基线语料校验：生成出来的正文本身必须是干净的。
// 若基线语料自带矛盾，后续所有测量都被污染——这一步不能省。
//
//   node tools/check-corpus.mjs

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadSpec } from '../eval/replay.mjs'
import { scoreW1 } from '../eval/ced.mjs'

const HERE = dirname(dirname(fileURLToPath(import.meta.url)))
const spec = loadSpec()

const chapters = spec.outline
  .map((ch) => {
    const f = join(HERE, 'corpus', `ch${String(ch.chapter).padStart(2, '0')}.txt`)
    return existsSync(f) ? { chapter: ch.chapter, title: ch.title, text: readFileSync(f, 'utf8') } : null
  })
  .filter(Boolean)

if (!chapters.length) {
  console.error('✗ corpus/ 下没有章节文件，先跑 tools/gen-corpus.mjs')
  process.exit(1)
}

console.log(`# 基线语料校验（${chapters.length}/${spec.outline.length} 章）\n`)
for (const c of chapters) console.log(`  第 ${String(c.chapter).padStart(2)} 章《${c.title}》 ${c.text.replace(/\s/g, '').length} 字`)

const r = scoreW1({ arm: '__corpus__', chapters })
console.log(`\n共 ${r.words} 字\n`)

if (r.findings.length) {
  console.log('✗ 基线语料存在确定性可判的矛盾，须重生成对应章节：\n')
  for (const f of r.findings) console.log(`  ch${f.chapter} [${f.rule}] ${f.why}\n     「${f.quote}」\n`)
} else {
  console.log('✓ 确定性通道未发现矛盾')
}
console.log('⚠ 语义通道（知识越界等）未接入，正式发布前需人工抽检 + 双模型交叉复核。')
process.exit(r.findings.length ? 1 : 0)
