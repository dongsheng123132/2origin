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
const style = readFileSync(join(HERE, 'world/spec.origin/style/style-profile.yaml'), 'utf8')
const model = createModel({ provider: arg('provider', 'hermes'), model: arg('model') })
const only = arg('only') ? [Number(arg('only'))] : null
const force = process.argv.includes('--force')

const nameOf = Object.fromEntries([...spec.characters, ...spec.objects].map((e) => [e.id, e.name]))
const fmtState = (state, ids) =>
  ids.map((id) => {
    const s = state[id] ?? {}
    const bits = []
    if (s.location) bits.push(`在${nameOf[s.location] ?? s.location.replace(/^loc:/, '')}`)
    if (s.alive === false) bits.push('已死')
    if (s.left_hand_injured) bits.push('左手有伤')
    if (s.secret_betrayal) bits.push('已秘密投北庭（未被人察觉）')
    if (s.suspects_mole) bits.push('已怀疑台中有内应')
    if (s.holder) bits.push(`在${nameOf[s.holder] ?? s.holder}处`)
    if (s.knows?.length) bits.push(`知晓：${s.knows.map((k) => k.replace(/^k:/, '')).join('、')}`)
    return `  ${nameOf[id] ?? id}：${bits.join('；') || '（无特殊状态）'}`
  }).join('\n')

function buildPrompt(ch) {
  const { state } = replay(spec, ch.chapter - 1)
  const changes = spec.changes.filter((c) => ch.allowed_state_changes?.includes(c.seq))
  const events = spec.events.filter((e) => ch.events?.includes(e.id))
  const locs = Object.fromEntries(spec.locations?.map?.((l) => [l.id, l.name]) ?? [])

  return `你是一位中文小说写手。请按下列设定写出第 ${ch.chapter} 章正文。

【本章】第 ${ch.chapter} 章《${ch.title}》，视角人物：${nameOf[ch.pov] ?? ch.pov}
【本章梗概】${ch.summary}
【本章须发生的事】
${events.map((e) => `  - ${e.summary}（地点：${locs[e.location] ?? e.location ?? '不限'}）`).join('\n') || '  （承接前文，无关键事件）'}
${changes.length ? `【本章须体现的状态变化】\n${changes.map((c) => `  - ${nameOf[c.object] ?? c.object} 的 ${c.field}：${JSON.stringify(c.from ?? '（新增）')} → ${JSON.stringify(c.to)}`).join('\n')}` : ''}

【本章开始时的世界状态（务必与之一致，不得矛盾）】
${fmtState(state, [...spec.characters.map((c) => c.id), ...spec.objects.map((o) => o.id)])}

【世界规则（绝不可违反）】
${spec.rules.map((r) => `  - ${r.statement}`).join('\n')}

【风格要求】
${style}

【硬性要求】
1. 只写本章内容，不得写入上表之外的状态变化
2. 视角人物不知道的事，绝不可写入其心理活动
3. 白遥投北庭一事在本章之前对林峥完全保密，行文不得让林峥察觉
4. 正文 1500-2500 字，不加标题、不加章节号、不写"未完待续"

【输出格式】只输出一个 JSON 对象，不要有任何其他文字：
{"text":"正文全文"}`
}

mkdirSync(CORPUS, { recursive: true })
const targets = spec.outline.filter((ch) => (only ? only.includes(ch.chapter) : true))
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
