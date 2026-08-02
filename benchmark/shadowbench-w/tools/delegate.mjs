#!/usr/bin/env node
// 把批量机械活派给本机廉价模型（hermes HTTP 通道）。
//
// 分工原则（见用户 CLAUDE.md）：重活（架构、协议、判分器设计、关键决策）留给 Claude；
// 批量重复、不要求强推理的活（判读、初筛、改写、摘要、语料生成）一律派出去。
//
//   node tools/delegate.mjs <任务文件> [--out 输出文件] [--json]
//   node tools/delegate.mjs task.md --out result.md
//
// 任务文件即提示词全文（走 HTTP，无长度上限）。--json 时要求模型只输出 JSON 并解析。

import { readFileSync, writeFileSync } from 'node:fs'
import { createModel } from '../arms/lib/model.mjs'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
if (!file) {
  console.log('用法: node tools/delegate.mjs <任务文件> [--out 输出] [--json] [--model <id>]')
  process.exit(1)
}
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null }

const prompt = readFileSync(file, 'utf8')
const model = createModel({ provider: 'hermes', model: arg('model') ?? undefined })
process.stderr.write(`→ 派给 ${model.id}（${prompt.length} 字符）… `)

const res = await model.complete({ prompt, maxTokens: Number(arg('max-tokens') ?? 8192) })
process.stderr.write(`${res.usage.outputTokens} tok，${(res.usage.ms / 1000).toFixed(1)}s\n`)

const out = args.includes('--json') ? JSON.stringify(res.parsed ?? { _raw: res.raw }, null, 2) : res.raw
const dest = arg('out')
if (dest) {
  writeFileSync(dest, out, 'utf8')
  console.error(`✓ 已写入 ${dest}`)
} else {
  console.log(out)
}
