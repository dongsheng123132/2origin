#!/usr/bin/env node
// W1 语义通道：确定性规则抓不到的一致性错误，交给模型判读。
//
// 主战场在这里——知识越界（人物表现出他不该知道的事）、视角越界、伏笔误收、
// 语气暗示。这些没有正则可写，却正是本象协议主张要解决的问题。
//
// 可信度设计（照 docs 里定的口径）：
//   ① 双模型交叉：两个不同家族的模型各判一遍
//   ② 只采信双方都指认的（agreed），分歧项（disputed）单列，等人工裁决
//   ③ 必须引用原文——判不出原文出处的指控一律丢弃，杜绝模型凭空发挥
//
//   node eval/judge.mjs results/a3-bailian-clean.json
//   node eval/judge.mjs results/a3-bailian-clean.json --judges hermes,bailian

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadSpec, replay } from './replay.mjs'
import { createModel } from '../arms/lib/model.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TASK = JSON.parse(readFileSync(join(HERE, '..', 'world/spec.origin/tasks/continuation.json'), 'utf8'))

const CATEGORIES = `
1. knowledge-leak（知识越界）：某人物的言行/心理表明他知道了依设定他不该知道的事
2. pov-break（视角越界）：写了本章视角人物不可能观察到或知晓的内容
3. state-contradiction（状态矛盾）：与给定的人物/物品当前状态直接冲突
4. foreshadow-misfire（伏笔误收）：本不该在此回收的伏笔被点破
5. rule-break（规则违反）：违反给定的世界规则`

function buildJudgePrompt({ chapter, text, state, spec }) {
  const nameOf = Object.fromEntries([...spec.characters, ...spec.objects].map((e) => [e.id, e.name]))
  const stateLines = spec.characters
    .map((c) => {
      const s = state[c.id] ?? {}
      const bits = []
      if (s.location) bits.push(`位置=${s.location}`)
      if (s.left_hand_injured) bits.push('左手有伤')
      if (s.alive === false) bits.push('已死')
      if (s.secret_betrayal) bits.push('与北庭另有约定（除裴照外无人知晓）')
      if (s.knows?.length) bits.push(`知晓=[${s.knows.join(', ')}]`)
      return `  ${c.name}：${bits.join('；') || '无特殊状态'}`
    })
    .join('\n')

  return `你是小说连续性审校员。请在下面这一章正文中找出与设定矛盾之处。

【本章开始时的人物状态】
${stateLines}

【关键：谁知道什么】
- 白遥与北庭有秘密约定，除裴照外**无人知晓**；林峥尤其完全不知情，连怀疑都不应有
- 阿枝曾目睹白遥与北庭军官会面，但从未告诉任何人
- 沈砚只知台中有人私通外界，不知是谁
- 云姑知晓黑钥匙来历却缄口不言

【关键物品】
${spec.objects.filter((o) => state[o.id]?.holder).map((o) => `  ${o.name}：在${nameOf[state[o.id].holder] ?? state[o.id].holder}处`).join('\n')}

【世界规则】
${spec.rules.map((r) => `  - ${r.statement}`).join('\n')}

【本章不可触碰的边界】
${(TASK.forbidden_zones ?? []).map((f) => `  - ${f.rule}`).join('\n')}

【要找的错误类型】${CATEGORIES}

【第 ${chapter} 章正文】
${text}

【要求】
- 只报你能**逐字引用原文**的问题；引用必须是正文里真实存在的连续片段
- 宁缺毋滥：拿不准就不报。文学性的含蓄、留白、悬念不是错误
- 人物「感到不安」「觉得对方有心事」这类模糊情绪不算知识越界；只有当文字表明他**具体知道了**某项秘密才算

【输出格式】只输出 JSON，无其他文字：
{"findings":[{"quote":"原文片段","type":"knowledge-leak","why":"违反了哪条设定","confidence":0.9}]}
没有问题就输出 {"findings":[]}`
}

/** 引用必须能在原文里找到，否则视为模型编造，直接丢弃 */
const quoteExists = (q, text) => typeof q === 'string' && q.length >= 4 && text.includes(q.slice(0, Math.min(12, q.length)))

/** 两份判读的匹配：同章 + 引用有重叠 */
function sameFinding(a, b) {
  if (a.chapter !== b.chapter) return false
  const [x, y] = [a.quote ?? '', b.quote ?? '']
  const short = x.length < y.length ? x : y
  const long = x.length < y.length ? y : x
  return short.length >= 4 && (long.includes(short.slice(0, 8)) || short.includes(long.slice(0, 8)))
}

export async function judgeArm({ chapters, judgeName, model }) {
  const spec = loadSpec()
  const out = []
  const usage = { inputTokens: 0, outputTokens: 0, calls: 0, ms: 0 }

  for (const ch of chapters) {
    if (!ch.text) continue
    const { state } = replay(spec, ch.chapter - 1)
    const res = await model.complete({ prompt: buildJudgePrompt({ chapter: ch.chapter, text: ch.text, state, spec }) })
    usage.inputTokens += res.usage.inputTokens
    usage.outputTokens += res.usage.outputTokens
    usage.calls++
    usage.ms += res.usage.ms

    for (const f of res.parsed?.findings ?? []) {
      if (!quoteExists(f.quote, ch.text)) continue // 引用对不上原文 → 模型编的，丢弃
      out.push({ chapter: ch.chapter, judge: judgeName, ...f })
    }
  }
  return { findings: out, usage }
}

export function crossCheck(a, b) {
  const agreed = [], disputed = []
  const matchedB = new Set()
  for (const fa of a) {
    const i = b.findIndex((fb, idx) => !matchedB.has(idx) && sameFinding(fa, fb))
    if (i >= 0) {
      matchedB.add(i)
      agreed.push({ ...fa, alsoBy: b[i].judge, types: [fa.type, b[i].type] })
    } else disputed.push(fa)
  }
  b.forEach((fb, idx) => { if (!matchedB.has(idx)) disputed.push(fb) })
  return { agreed, disputed }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  if (!file) { console.log('用法: node eval/judge.mjs <results/xxx.json> [--judges hermes,bailian]'); process.exit(1) }
  const i = process.argv.indexOf('--judges')
  const judges = (i >= 0 ? process.argv[i + 1] : 'hermes,bailian').split(',')
  const data = JSON.parse(readFileSync(file, 'utf8'))
  const chapters = data.result.chapters.filter((c) => c.text)
  const words = chapters.reduce((n, c) => n + c.text.replace(/\s/g, '').length, 0)

  console.log(`# 语义通道判读 · ${data.result.arm}（${chapters.length} 章 / ${words} 字）\n`)
  const runs = []
  for (const j of judges) {
    const model = j === 'bailian' ? createModel({ provider: 'bailian', model: 'qwen-plus' }) : createModel({ provider: 'hermes' })
    process.stdout.write(`  判读中（${j}）… `)
    const r = await judgeArm({ chapters, judgeName: j, model })
    console.log(`${r.findings.length} 处，${r.usage.calls} 次调用`)
    runs.push(r)
  }

  const { agreed, disputed } = crossCheck(runs[0].findings, runs[1]?.findings ?? [])
  console.log(`\n## 双方一致指认（采信）：${agreed.length} 处`)
  for (const f of agreed) console.log(`  ✗ ch${f.chapter} [${f.type}] ${f.why}\n      「${f.quote.slice(0, 60)}」`)
  console.log(`\n## 分歧项（待人工裁决，不计入 CED）：${disputed.length} 处`)
  for (const f of disputed) console.log(`  ? ch${f.chapter} [${f.type}] by ${f.judge} — ${f.why}\n      「${(f.quote ?? '').slice(0, 60)}」`)

  const semanticCED = (agreed.length / words) * 10000
  console.log(`\n语义通道 CED ${semanticCED.toFixed(3)}/万字（仅采信双方一致项）`)
  const det = data.w1?.ced ?? 0
  console.log(`确定性通道 CED ${det.toFixed(3)} → 合计 ${(det + semanticCED).toFixed(3)}/万字`)

  const outFile = file.replace(/\.json$/, '.judged.json')
  writeFileSync(outFile, JSON.stringify({ arm: data.result.arm, words, agreed, disputed, semanticCED, totalCED: det + semanticCED }, null, 2))
  console.log(`\n已写入 ${outFile}`)
}
