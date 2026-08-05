// A1 · 向量 RAG 检索 topK：当前主流长篇写作方案的代表。
//
// 与 A0 只差一处：不再只看结尾，而是从**全部**前文里按语义捞回最相关的段落。
// 与 A3 差两处：没有结构化世界状态，也没有写回校验。
//
// 这条臂是 Gate 0 之后真正要打的对手。「本象比裸模型好」和「本象比现有方案好」
// 是两句话——只跑 A0/A3 时，第二句一个数据都没有。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chunkCorpus, embed, retrieve } from './retriever.mjs'
import { probeState } from '../lib/probe.mjs'

const HERE = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const CACHE = join(HERE, 'results', '.embed-cache.json')

export const meta = { id: 'a1-rag', name: '向量 RAG（topK 检索 + 尾部正文）' }

// 预算切分：近文 60%，检索 40%。
// 近文占大头是照着真实系统来的（Long-Novel-GPT 等都保留最近上下文再叠检索记忆），
// 也避免把 A1 做成「只有检索、连上一章都不给」的稻草人。
const TAIL_SHARE = 0.6

export async function run({ spec, task, chapters, model, corpusTail = '', budget = 6000, topK = 6 }) {
  const out = []
  const usage = { inputTokens: 0, outputTokens: 0, ms: 0, calls: 0 }
  let tail = corpusTail

  // 建索引：全部前文切块并嵌入（内容寻址缓存，多轮重复实验只在第一轮付费）
  const chunks = chunkCorpus(corpusTail)
  const vecs = await embed(chunks.map((c) => c.text), { cachePath: CACHE, usage })
  const index = chunks.map((c, i) => ({ ...c, vec: vecs[i] }))

  const tailRoom = Math.floor(budget * TAIL_SHARE)
  const retrRoom = budget - tailRoom

  for (const chapter of chapters) {
    const recent = tail.slice(-tailRoom)

    // 双查询：一条问「任务要什么」，一条问「刚才写到哪」。
    // 单用任务目标会漏掉当下情境，单用近文会在原地打转。
    const queries = [task.goal, recent.slice(-300)]
    const qvecs = await embed(queries, { cachePath: CACHE, usage })
    // 已经在近文里的段落不再检索占位——否则检索预算全花在模型已经看得见的字上
    const hits = retrieve({ queryVecs: qvecs, index, k: topK, exclude: (c) => recent.includes(c.text.slice(0, 40)) })

    let used = 0
    const passages = []
    for (const h of hits) {
      const block = `〔第${h.chapter}章〕${h.text}`
      if (used + block.length > retrRoom) break
      passages.push(block)
      used += block.length
    }

    const prompt =
      `以下是一部长篇小说的资料。\n\n` +
      `【从全书检索到的相关片段】\n${passages.join('\n\n') || '（无）'}\n\n` +
      `【最近正文】\n${recent}\n\n` +
      `请接着写第 ${chapter} 章，约 3000 字。总目标：${task.goal}\n` +
      `只输出 JSON：{"text": "本章正文"}`

    const res = await model.complete({ prompt, chapter })
    usage.inputTokens += res.usage.inputTokens
    usage.outputTokens += res.usage.outputTokens
    usage.ms += res.usage.ms
    usage.calls++
    const text = res.parsed?.text ?? res.raw
    out.push({ chapter, text, retrieved: passages.length })

    // 记忆随写作增长——新章即刻进索引，这也是真实系统的做法
    tail += '\n' + text
    const fresh = chunkCorpus(`第${chapter}章 （续写）\n\n${text}`)
    const freshVecs = await embed(fresh.map((c) => c.text), { cachePath: CACHE, usage })
    fresh.forEach((c, i) => index.push({ ...c, vec: freshVecs[i] }))
  }

  // W3 数据采集：与 A0 共用同一个探询模块，**同一份字符串**，不再靠注释约定一致——
  // 否则 W3 的差异会混进提问方式的差异。
  const probe = await probeState({
    model,
    task,
    spec,
    written: out.map((c) => `第${c.chapter}章\n${c.text}`).join('\n\n'),
    chapter: chapters.at(-1),
    usage,
  })

  return {
    arm: meta.id,
    stub: model.stub,
    chapters: out,
    state: probe.state,
    hooks: probe.hooks,
    evidence: {},
    probe: probe.diag,
    usage,
    gate: null,
  }
}
