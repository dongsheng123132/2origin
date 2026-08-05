#!/usr/bin/env node
// 规则怪谈·无限层 —— 专属续写闭环（模型 → 事务 → 门禁 → 落盘）
//
// 与 run-chapter.mjs 的区别（规则怪谈的「规则机器可验证」卖点）：
//   1. 文本禁区检查：层的明规则翻译成正文词表（text_not_contains），
//      正文出现「扫码/刷卡/数人头/看第7排」等即被门禁拒绝——违反规则被机器抓住。
//   2. 自定义断言表（主角存活/层状态/手册完好），模型自立的字据逐条验收。
//   3. 不挂 ShadowBench-W 的 CED RULES（那是《月落渡口》写死的，会误伤新作品）。
//
//   node adapters/story/rk/rk-run.mjs <pkg.origin> <章号> [--provider hermes|bailian|stub]
//        [--max-tokens 20000] [--retries 3] [--brief "本章剧情要求…"]
//
// 输出即证据：每一步打印给模型什么、模型回了什么、门禁结果如何。

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadOrigin } from '../../../compiler/origin.mjs'
import { initWriter, projectState } from '../engine.mjs'
import { initPackage, commit } from '../../../compiler/store.mjs'
import { validateTransaction as coreValidate } from '../../../compiler/commit-compiler.mjs'
import { hookViolations } from '../dialect.mjs'
import { createModel } from '../../../benchmark/shadowbench-w/arms/lib/model.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CHAPTERS_DIR = ['narrative', 'chapters']
const OUTLINE = ['narrative', 'chapters', 'outline.jsonl']

const args = process.argv.slice(2)
const PKG = args[0]
const CHAPTER = args[1] ? Number(args[1]) : null
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name)
  return i >= 0 ? args[i + 1] : dflt
}
const provider = opt('provider', 'hermes')
const modelName = opt('model', null)
const maxTokens = Number(opt('max-tokens', '20000'))
const maxRetries = Number(opt('retries', '3'))
const brief = opt('brief', '')

if (!PKG || !CHAPTER) {
  console.error('用法：node adapters/story/rk/rk-run.mjs <pkg.origin> <章号> [--provider hermes|bailian|stub] [--brief "剧情要求"]')
  process.exit(2)
}

// ── 规则怪谈断言表（模型自立的字据，逐条机器验收）──
const RK_ASSERTIONS = {
  'lin-ke-alive': (s) => s['char:lin-ke']?.alive === true,
  'chen-ye-alive': (s) => s['char:chen-ye']?.alive === true,
  'store-active': (s) => s['loc:layer01-store']?.status === 'active',
  'rulebook-intact': (s) => s['obj:rulebook']?.intact === true,
}

// ── 读 spec 的文本禁区（text_not_contains 词表）──
function textZones() {
  const dir = join(HERE, 'spec', 'tasks')
  const out = []
  for (const f of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : []) {
    const t = JSON.parse(readFileSync(join(dir, f), 'utf8'))
    for (const z of t?.forbidden_zones ?? []) {
      if (z.machine_check?.type === 'text_not_contains') out.push(z)
    }
  }
  return out
}

// ── 文本禁区检查：正文出现禁用词即拒（违反怪谈规则 = 被机器抓住）──
function textZoneCheck(text, zones) {
  const out = []
  for (const z of zones) {
    for (const v of z.machine_check.values ?? []) {
      if (text.includes(v)) {
        out.push({ code: 'text-zone', severity: 'error', quote: v, msg: `触碰文本禁区 ${z.id}（${z.rule}）：正文出现「${v}」` })
      }
    }
  }
  return out
}

// ── 提示词：世界状态投影 + 本层规则 + 剧情要求 ──
function buildPrompt(pkgDir, chapter, zones, prevText) {
  const state = projectState(pkgDir, { task: `续写第 ${chapter} 章` })
  const ruleLines = zones.map((z) => `- ${z.rule}（违反即拒绝落盘）`).join('\n')
  const prev = prevText ? `\n\n【上一章结尾】…${prevText.slice(-300)}` : ''
  const briefLine = brief ? `\n【本章剧情要求】${brief}\n` : ''
  return `你是一个长篇悬疑小说《规则怪谈·无限层》的续写引擎。世界状态已持久化，现在要写第 ${chapter} 章。

【世界状态】（字段值原样照抄，含前缀）
${state}${prev}

【本层规则·写作禁区】正文一旦出现下列情形会被机器门禁拒绝，必须绝对避免：
${ruleLines}
${briefLine}
【写作要求】
1. 写第 ${chapter} 章正文，约 3000 字，承接世界状态与上一章结尾，按剧情要求推进。
2. 同时提交本章导致的【世界状态变更】——只写本章实际发生的改变，没变的不写。
   可用状态：san（精神值，遇险下降）、current_layer、discovered_rules（发现规则数）、
   inventory、knows、in_pocket（物品入手）、status 等，对象 ID 必须带前缀。
3. 严守禁区：状态里列出的禁区一条都不能违反。
4. 输出必须是单个 JSON 对象（不要输出其他文字），形状：
{
  "chapter": ${chapter},
  "transaction_id": "ch${chapter}-auto",
  "text": "本章正文…",
  "state_changes": [
    {"object": "char:lin-ke", "field": "san", "from": 100, "to": 92, "basis": ["scene:${chapter}-01"]}
  ],
  "assertions": ["lin-ke-alive", "chen-ye-alive", "store-active", "rulebook-intact"],
  "hooks": []
}
state_changes 里 from 填你认为的当前值（写错只记为偏差，不拒绝）；对象 ID 必须带前缀。
若本章没有任何状态改变，state_changes 给空数组。
文字用中文。正文必须有具体场景、动作、对话，禁止空泛总结。`
}

// ── 主流程 ──
const zones = textZones()
if (!zones.length) {
  console.error('✗ 未找到文本禁区（spec/tasks/rules.json 的 text_not_contains）——规则怪谈必须带规则词表')
  process.exit(2)
}
console.log(`文本禁区 ${zones.length} 组：${zones.map((z) => z.id).join('、')}`)

const model = createModel({ provider, model: modelName })
console.log(`模型：${model.id}｜章：${CHAPTER}｜包：${PKG}\n`)

const prevPath = join(PKG, ...CHAPTERS_DIR, `ch${String(CHAPTER - 1).padStart(2, '0')}.txt`)
let prevText = ''
try { prevText = readFileSync(prevPath, 'utf8') } catch { /* 第一章无前文 */ }

let attempt = 0
while (attempt < maxRetries) {
  attempt++
  const prompt = buildPrompt(PKG, CHAPTER, zones, prevText)
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
  console.log(`  ✓ 解析出事务：text ${String(tx.text ?? '').length} 字，${(tx.state_changes ?? []).length} 条状态变更`)
  if (tx.text && tx.text.length < 100) console.warn(`  ⚠ 正文过短（${tx.text.length} 字），疑似模型偷懒`)

  if (tx.chapter === undefined) tx.chapter = CHAPTER

  // ── 五道门禁 ──
  const origin = loadOrigin(PKG)
  const all = origin.constraints ?? []
  const textViolations = textZoneCheck(String(tx.text ?? ''), zones)
  if (textViolations.length) {
    console.error(`  ✗ 文本禁区命中 ${textViolations.length} 处：`)
    for (const v of textViolations) console.error(`    - ${v.msg}`)
    if (attempt >= maxRetries) { console.error(`\n✗ 重试 ${maxRetries} 次仍未通过，世界状态未动。`); process.exit(1) }
    console.error(`  按理由重写（还有 ${maxRetries - attempt} 次机会）…\n`)
    continue
  }

  const res2 = coreValidate({
    tx: { ...tx, text: undefined },
    stateBefore: origin.state,
    constraints: all,
    assertions: RK_ASSERTIONS,
  })
  const hookV = hookViolations(res2.stateAfter ?? origin.state, tx)
  const violations = [...res2.violations, ...hookV]
  const errors = violations.filter((v) => v.severity !== 'warning')
  if (errors.length) {
    const reasons = errors.map((v) => `- [${v.code}] ${v.msg}`).join('\n')
    console.error(`  ✗ 门禁拒绝（${errors.length} 条错误）：\n${reasons}`)
    if (attempt >= maxRetries) { console.error(`\n✗ 重试 ${maxRetries} 次仍未通过。世界状态未动。`); process.exit(1) }
    console.error(`  按理由重写（还有 ${maxRetries - attempt} 次机会）…\n`)
    continue
  }

  // ── 落盘：正文先写，状态后提交 ──
  mkdirSync(join(PKG, ...CHAPTERS_DIR), { recursive: true })
  const ch = tx.chapter
  const textPath = join(PKG, ...CHAPTERS_DIR, `ch${String(ch).padStart(2, '0')}.txt`)
  writeFileSync(textPath, tx.text, 'utf8')

  const outlinePath = join(PKG, ...OUTLINE)
  const outline = existsSync(outlinePath) ? readFileSync(outlinePath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []
  outline.push({ chapter: ch, file: basename(textPath), chars: tx.text.length, at: new Date().toISOString(), by: model.id, tx: tx.transaction_id ?? null })
  writeFileSync(outlinePath, outline.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')

  const r = commit(PKG, tx, { by: model.id, expectedSeq: null, assertions: RK_ASSERTIONS })
  if (!r.ok) {
    console.error(`  ✗ 落盘失败：${JSON.stringify(r.violations ?? r).slice(0, 300)}`)
    process.exit(1)
  }
  console.log(`\n✓ 第 ${ch} 章落盘：seq ${r.receipt.seq_from}–${r.receipt.seq_to}，${tx.text.length} 字，正文存 ${basename(textPath)}（${ms}ms）`)
  for (const ref of r.receipt.changed) console.log(`  状态变更：${ref}`)
  for (const w of r.receipt.warnings ?? []) console.log(`  ⚠ ${w.msg}`)
  process.exit(0)
}
