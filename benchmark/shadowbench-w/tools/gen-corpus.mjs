#!/usr/bin/env node
// 基线语料生成：从世界规格生成第 1-10 章正文。
//
// 关键设计：**先有世界状态，再生成正文**。每章生成时把「该章之前的世界状态 + 本章允许发生的
// 状态变更」一并交给模型，正文因此与规格一致——ground truth 由构造保证，不必事后人工标注。
//
//   node tools/gen-corpus.mjs --provider hermes            生成全部缺失章节
//   node tools/gen-corpus.mjs --provider hermes --only 1   只生成第 1 章
//   node tools/gen-corpus.mjs --force                      覆盖已有章节

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadSpec, replay } from '../eval/replay.mjs'
import { createModel } from '../arms/lib/model.mjs'

const HERE = dirname(dirname(fileURLToPath(import.meta.url)))
const CORPUS = join(HERE, 'corpus')
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }

const spec = loadSpec()
// 注释是给人看的，不进提示词——它们既占预算又可能干扰模型
// （曾经解释「投敌措辞会触发端点挂起」的那行注释，自己触发了同一个挂起）
const style = readFileSync(join(HERE, 'world/spec.origin/style/style-profile.yaml'), 'utf8')
  .split('\n')
  .filter((l) => !l.trim().startsWith('#'))
  .join('\n')
  .trim()
const model = createModel({ provider: arg('provider', 'hermes'), model: arg('model') })
const only = arg('only') ? [Number(arg('only'))] : null
const force = process.argv.includes('--force')

const nameOf = Object.fromEntries([...spec.characters, ...spec.objects].map((e) => [e.id, e.name]))

// 中性改写层：规格用精确词汇（ground truth 需要），提问用中性表达。
// 实测本机端点遇「内应/密会/投敌」一类措辞会挂起不返回（非报错），中性改写后正常。
// 剧情不变，只换问法——ground truth 与判分一律以规格原词为准。
const NEUTRAL_FIELD = {
  secret_betrayal: { name: '与北庭的私下约定', vals: { true: '已定（外人不知）', false: '未有' } },
  suspects_mole: { name: '对台中有人私通外界的察觉', vals: { true: '已起疑', false: '未起疑' } },
  left_hand_injured: { name: '左手伤势', vals: { true: '已受伤', false: '无伤' } },
}
const neutralKnows = (k) =>
  ({ 'beiting-allegiance': '与北庭的约定', 'bai-yao-meets-pei-zhao': '曾见白遥与北庭军官会面', 'black-key-held-by-zhao-qi': '黑钥匙在赵七处' })[k] ?? k
const neutralChange = (c) => {
  const f = NEUTRAL_FIELD[c.field]
  if (c.op === 'append') return `${nameOf[c.object] ?? c.object} 新知晓：${neutralKnows(String(c.to).replace(/^k:/, ''))}`
  if (f) return `${nameOf[c.object] ?? c.object} 的${f.name}：${f.vals[String(c.from)] ?? c.from} → ${f.vals[String(c.to)] ?? c.to}`
  return `${nameOf[c.object] ?? c.object} 的 ${c.field}：${JSON.stringify(c.from ?? '（新增）')} → ${JSON.stringify(c.to)}`
}
const fmtState = (state, ids) =>
  ids.map((id) => {
    const s = state[id] ?? {}
    const bits = []
    if (s.location) bits.push(`在${nameOf[s.location] ?? s.location.replace(/^loc:/, '')}`)
    if (s.alive === false) bits.push('已死')
    if (s.left_hand_injured) bits.push('左手有伤')
    if (s.secret_betrayal) bits.push('与北庭另有约定（旁人皆不知）')
    if (s.suspects_mole) bits.push('已察觉台中有人私通外界，但不知是谁')
    if (s.holder) bits.push(`在${nameOf[s.holder] ?? s.holder}处`)
    if (s.knows?.length) bits.push(`知晓：${s.knows.map((k) => neutralKnows(k.replace(/^k:/, ''))).join('、')}`)
    const ent = [...spec.characters, ...spec.objects].find((e) => e.id === id)
    const tag = ent?.gender ? `（${ent.gender}）` : ''
    return `  ${nameOf[id] ?? id}${tag}：${bits.join('；') || '（无特殊状态）'}${ent?.prompt_note ? `【要点：${ent.prompt_note}】` : ''}`
  }).join('\n')

/**
 * 保密约束必须随视角人物而变，否则会自相矛盾。
 * 白遥/裴照是知情者，以他们为视角时本就该写出密谋；
 * 只有以不知情者为视角时，才禁止泄露。
 * （曾把这条写死成「一律不得点破」，结果第 4 章要求白遥视角写投敌又不许写投敌，模型直接卡死。）
 */
function secrecyClause(ch, spec) {
  const insiders = new Set(['char:bai-yao', 'char:pei-zhao'])
  const povName = nameOf[ch.pov] ?? ch.pov
  return insiders.has(ch.pov)
    ? `本章视角人物${povName}知晓此约，可如实写出会面经过；但不得出现林峥在场察觉或知晓此事的描写`
    : `白遥与北庭的约定对本章视角人物${povName}完全隐蔽，不得让其察觉或提及`
}

function buildPrompt(ch) {
  const { state } = replay(spec, ch.chapter - 1)
  const changes = spec.changes.filter((c) => ch.allowed_state_changes?.includes(c.seq))
  const events = spec.events.filter((e) => ch.events?.includes(e.id))
  const locs = Object.fromEntries(spec.locations?.map?.((l) => [l.id, l.name]) ?? [])

  return `你是一位中文小说写手。请按下列设定写出第 ${ch.chapter} 章正文。

【本章】第 ${ch.chapter} 章《${ch.title}》，视角人物：${nameOf[ch.pov] ?? ch.pov}
【本章梗概】${ch.prompt_hint ?? ch.summary}
【本章须发生的事】
${events.map((e) => `  - ${e.prompt_hint ?? e.summary}（地点：${locs[e.location] ?? e.location ?? '不限'}）`).join('\n') || '  （承接前文，无关键事件）'}
${changes.length ? `【本章须体现的变化】\n${changes.map((c) => `  - ${neutralChange(c)}`).join('\n')}` : ''}

【本章开始时的世界状态（务必与之一致，不得矛盾）】
${fmtState(state, [...spec.characters.map((c) => c.id), ...spec.objects.map((o) => o.id)])}

【世界规则（绝不可违反）】
${spec.rules.map((r) => `  - ${r.statement}`).join('\n')}

【风格要求】
${style}

【硬性要求】
1. 只写本章内容，不得写入上表之外的状态变化
2. 视角人物不知道的事，绝不可写入其心理活动
3. ${secrecyClause(ch, spec)}
4. 正文 ${Math.round(ch.words * 0.75)}-${ch.words} 字，不加标题、不加章节号、不写"未完待续"

【输出格式】只输出一个 JSON 对象，不要有任何其他文字：
{"text":"正文全文"}`
}

mkdirSync(CORPUS, { recursive: true })
const targets = spec.outline.filter((ch) => (only ? only.includes(ch.chapter) : true))

// 调试用：把真实提示词导出，便于用其他方式复现问题
if (process.argv.includes('--dump-prompt')) {
  for (const ch of targets) {
    const f = join(CORPUS, `prompt-ch${String(ch.chapter).padStart(2, '0')}.txt`)
    writeFileSync(f, buildPrompt(ch), 'utf8')
    console.log(`${f}  ${buildPrompt(ch).length} 字符`)
  }
  process.exit(0)
}
const t0 = Date.now()

for (const ch of targets) {
  const file = join(CORPUS, `ch${String(ch.chapter).padStart(2, '0')}.txt`)
  if (existsSync(file) && !force) {
    console.log(`· 第 ${ch.chapter} 章已存在，跳过（--force 可覆盖）`)
    continue
  }
  process.stdout.write(`→ 第 ${ch.chapter} 章《${ch.title}》生成中… `)
  try {
    const res = await model.complete({ prompt: buildPrompt(ch), chapter: ch.chapter })
    const text = res.parsed?.text
    if (!text) throw new Error('未能解析出 text 字段：' + res.raw.slice(0, 200))
    writeFileSync(file, text, 'utf8')
    console.log(`${text.replace(/\s/g, '').length} 字，${(res.usage.ms / 1000).toFixed(1)}s`)
  } catch (e) {
    console.log(`✗ ${e.message}`)
  }
}

// 合并全本，供 A0 臂作「最近正文」使用
const parts = spec.outline
  .map((ch) => {
    const f = join(CORPUS, `ch${String(ch.chapter).padStart(2, '0')}.txt`)
    return existsSync(f) ? `第${ch.chapter}章 ${ch.title}\n\n${readFileSync(f, 'utf8')}` : null
  })
  .filter(Boolean)
if (parts.length) {
  writeFileSync(join(CORPUS, 'ch01-10.txt'), parts.join('\n\n'), 'utf8')
  console.log(`\n合并 ${parts.length} 章 → corpus/ch01-10.txt（共 ${parts.join('').replace(/\s/g, '').length} 字，耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s）`)
}
