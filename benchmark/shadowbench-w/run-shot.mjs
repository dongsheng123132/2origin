#!/usr/bin/env node
// ShadowBench-W · V（视觉方言）编排器：跑三臂 → 判 W3-V → 出报告。
//
//   node run-shot.mjs --provider stub                     零成本跑通全流程
//   node run-shot.mjs --provider stub --scenario drifting  验证判分器抓得住崩坏
//   node run-shot.mjs --provider hermes --arm a3           真实实验（要花钱）
//
// 选项：--arm a0|a1|a3|all  --budget <字符数>  --out <目录>  --repeat  --rep-offset  --force
//
// ── 与 run.mjs 的关系 ────────────────────────────────────────────────────
// **只换产出物形态，不换上下文供给。** 三臂的上下文分别复用：
//   A0 → 尾部截断（与 a0-naive/index.mjs 同一算法，10 行，照抄比 import 更诚实）
//   A1 → arms/a1-rag/retriever.mjs 的 chunkCorpus / embed / retrieve（原封不动 import）
//   A3 → arms/a3-benxiang/context-compiler.mjs 的 compileContext（原封不动 import）
// 只有「输出什么」这一段是新的，且**三臂共用同一份指令**——否则 W3-V 的差异里
// 会混进提问方式的差异（a1-rag/index.mjs:78 已经为 W3 探询立过这条规矩）。
//
// 默认写 results-v/，与 results/ 完全隔离：写这份代码时 A3 的 deepseek 臂正在
// results/ 里跑，第一起事故就是两个实验共用一个目录。

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadSpec, replay } from './eval/replay.mjs'
import { scoreW3V, loadShotTask, shotTaskHash, shotJudgeHash } from './eval/shot-diff.mjs'
import { specHash } from './eval/spec-hash.mjs'
import { createModel } from './arms/lib/model.mjs'
import { compileContext } from './arms/a3-benxiang/context-compiler.mjs'
import { chunkCorpus, embed, retrieve } from './arms/a1-rag/retriever.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}

const provider = arg('provider', 'stub')
const scenario = arg('scenario', 'clean')
const modelName = arg('model')
const which = arg('arm', 'all')
const budget = Number(arg('budget', 6000))
const taskFile = arg('task', 'storyboard-m.json')
const outDir = arg('out', join(HERE, 'results-v'))
const repeat = Number(arg('repeat', 1))
const repOffset = Number(arg('rep-offset', 0))
const force = process.argv.includes('--force')

const task = loadShotTask(taskFile)
const spec = loadSpec()
const baselineThrough = task.baseline_through ?? 50
const { state: state0, problems } = replay(spec, baselineThrough)
if (problems.length) {
  console.error('✗ 世界规格重放有问题，先修规格再跑实验：\n' + problems.map((p) => '  - ' + p).join('\n'))
  process.exit(1)
}

// ── 基线语料 + 答案泄漏闸门（照搬 run.mjs 的第三起事故护栏）─────────────────
const corpusFile = `ch01-${String(baselineThrough).padStart(2, '0')}.txt`
let corpusTail = ''
let corpusIsReal = false
try {
  corpusTail = readFileSync(join(HERE, 'corpus', corpusFile), 'utf8')
  corpusIsReal = true
} catch {
  corpusTail = spec.outline.map((c) => `第${c.chapter}章 ${c.title}：${c.summary}`).join('\n')
}
if (corpusIsReal) {
  const leaked = [...corpusTail.matchAll(/^第(\d+)章/gm)].map((m) => Number(m[1])).filter((n) => n > baselineThrough)
  if (leaked.length) {
    console.error(`✗ 基线语料 corpus/${corpusFile} 含第 ${Math.min(...leaked)}-${Math.max(...leaked)} 章，超出基线范围（应 ≤ ${baselineThrough}）`)
    console.error('  这会把考题答案直接喂给模型。先修复语料再跑——不修就跑出来的分数没有意义。')
    process.exit(1)
  }
}

// ── 三臂共用的输出指令 ────────────────────────────────────────────────────
// 控制变量：三臂只在「上文给什么」上不同，「要什么」必须逐字一致。
const OUTPUT_SPEC = `
【要输出什么】不是小说正文，是**分镜表**——给渲染器看的画面规格。

只输出一个 JSON 对象，不要有其他文字：
{
  "shots": [
    {
      "id": "51-01",
      "chapter": 51,
      "cast": ["char:lin-zheng"],
      "props": { "obj:black-key": { "holder": "char:lin-zheng", "used": false, "intact": true } },
      "appearance": { "char:bai-yao": { "left_hand_injured": true } },
      "location": "loc:moon-platform",
      "visual": "画面里实际能看见什么（写画面，不写心理）",
      "camera": "景别 + 机位"
    }
  ]
}

规则：
- 每章至少 6 个镜头。
- cast 只列**画面中可见**的角色；props 只列**画面中可见**的物品，并写明此刻归属。
- appearance 写该角色此刻画面上**可见的持续性外观特征**（伤、残缺、显著标记）。
  一个角色只要出现在画面里，他身上未愈的伤就必须一直在——这是渲染器无从推断的东西。
- 所有 ID 必须原样使用完整前缀（char: / obj: / loc:），不可省略。
- 世界规则中凡有可观测现象的，画面里必须真的看得见（例：铜铃鸣响时禽鸟尽飞）。`

const goalLine = (chapter) => `【任务】为第 ${chapter} 章画分镜。总目标：${task.goal}`

// ── stub：本地实现，不动 arms/lib/model.mjs ───────────────────────────────
// 那个文件正被在跑的实验加载着。虽然 Node 已缓存模块、改盘上的文件不影响运行中的进程，
// 但没有必要为一个只在 stub 下用到的剧本去碰共享文件。
const STUB_SHOTS = {
  clean: (chapter) => ({
    shots: [1, 2, 3, 4, 5, 6].map((k) => ({
      id: `${chapter}-0${k}`,
      chapter,
      cast: k === 2 ? ['char:lin-zheng', 'char:bai-yao'] : ['char:lin-zheng'],
      props: k === 4 ? { 'obj:black-key': { holder: chapter === 55 ? 'char:shen-yan' : 'char:lin-zheng', used: false, intact: true } } : {},
      appearance: k === 2 ? { 'char:bai-yao': { left_hand_injured: true } } : {},
      location: 'loc:moon-platform',
      visual: k === 2 ? '（stub）白遥立于阶下，左手缠着旧布垂在身侧。' : '（stub）月台之上，林峥按刀而立。',
      camera: '中景 侧面',
    })),
  }),
  // 崩坏剧本：属性掉落 + 道具瞬移 + 铃响无鸟——判分器必须逐条抓到
  drifting: (chapter) => ({
    shots: [1, 2, 3, 4, 5, 6].map((k) => ({
      id: `${chapter}-0${k}`,
      chapter,
      cast: k === 2 ? ['char:lin-zheng', 'char:bai-yao'] : ['char:lin-zheng'],
      props: k === 4 ? { 'obj:black-key': { holder: chapter % 2 ? 'char:shen-yan' : 'char:lin-zheng', used: false, intact: true } } : {},
      appearance: k === 2 && chapter > 52 ? {} : k === 2 ? { 'char:bai-yao': { left_hand_injured: true } } : {},
      location: 'loc:moon-platform',
      visual: k === 5 ? '（stub）铜铃在檐下震响，声浪压过夜风。' : '（stub）月台之上，林峥按刀而立。',
      camera: '中景 侧面',
    })),
  }),
}

function shotStub(sc = 'clean') {
  return {
    id: `stub:${sc}`,
    stub: true,
    async complete({ chapter }) {
      const parsed = (STUB_SHOTS[sc] ?? STUB_SHOTS.clean)(chapter)
      return { parsed, raw: JSON.stringify(parsed), usage: { inputTokens: 800, outputTokens: 600, ms: 1 } }
    },
  }
}

// ── 三臂 ────────────────────────────────────────────────────────────────
const collect = (usage, res) => {
  usage.inputTokens += res.usage.inputTokens
  usage.outputTokens += res.usage.outputTokens
  usage.ms += res.usage.ms
  usage.calls++
}
const takeShots = (res, chapter) =>
  (res.parsed?.shots ?? []).map((s) => ({ ...s, chapter: Number(s.chapter) || chapter }))

const ARMS = {
  a0: {
    id: 'a0-naive',
    name: '裸模型 + 尾部截断',
    async run({ model, chapters }) {
      const usage = { inputTokens: 0, outputTokens: 0, ms: 0, calls: 0 }
      const shots = []
      for (const chapter of chapters) {
        const prompt = `以下是一部长篇小说的最近正文（因篇幅所限只给出结尾部分）：\n\n${corpusTail.slice(-budget)}\n\n${goalLine(chapter)}\n${OUTPUT_SPEC}`
        const res = await model.complete({ prompt, chapter })
        collect(usage, res)
        shots.push(...takeShots(res, chapter))
      }
      return { shots, usage }
    },
  },

  a1: {
    id: 'a1-rag',
    name: '向量 RAG（topK 检索 + 尾部正文）',
    async run({ model, chapters }) {
      const usage = { inputTokens: 0, outputTokens: 0, ms: 0, calls: 0 }
      const shots = []
      // 嵌入缓存写自己的目录——results/ 那份正被在跑的实验用着
      const cachePath = join(outDir, '.embed-cache.json')
      const chunks = chunkCorpus(corpusTail)
      const vecs = await embed(chunks.map((c) => c.text), { cachePath, usage })
      const index = chunks.map((c, i) => ({ ...c, vec: vecs[i] }))
      const tailRoom = Math.floor(budget * 0.6)
      const retrRoom = budget - tailRoom

      for (const chapter of chapters) {
        const recent = corpusTail.slice(-tailRoom)
        const qvecs = await embed([task.goal, recent.slice(-300)], { cachePath, usage })
        const hits = retrieve({ queryVecs: qvecs, index, k: 6, exclude: (c) => recent.includes(c.text.slice(0, 40)) })
        let used = 0
        const passages = []
        for (const h of hits) {
          const block = `〔第${h.chapter}章〕${h.text}`
          if (used + block.length > retrRoom) break
          passages.push(block)
          used += block.length
        }
        const prompt =
          `以下是一部长篇小说的资料。\n\n【从全书检索到的相关片段】\n${passages.join('\n\n') || '（无）'}\n\n` +
          `【最近正文】\n${recent}\n\n${goalLine(chapter)}\n${OUTPUT_SPEC}`
        const res = await model.complete({ prompt, chapter })
        collect(usage, res)
        shots.push(...takeShots(res, chapter))
      }
      return { shots, usage }
    },
  },

  a3: {
    id: 'a3-benxiang',
    name: 'Benxiang（状态投影）',
    async run({ model, chapters }) {
      const usage = { inputTokens: 0, outputTokens: 0, ms: 0, calls: 0 }
      const shots = []
      for (const chapter of chapters) {
        // 复用叙事投影器：它挑的正是「此刻需要看见的」人物/物品/规则/禁区。
        // 注意 a3 在这里**没有写回门禁**——W3-V 目前只考投影，不考事务。
        // 门禁要不要接进来（画面违规退回重画）是下一步，且必须单独立项、单独计成本。
        const ctx = compileContext({ spec, state: state0, task, chapter, budget, recentText: corpusTail })
        const prompt = `${ctx.text}\n\n${goalLine(chapter)}\n${OUTPUT_SPEC}`
        const res = await model.complete({ prompt, chapter })
        collect(usage, res)
        shots.push(...takeShots(res, chapter))
      }
      return { shots, usage }
    },
  },
}

// ── 运行护栏（照搬 run.mjs：锁 / 不静默覆盖 / 出处）───────────────────────
mkdirSync(outDir, { recursive: true })
const LOCK = join(outDir, '.run.lock')
if (existsSync(LOCK) && !process.argv.includes('--allow-concurrent')) {
  const held = JSON.parse(readFileSync(LOCK, 'utf8'))
  let alive = true
  try { process.kill(held.pid, 0) } catch { alive = false }
  if (alive) {
    console.error(`✗ 已有实验在跑（pid ${held.pid}，${held.startedAt}）：\n    ${held.argv}`)
    process.exit(1)
  }
  console.error(`  ⚠ 发现残留锁（pid ${held.pid} 已不存在），清理后继续`)
}

const gitCommit = (() => {
  try { return execSync('git rev-parse --short HEAD', { cwd: HERE, encoding: 'utf8' }).trim() } catch { return null }
})()
const provenance = {
  startedAt: new Date().toISOString(),
  pid: process.pid,
  argv: process.argv.slice(2).join(' '),
  gitCommit,
  specHash: specHash(HERE, taskFile),
  // 考题在 world/tasks-v/ 下，specHash 遍历不到——必须自己入指纹（见 shot-diff.mjs 注释）
  shotTaskHash: shotTaskHash(taskFile),
  shotJudgeHash: shotJudgeHash(),
  taskFile,
  provider,
  model: modelName ?? '(默认)',
  budget,
  bench: 'W3-V',
}
writeFileSync(LOCK, JSON.stringify(provenance, null, 2))
const releaseLock = () => { try { unlinkSync(LOCK) } catch {} }
process.on('exit', releaseLock)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { releaseLock(); process.exit(130) })

// ── 跑 ──
const selected = which === 'all' ? ['a0', 'a1', 'a3'] : which.split(',')
const chapters = task.chapters
const report = []

for (const key of selected) {
  const armDef = ARMS[key]
  if (!armDef) throw new Error(`未知实验臂 ${key}`)
  for (let rep = 1; rep <= repeat; rep++) {
    const model = provider === 'stub' ? shotStub(scenario) : createModel({ provider, model: modelName, scenario })
    const { shots, usage } = await armDef.run({ model, chapters })
    const result = { arm: armDef.id, stub: !!model.stub, shots, usage }
    const w3v = scoreW3V(result, task)
    report.push({ armDef, result, w3v, rep })

    const n = rep + repOffset
    const suffix = repeat > 1 || repOffset ? `-rep${n}` : `-${scenario}`
    const path = join(outDir, `${key}-v-${provider}${suffix}.json`)
    if (existsSync(path) && !force) {
      console.error(`✗ ${path} 已存在，拒绝覆盖。改 --rep-offset 续编号，或确认要重跑再加 --force。`)
      process.exit(1)
    }
    writeFileSync(path, JSON.stringify({ result, w3v, provenance: { ...provenance, rep: n, finishedAt: new Date().toISOString() } }, null, 2))
  }
}

// ── 报告 ──
const stub = provider === 'stub'
console.log('\n' + '='.repeat(66))
console.log(` ShadowBench-W · V（视觉方言）· 第 ${chapters[0]}-${chapters.at(-1)} 章分镜`)
console.log('='.repeat(66))
if (stub) {
  console.log('\n  ⚠⚠ STUB 模式：模型输出是固定剧本，下列数字仅验证流程连通，')
  console.log('     不是实验结果，不得引用。')
}
if (!corpusIsReal) console.log('  ⚠ 基线语料未生成，A0/A1 的「最近正文」暂用大纲摘要顶替。')

for (const { armDef, w3v, result, rep } of report) {
  console.log(`\n── ${armDef.name}${repeat > 1 ? ` · 第 ${rep} 次` : ''} ──`)
  console.log(`  ${w3v.shots} 镜 / ${w3v.chapters} 章 → EPS ${w3v.eps.toFixed(1)}（每百镜错误数，主指标）`)
  console.log(`  错误 ${w3v.errors} 处：V1 持有 ${w3v.byKind.V1}｜V2 属性掉落 ${w3v.byKind.V2}｜V3 视觉后果 ${w3v.byKind.V3}`)
  if (w3v.attributeDropRate !== null)
    console.log(`  属性掉落率 ${(w3v.attributeDropRate * 100).toFixed(1)}%（白遥在场 ${w3v.engagement.baiYaoShots} 镜）`)
  console.log(`  接触度：SPC ${w3v.engagement.spc}｜白遥 ${w3v.engagement.baiYaoShots} 镜｜钥匙 ${w3v.engagement.keyShots} 镜｜铃响 ${w3v.engagement.bellShots} 镜`)
  if (!w3v.engagementOk) console.log(`  ⚠ 接触不足（${w3v.engagement.shortfalls.join('，')}）——本轮分数不可与达标轮次并列`)
  for (const f of w3v.findings.slice(0, 12)) console.log(`     ✗ [${f.kind}] ${f.shot} ${f.why}`)
  if (w3v.findings.length > 12) console.log(`     …… 另 ${w3v.findings.length - 12} 处`)
  if (w3v.leakFindings.length) console.log(`  V4 知识泄漏（正则通道，未并入主分）：${w3v.leakFindings.length} 处`)
  const u = result.usage
  console.log(`  用量：输入 ${u.inputTokens} tok，输出 ${u.outputTokens} tok，${u.calls} 次调用，${u.ms}ms`)
}

console.log('\n' + '─'.repeat(66))
console.log(' 这道题只测**投影**，不测**渲染**。跑赢它不等于生成的视频不崩——')
console.log(' 它证明的是状态能否正确编译成一份可渲染的画面规格，下游认不认是另一件事。')
console.log(`\n结果已写入 ${outDir}\n`)
