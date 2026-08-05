#!/usr/bin/env node
// OriginWriter · 真实续写闭环（模型 → 事务 → 门禁 → 落盘）
//
// 证明「可应用」的完整链路：模型拿到世界状态投影 → 续写一章 →
// 产出正文 + 状态变更事务 → 过五道门禁 → 落盘。失败自动按理由重写重试。
//
//   node adapters/story/run-chapter.mjs <pkg.origin> <章号> [--provider hermes|bailian|stub] [--model 模型]
//
// 依赖 benchmark/shadowbench-w/arms/lib/model.mjs 的 provider 通道
// （hermes 直连本机 config.yaml 端点；bailian 走本地 bl CLI；stub 用于无模型自测）。
//
// 零依赖。输出即证据：每一步打印什么给模型、模型回了什么、门禁结果如何。

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { loadOrigin } from '../../compiler/origin.mjs'
import { projectState, submitChapter } from './engine.mjs'
import { createModel } from '../../benchmark/shadowbench-w/arms/lib/model.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

const args = process.argv.slice(2)
const PKG = args[0]
const CHAPTER = args[1] ? Number(args[1]) : null
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name)
  return i >= 0 ? args[i + 1] : dflt
}
const provider = opt('provider', 'hermes')
const modelName = opt('model', null)
const maxTokens = Number(opt('max-tokens', '8192'))
const maxRetries = Number(opt('retries', '3'))

if (!PKG || !CHAPTER) {
  console.error('用法：node adapters/story/run-chapter.mjs <pkg.origin> <章号> [--provider hermes|bailian|stub] [--model 模型]')
  process.exit(2)
}

// ── 提示词：世界状态投影 + 写作指令 ──
function buildPrompt(pkgDir, chapter, prevText) {
  const state = projectState(pkgDir, { task: `续写第 ${chapter} 章` })
  const prev = prevText
    ? `\n\n【上一章结尾】…${prevText.slice(-300)}`
    : ''
  return `你是一个长篇小说续写引擎。世界状态已经持久化，现在要写第 ${chapter} 章。

【世界状态】（字段值原样照抄，含前缀）
${state}
${prev}

【写作要求】
1. 写第 ${chapter} 章正文，约 3000 字，承接世界状态，推进剧情。
2. 同时提交本章导致的【世界状态变更】——只写本章实际发生的改变，没变的不写。
3. 严守禁区：状态里列出的禁区一条都不能违反。
4. 输出必须是单个 JSON 对象（不要输出其他文字），形状：
{
  "chapter": ${chapter},
  "transaction_id": "ch${chapter}-auto",
  "text": "本章正文…",
  "state_changes": [
    {"object": "obj:xxx", "field": "yyy", "from": "旧值", "to": "新值", "basis": ["scene:${chapter}-01"]}
  ],
  "assertions": ["zhao-qi-alive", "gate-not-opened", "key-intact", "betrayal-undisclosed", "left-hand-still-injured"],
  "hooks": []
}
state_changes 里 from 填你认为的当前值（写错只记为偏差，不拒绝）；对象 ID 必须带前缀。
若本章没有任何状态改变，state_changes 给空数组。
文字用中文。`
}

// ── 主流程 ──
const model = createModel({ provider, model: modelName })
console.log(`模型：${model.id}｜章：${CHAPTER}｜包：${PKG}\n`)

// 上一章正文（若有）
const prevPath = join(PKG, 'narrative', 'chapters', `ch${String(CHAPTER - 1).padStart(2, '0')}.txt`)
let prevText = ''
try { prevText = readFileSync(prevPath, 'utf8') } catch { /* 第一章无前文 */ }

let attempt = 0
while (attempt < maxRetries) {
  attempt++
  const prompt = buildPrompt(PKG, CHAPTER, prevText)
  console.log(`── 第 ${attempt} 次尝试：调用 ${model.id} ──`)
  const t0 = Date.now()
  const res = await model.complete({ prompt, maxTokens })
  const ms = Date.now() - t0

  const m = (res.raw ?? '').match(/\{[\s\S]*\}/)
  let tx = null
  if (m) try { tx = JSON.parse(m[0]) } catch (e) { console.error(`  ✗ 模型输出不是合法 JSON：${e.message.slice(0, 80)}`) }
  if (!tx) {
    console.error(`  ✗ 未解析出事务（输出 ${res.raw.length} 字符）`)
    continue
  }
  console.log(`  ✓ 解析出事务：text ${String(tx.text ?? '').length} 字，${(tx.state_changes ?? []).length} 条状态变更，${(tx.assertions ?? []).length} 条断言`)
  if (tx.text && tx.text.length < 100) console.warn(`  ⚠ 正文过短（${tx.text.length} 字），疑似模型偷懒`)

  // 模型可能漏掉 chapter——注入命令行章号，防写错文件
  if (tx.chapter === undefined) tx.chapter = CHAPTER
  const r = submitChapter(PKG, tx, { by: model.id, expect_seq: null })
  if (r.ok) {
    console.log(`\n✓ 第 ${CHAPTER} 章落盘：seq ${r.receipt.seq_from}–${r.receipt.seq_to}，${r.receipt.chars} 字，正文存 ${r.receipt.text_file}（${ms}ms，${JSON.stringify(res.usage ?? {})}）`)
    for (const ref of r.receipt.changed) console.log(`  状态变更：${ref}`)
    for (const w of r.receipt.warnings ?? []) console.log(`  ⚠ ${w.msg}`)
    process.exit(0)
  }

  const reasons = r.violations.filter((v) => v.severity !== 'warning').map((v) => `- [${v.code}] ${v.msg}`).join('\n')
  console.error(`  ✗ 门禁拒绝（${r.errors} 条错误）：\n${reasons}`)
  if (attempt >= maxRetries) {
    console.error(`\n✗ 重试 ${maxRetries} 次仍未通过。世界状态未动（seq=${(await import('../../compiler/store.mjs')).seqOf(PKG)}）。`)
    process.exit(1)
  }
  console.error(`  按理由重写（还有 ${maxRetries - attempt} 次机会）…\n`)
}
