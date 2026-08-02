#!/usr/bin/env node
// 生成 Planted 版语料：把 planted.json 里的 6 处已知矛盾注入干净语料。
//
// 两个用途：
//   ① W2（缺陷检出）的试卷
//   ② **判官校准**——这是一份有标准答案的卷子，可以量出判官的准确率/召回率。
//      没有它，语义通道的判读结果无从判断可信度（Run #4 里两个判官报了 1 处 vs 17 处，
//      谁对谁错无从裁决）。
//
//   node tools/plant.mjs          生成 corpus-planted/
//   node tools/plant.mjs --show   只打印注入方案，不写文件

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(dirname(fileURLToPath(import.meta.url)))
const ANSWER = JSON.parse(readFileSync(join(HERE, 'world/planted.json'), 'utf8'))
const SRC = join(HERE, 'corpus')
const OUT = join(HERE, 'corpus-planted')

/** 注入文案里的括号是给人看的说明，不进正文 */
const cleanInjection = (s) => s.replace(/（[^）]*）/g, '').trim()

/** 选一个插入点：优先插在提及相关人物的段落之后，否则插在正文中段 */
function pickAnchor(paragraphs, hint) {
  const names = ['白遥', '林峥', '赵七', '沈砚', '裴照', '阿枝', '老陶', '云姑'].filter((n) => hint.includes(n))
  for (let i = Math.floor(paragraphs.length * 0.3); i < paragraphs.length - 1; i++) {
    if (names.some((n) => paragraphs[i].includes(n))) return i
  }
  return Math.floor(paragraphs.length / 2)
}

mkdirSync(OUT, { recursive: true })
const manifest = []

for (const p of ANSWER.planted) {
  const file = `ch${String(p.chapter).padStart(2, '0')}.txt`
  const src = join(SRC, file)
  if (!existsSync(src)) {
    console.error(`✗ 缺少 ${file}，先生成干净语料`)
    process.exit(1)
  }
  const dst = join(OUT, file)
  const text = readFileSync(existsSync(dst) ? dst : src, 'utf8') // 同章多处注入时叠加
  const paragraphs = text.split(/\n\n+/)
  const injection = cleanInjection(p.injection)
  const at = pickAnchor(paragraphs, injection)

  paragraphs.splice(at + 1, 0, injection)
  if (!process.argv.includes('--show')) writeFileSync(dst, paragraphs.join('\n\n'), 'utf8')

  manifest.push({ id: p.id, chapter: p.chapter, category: p.category, difficulty: p.difficulty, paragraph: at + 1, text: injection })
  console.log(`  ${p.id}  ch${String(p.chapter).padStart(2)}  段${at + 1}  ${p.difficulty.padEnd(6)} ${injection.slice(0, 34)}…`)
}

// 未被注入的章节原样复制，保证 Planted 版是完整的一本
const untouched = []
for (let i = 1; i <= 10; i++) {
  const file = `ch${String(i).padStart(2, '0')}.txt`
  if (!existsSync(join(OUT, file))) {
    if (!process.argv.includes('--show')) writeFileSync(join(OUT, file), readFileSync(join(SRC, file), 'utf8'), 'utf8')
    untouched.push(i)
  }
}

if (!process.argv.includes('--show')) {
  writeFileSync(join(OUT, 'planted-manifest.json'), JSON.stringify({ planted: manifest, cleanChapters: untouched }, null, 2))
  console.log(`\n✓ 已写入 corpus-planted/（${manifest.length} 处注入，${untouched.length} 章保持干净作对照）`)
  console.log('  干净章节用于量误报：判官在这些章报出的任何「注入型矛盾」都是假阳性')
}
