#!/usr/bin/env node
// W1 判分：生成一致性——计 CED（每万字一致性错误数）。
//
// 双通道设计：
//   ① 确定性通道（本文件全实现）——能用规则判的绝不用模型判：时辰、左手、钥匙次数、
//      保管链、铃响伴禽鸟、未知实体。产出可复现、零成本、无争议。
//   ② 语义通道（本文件只留接口）——知识越界、语气暗示这类规则抓不到的，走双模型
//      LLM-judge + 分歧人工裁决。需 API，见 judgeSemantic()。
//
//   node ced.mjs <chapters.json>            仅确定性通道
//   node ced.mjs <chapters.json> --json
//
// chapters.json: { "arm": "...", "chapters": [ { "chapter": 11, "text": "…" } ] }

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadSpec, replay } from './replay.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TASK = JSON.parse(readFileSync(join(HERE, '..', 'world', 'spec.origin', 'tasks', 'continuation.json'), 'utf8'))

const NOON = /正午|午时|日中|晌午|烈日当空/
// 回忆、记载、转述里的铃响不是当下发生的事件
const BELL_NOT_NOW = /记得|想起|回想|响过|那年|那夜|第[一二三四五六七八九十]+夜|丙戌|案|卷宗|册|记载|听说|据说|问谁|若|如果|倘/
// 「闩死」「锁死」这类是把门关紧，不是人死；判死亡前须先排除
const DEATH_COMPOUND = /(闩|锁|关|钉|堵|封|掩|咬|盯|attach|死死)死/
const OPEN_GATE = /(月台|空间门)[^。！？]{0,20}(开启|开了|洞开|启开)|(开启|推开)[^。！？]{0,10}(月台|空间门)/
const LEFT_HAND_ACT = /左手[^。！？]{0,12}(持|握|挥|提|抬|按|抓|接过|拔|扬)/

/** 句子级切分，便于定位 */
const sentences = (t) => t.split(/(?<=[。！？…\n])/).filter((s) => s.trim())

export const RULES = [
  {
    id: 'rule:gate-time',
    category: 'world-rule',
    check: ({ text }) =>
      sentences(text)
        .filter((s) => OPEN_GATE.test(s) && NOON.test(s))
        .map((s) => ({ quote: s.trim(), why: '非月落时辰开启空间门（rule:gate-time）' })),
  },
  {
    id: 'rule:left-hand',
    category: 'physical-state',
    check: ({ text, state }) => {
      if (!state['char:bai-yao']?.left_hand_injured) return []
      return sentences(text)
        .filter((s) => s.includes('白遥') && LEFT_HAND_ACT.test(s))
        .map((s) => ({ quote: s.trim(), why: '白遥左手已伤（第 9 章起）仍作持握挥抬之举' }))
    },
  },
  {
    id: 'rule:key-once',
    category: 'world-rule',
    check: ({ text, state }) => {
      const used = state['obj:black-key']?.used
      const out = []
      let seen = 0
      for (const s of sentences(text)) {
        if (/黑?钥匙[^。！？]{0,15}(插入|转动|使用|用了|开了|启动)/.test(s)) {
          seen++
          if (used || seen > 1) out.push({ quote: s.trim(), why: '黑钥匙只能使用一次（rule:key-once）' })
        }
      }
      return out
    },
  },
  {
    id: 'rule:custody',
    category: 'custody-chain',
    check: ({ text, state, stateAfter, spec }) => {
      // 转手发生的那一章，前后两个持有者都是合法的——否则会把「交接过程」误判成矛盾
      const holder = state['obj:black-key']?.holder
      const legal = new Set([holder, stateAfter?.['obj:black-key']?.holder].filter(Boolean))
      const names = Object.fromEntries(spec.characters.map((c) => [c.id, c.name]))
      const out = []
      for (const s of sentences(text)) {
        if (!/钥匙/.test(s)) continue
        for (const c of spec.characters) {
          if (legal.has(c.id)) continue
          // 「钥匙在X手」「X手里的钥匙」形式的错误归属
          if (new RegExp(`钥匙[^。！？]{0,8}在${c.name}|${c.name}[^。！？]{0,6}手(中|里|上)[^。！？]{0,8}钥匙`).test(s))
            out.push({ quote: s.trim(), why: `保管链错误：黑钥匙应在${names[holder] ?? holder}处，文中归于${c.name}` })
        }
      }
      return out
    },
  },
  {
    id: 'rule:bell-birds',
    category: 'world-rule',
    check: ({ text }) => {
      const ss = sentences(text)
      const out = []
      for (const [i, s] of ss.entries()) {
        if (!/铜铃[^。！？]{0,10}(响|鸣|作声)/.test(s)) continue
        // ① 否定句不算铃响：「铜铃仍不响」「未闻其响」「未响」
        if (/(不|没|未|无)\s*(响|鸣|闻|见)|寂然|默然/.test(s)) continue
        // ② 回忆/记载/转述/假设都不是当下发生（实测这类误报最多）
        if (BELL_NOT_NOW.test(s)) continue
        // ③ 禽鸟异动往往写在铃响之后隔几句（先写声音、再写人物反应、最后才写鸟）
        //    实测第 3 章正确样本里隔了 4 句，窗口太窄会把正确文本误判成违规
        const window = ss.slice(Math.max(0, i - 3), i + 7).join('')
        if (/禽|鸟|雀|鸦|鹊|鸽/.test(window)) continue
        out.push({ quote: s.trim(), why: '铃响未伴禽鸟异动（rule:bell-birds）' })
      }
      return out
    },
  },
  {
    id: 'fz:zhao-qi-alive',
    category: 'forbidden-zone',
    check: ({ text }) =>
      sentences(text)
        .filter((s) => {
          const m = s.match(/赵七(.{0,12})/)
          if (!m) return false
          const after = m[1]
          if (!/(死了|已死|身死|死在|气绝|殒命|毙命|断气|尸)/.test(after)) return false
          if (DEATH_COMPOUND.test(after)) return false // 闩死/锁死：关门不是人死
          if (/[说道问答听念]/.test(after)) return false // 「赵七说，他死前……」是转述他人
          return true
        })
        .map((s) => ({ quote: s.trim(), why: '触碰禁区 fz:zhao-qi-alive（赵七不得死亡）' })),
  },
  {
    id: 'unknown-entity',
    category: 'unknown-entity',
    check: ({ text, spec }) => {
      const known = new Set(spec.characters.map((c) => c.name))
      const counts = {}
      // 中文人名启发式：动词/称谓前的双字或三字名，非白名单且反复出现才算
      for (const m of text.matchAll(/([一-龥]{2,3})(?=道：|说道|问道|冷笑|点头|摇头)/g)) {
        const n = m[1]
        if (!known.has(n) && !/^(那人|此人|众人|老者|少年|妇人)$/.test(n)) counts[n] = (counts[n] ?? 0) + 1
      }
      return Object.entries(counts)
        .filter(([, c]) => c >= 3)
        .map(([n, c]) => ({ quote: n, why: `未知实体「${n}」出现 ${c} 次（超阈值，疑似凭空造人）` }))
    },
  },
]

/** 语义通道接口——需 API，未接入时返回空并标记 */
export async function judgeSemantic(_chapters, _ctx, { model } = {}) {
  if (!model) return { enabled: false, findings: [] }
  throw new Error('语义通道尚未接入模型；接入后应双模型交叉并对分歧作人工裁决')
}

export function scoreW1({ arm, chapters }) {
  const spec = loadSpec()
  const findings = []
  let words = 0

  for (const ch of chapters) {
    // ground truth 取该章之前的状态：本章正文须与「写作时的既定事实」一致。
    // stateAfter 供「本章内发生的合法变更」参考（如物品交接的那一章）。
    const { state } = replay(spec, ch.chapter - 1)
    const { state: stateAfter } = replay(spec, ch.chapter)
    words += ch.text.replace(/\s/g, '').length
    for (const rule of RULES) {
      for (const v of rule.check({ text: ch.text, state, stateAfter, spec, chapter: ch.chapter }))
        findings.push({ chapter: ch.chapter, rule: rule.id, category: rule.category, ...v })
    }
  }

  const byCategory = {}
  for (const f of findings) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1

  // 指标口径（Run #4 教训）：CED 按字数归一，在错误数是个位数时可以靠「多写字」刷低——
  // 两臂各 3 处错误，仅因 A0 多写 4643 字，CED 就从 1.828 变成 1.425。
  // 因此主指标改为 EPC（每章错误数）：章是任务单位，各臂章数相同，无法靠注水改善。
  // CED 保留为次要指标，仅用于与 ConStory-Bench 的外部可比性（其测试文本长度固定，无此漏洞）。
  const n = chapters.length
  const targetLen = 3000 // 任务书给各臂的统一长度要求
  const avgLen = n ? Math.round(words / n) : 0

  return {
    arm,
    words,
    chapters: n,
    findings,
    errors: findings.length,
    byCategory,
    epc: n ? findings.length / n : 0, // ← 主指标
    ced: words ? (findings.length / words) * 10000 : 0, // ← 次要，供外部对照
    avgChapterLen: avgLen,
    lengthRatio: +(avgLen / targetLen).toFixed(2), // 显著 >1 提示注水，须与 EPC 一并看
    channel: { deterministic: true, semantic: false },
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  if (!file) {
    console.log('用法: node ced.mjs <chapters.json> [--json]')
    process.exit(1)
  }
  const r = scoreW1(JSON.parse(readFileSync(file, 'utf8')))
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2))
  } else {
    console.log(`# W1 生成一致性 · ${r.arm}（确定性通道）\n`)
    for (const f of r.findings) console.log(`  ✗ ch${f.chapter} [${f.rule}] ${f.why}\n      「${f.quote}」`)
    if (!r.findings.length) console.log('  未发现确定性可判的一致性错误')
    console.log(`\n  正文 ${r.words} 字，错误 ${r.findings.length} 处，CED ${r.ced.toFixed(3)} / 万字`)
    console.log('  ⚠ 语义通道（知识越界、语气暗示）未接入，实际 CED 应高于此值')
  }
}
