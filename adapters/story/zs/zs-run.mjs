#!/usr/bin/env node
// The Zero Slot —— LitRPG 专属续写闭环（模型 → 事务 → 门禁 → 落盘）
//
// 与 rk-run.mjs（规则怪谈）的区别——LitRPG 的「数值机器可验证」卖点：
//   1. 数值账本检查：str+agi+int+vit+wis+stat_points 必须等于 25+(level-1)*5，
//      属性点凭空多出来/少掉 = 账本不平 = 被机器抓住（网文「数值崩了」的根治）。
//   2. 等级单调检查：level 只升不降（field_monotonic）。
//   3. 自定义断言表（Kael 存活/Mira 存活/Panel 不消失）。
//
//   node adapters/story/zs/zs-run.mjs <pkg.origin> <章号> [--provider hermes|bailian|stub]
//        [--max-tokens 20000] [--retries 3] [--brief "chapter brief in English…"]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadOrigin } from '../../../compiler/origin.mjs'
import { initWriter, projectState } from '../engine.mjs'
import { initPackage, commit } from '../../../compiler/store.mjs'
import { normalizeTransaction, validateTransaction as coreValidate, applyTransaction } from '../../../compiler/commit-compiler.mjs'
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
  console.error('Usage: node adapters/story/zs/zs-run.mjs <pkg.origin> <chapter> [--provider hermes|bailian|stub] [--brief "..."]')
  process.exit(2)
}

// ── The Zero Slot 断言表 ──
const ZS_ASSERTIONS = {
  'kael-alive': (s) => s['char:kael']?.alive === true,
  'mira-alive': (s) => s['char:mira']?.alive === true,
  'panel-installed': (s) => s['obj:panel']?.installed === true,
}

// ── 数值账本：str+agi+int+vit+wis+stat_points = 30 + (level-1)*5 ──
// 初始：str5+agi5+int5+vit5+wis5+stat_points5 = 30；每次升级 +5 stat_points。
function statLedger(state) {
  const k = state['char:kael']
  if (!k) return { ok: true }
  const sum = (['str', 'agi', 'int', 'vit', 'wis'].reduce((a, f) => a + (Number(k[f]) || 0), 0)) + (Number(k.stat_points) || 0)
  const want = 30 + (Number(k.level) || 1) * 5 - 5
  return sum === want ? { ok: true } : { ok: false, sum, want, msg: `stat ledger off: allocated+points=${sum}, expected ${want} at level ${k.level}` }
}

// ── 门禁：核心校验 + 账本 + 单调 + 伏笔 ──
function gate(origin, tx) {
  const norm = normalizeTransaction(tx, origin.ids)
  const res = coreValidate({
    tx: { ...norm, text: undefined },
    stateBefore: origin.state,
    constraints: origin.constraints ?? [],
    assertions: ZS_ASSERTIONS,
  })
  const stateAfter = res.stateAfter ?? origin.state

  const violations = [...res.violations]
  // 等级单调（stateAfter.level >= stateBefore.level）
  const before = origin.state['char:kael']?.level
  const after = stateAfter['char:kael']?.level
  if (before !== undefined && after !== undefined && Number(after) < Number(before)) {
    violations.push({ code: 'level-regress', severity: 'error', msg: `Kael level regressed ${before} → ${after}（等级只能升不能降）` })
  }
  // 数值账本
  const ledger = statLedger(stateAfter)
  if (!ledger.ok) {
    violations.push({ code: 'stat-ledger', severity: 'error', msg: ledger.msg })
  }
  violations.push(...hookViolations(stateAfter, tx))
  const errors = violations.filter((v) => v.severity !== 'warning')
  return { violations, errors, stateAfter }
}

// ── 提示词（英文）──
function buildPrompt(pkgDir, chapter, prevText) {
  const state = projectState(pkgDir, { task: `write chapter ${chapter}` })
  const prev = prevText ? `\n\n【END OF PREVIOUS CHAPTER】…${prevText.slice(-300)}` : ''
  const briefLine = brief ? `\n【THIS CHAPTER'S BRIEF】${brief}\n` : ''
  return `You are the continuation engine for "The Zero Slot", a LitRPG novel. World state is persisted; write chapter ${chapter}.

【WORLD STATE】(copy field values verbatim, keep prefixes)
${state}${prev}${briefLine}
【WRITING RULES】
1. Write chapter ${chapter} in ENGLISH, about 2500 words. Continue from the world state and the previous chapter's ending.
2. Submit the【WORLD STATE CHANGES】this chapter actually causes — only what changed.
   Available fields: level, xp, stat_points, str/agi/int/vit/wis, location, knows, inventory, slot_zero_words, status, version...
3. HARD STAT LEDGER RULE (machine-checked, rejection on violation):
   str + agi + int + vit + wis + stat_points MUST equal 30 + (level - 1) * 5.
   Kael starts at level 1 with str5/agi5/int5/vit5/wis5 and 5 unspent stat_points (=30).
   Leveling up grants +5 stat_points. Never spend more points than you have.
4. Output MUST be a single JSON object (no other text), shaped:
{
  "chapter": ${chapter},
  "transaction_id": "ch${chapter}-auto",
  "text": "chapter prose…",
  "state_changes": [
    {"object": "char:kael", "field": "xp", "from": 0, "to": 120, "basis": ["scene:${chapter}-01"]}
  ],
  "assertions": ["kael-alive", "mira-alive", "panel-installed"],
  "hooks": []
}
IMPORTANT: Return ONLY the JSON object. Do NOT write any story text outside the JSON —
the chapter prose goes inside the "text" field of the JSON. No markdown fences.
state_changes "from" is your best guess (a wrong guess only records a deviation, not a rejection). Object ids must keep prefixes.
If nothing changed this chapter, state_changes = [].
Prose must have concrete scenes, action, dialogue — no abstract summaries.`
}

// ── 主流程 ──
const model = createModel({ provider, model: modelName })
console.log(`Model: ${model.id}｜Chapter: ${CHAPTER}｜Pkg: ${PKG}\n`)

const prevPath = join(PKG, ...CHAPTERS_DIR, `ch${String(CHAPTER - 1).padStart(2, '0')}.txt`)
let prevText = ''
try { prevText = readFileSync(prevPath, 'utf8') } catch { /* first chapter */ }

let attempt = 0
while (attempt < maxRetries) {
  attempt++
  const prompt = buildPrompt(PKG, CHAPTER, prevText)
  console.log(`── attempt ${attempt}: calling ${model.id} ──`)
  const t0 = Date.now()
  const res = await model.complete({ prompt, maxTokens })
  const ms = Date.now() - t0

  const raw = res.raw ?? ''
  const fence = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  const m = raw.match(/\{[\s\S]*\}/)
  let tx = null
  const jsonStr = fence ? fence[1] : (m ? m[0] : null)
  if (jsonStr) try { tx = JSON.parse(jsonStr) } catch (e) { console.error(`  ✗ model output is not valid JSON: ${e.message.slice(0, 80)}`) }
  if (!tx) {
    console.error(`  ✗ no transaction parsed (output ${raw.length} chars; head: ${JSON.stringify(raw.slice(0, 120))})`)
    continue
  }
  console.log(`  ✓ parsed: text ${String(tx.text ?? '').length} chars, ${(tx.state_changes ?? []).length} state changes`)
  if (tx.text && tx.text.length < 100) console.warn(`  ⚠ text too short (${tx.text.length}), model may be lazy`)

  if (tx.chapter === undefined) tx.chapter = CHAPTER
  const origin = loadOrigin(PKG)
  const g = gate(origin, tx)
  if (g.errors.length) {
    const reasons = g.errors.map((v) => `- [${v.code}] ${v.msg}`).join('\n')
    console.error(`  ✗ gate rejected (${g.errors.length} errors):\n${reasons}`)
    if (attempt >= maxRetries) { console.error(`\n✗ failed after ${maxRetries} attempts. World state untouched.`); process.exit(1) }
    console.error(`  rewriting per reasons (${maxRetries - attempt} attempts left)…\n`)
    continue
  }

  // ── 落盘 ──
  mkdirSync(join(PKG, ...CHAPTERS_DIR), { recursive: true })
  const ch = tx.chapter
  const textPath = join(PKG, ...CHAPTERS_DIR, `ch${String(ch).padStart(2, '0')}.txt`)
  writeFileSync(textPath, tx.text, 'utf8')

  const outlinePath = join(PKG, ...OUTLINE)
  const outline = existsSync(outlinePath) ? readFileSync(outlinePath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []
  outline.push({ chapter: ch, file: basename(textPath), chars: tx.text.length, at: new Date().toISOString(), by: model.id, tx: tx.transaction_id ?? null })
  writeFileSync(outlinePath, outline.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')

  const r = commit(PKG, tx, { by: model.id, expectedSeq: null, assertions: ZS_ASSERTIONS })
  if (!r.ok) {
    console.error(`  ✗ commit failed: ${JSON.stringify(r.violations ?? r).slice(0, 300)}`)
    process.exit(1)
  }
  console.log(`\n✓ Chapter ${ch} committed: seq ${r.receipt.seq_from}–${r.receipt.seq_to}, ${tx.text.length} chars → ${basename(textPath)} (${ms}ms)`)
  for (const ref of r.receipt.changed) console.log(`  changed: ${ref}`)
  for (const w of r.receipt.warnings ?? []) console.log(`  ⚠ ${w.msg}`)
  process.exit(0)
}
