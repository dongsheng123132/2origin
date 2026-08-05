#!/usr/bin/env node
// W3-V 判分：视觉投影正确性。
//
// 把「AI 动漫角色一致性」还原成可判的问题：系统能不能从世界状态投影出一份
// **属性正确、且跨镜头不掉**的分镜表？不测像素，测属性。
//
//   node shot-diff.mjs <arm-output.json> [--json]
//
// arm-output.json 形如 { "arm": "a3-benxiang", "shots": [...] }
//
// ── 为什么新开一个文件而不是扩 state-diff.mjs ────────────────────────────────
// judgeHash() 哈希的是 eval/ 下的白名单六件（ced/state-diff/detect-score/judge/
// replay/engagement）。改动其中任何一个，都会让所有历史结果的 judgeHash 对不上，
// 而 A3 的 deepseek 臂此刻正在跑。新增文件不在白名单里，不动既有口径——
// 等这套考题真要并入主分，再显式把它加进 SCORERS 并统一重跑，那时指纹**应该**变。

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const taskPath = (file) => join(HERE, '..', 'world', 'tasks-v', file)

/** 答案集由调用方显式传入——环境变量那条路是坏的（第六起事故，见 state-diff.mjs 注释） */
export function loadShotTask(file = 'storyboard-m.json') {
  return JSON.parse(readFileSync(taskPath(file), 'utf8'))
}

// ── 指纹：这套考题自己的两半 ──────────────────────────────────────────────
// 第四起事故的教训：specHash 覆盖了 ground truth 却漏了判分器本身，改完 ced.mjs
// 的否定过滤，findings 从 18 降到 12——同一批正文、同一版规格，分数变了而指纹纹丝不动。
//
// W3-V 这里有一个额外的坑：考题文件放在 world/tasks-v/ 而**不在** world/spec.origin/ 下
//（放进去会当场改掉在跑实验的 specHash，那正是第二起事故的形状）。代价是 specHash()
// 遍历不到它——所以它的内容必须自己单独入指纹，否则改了答案集没有任何环节会发现。
export function shotTaskHash(file = 'storyboard-m.json') {
  return createHash('sha1').update(readFileSync(taskPath(file))).digest('hex').slice(0, 12)
}

export function shotJudgeHash() {
  return createHash('sha1').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0, 12)
}

// ── 归一化层（协议原则 §1.7）──────────────────────────────────────────────
// 模型会用各种写法表达同一件事。运行时本就知道自己要什么，不该让接口去刁难它：
//   props: { "obj:black-key": "char:lin-zheng" }        ← 直接给持有者
//   props: { "obj:black-key": { holder: "lin-zheng" } } ← 掉了前缀
// 两种都收下。Run #1 的 5 章全废就是因为把「照抄了展示形式」判成了「未知对象」。
const withPrefix = (id, prefix) => (!id || id.startsWith(prefix) ? id : prefix + id)

function normProp(v) {
  if (v == null) return null
  if (typeof v === 'string') return { holder: withPrefix(v, 'char:') }
  return { ...v, holder: withPrefix(v.holder, 'char:') }
}

function normShot(shot, i) {
  return {
    id: shot.id ?? `#${i + 1}`,
    chapter: Number(shot.chapter) || 0,
    cast: (shot.cast ?? []).map((c) => withPrefix(String(c), 'char:')),
    props: Object.fromEntries(
      Object.entries(shot.props ?? {}).map(([k, v]) => [withPrefix(k, 'obj:'), normProp(v)])
    ),
    appearance: Object.fromEntries(
      Object.entries(shot.appearance ?? {}).map(([k, v]) => [withPrefix(k, 'char:'), v ?? {}])
    ),
    location: shot.location ? withPrefix(String(shot.location), 'loc:') : null,
    visual: String(shot.visual ?? ''),
    camera: String(shot.camera ?? ''),
  }
}

/** 镜头按章、再按在数组中的原始次序排——分镜表本身就是有序的 */
function ordered(shots) {
  return shots.map(normShot).map((s, i) => ({ ...s, _i: i })).sort((a, b) => a.chapter - b.chapter || a._i - b._i)
}

// ── V3 的正则：否定与转述必须先过滤 ───────────────────────────────────────
// ced.mjs 的 custody / left-hand 两条规则当初就栽在这里（第四起事故）：
// 「钥匙**不在**赵七处」被判成钥匙归赵七。分镜表的 visual 同样会出现
// 「空间门**紧闭**」「铜铃**未**响」这类写法，抓错了就是凭空造一条违规。
const NEG = /(未|没有|没|不曾|不再|无人|并未|尚未|不|绝无|全无|毫无)/
// 「不停」「不住」是程度副词不是否定——「铜铃不停地响」是响了。
// 这类例外必须先剔掉再判否定，否则修完误报就会造出漏报。
const NEG_EXCEPT = /(不停|不住|不绝|不断|不已|无休|无不)/g
const negated = (s) => NEG.test(s.replace(NEG_EXCEPT, ''))

/**
 * 句内检测：pat 命中，且**匹配前方 6 字内与匹配区间之内**都没有否定词。
 *
 * 自测第一次跑就抓到了这里的洞：原先只查匹配之前，而「铜铃**未**响」的否定词
 * 正落在 `(铜铃)[^，,]{0,6}(响)` 这个匹配的中间——一个字都没漏，却完全没被看见。
 * 与 ced.mjs 第四起事故同型：否定词插在主语与谓语之间，前缀窗口永远够不着。
 */
function hits(text, pat) {
  const out = []
  for (const seg of text.split(/[。；;！!？?\n]/)) {
    const m = seg.match(pat)
    if (!m) continue
    const before = seg.slice(Math.max(0, m.index - 6), m.index)
    if (negated(before) || negated(m[0])) continue
    out.push(seg.trim())
  }
  return out
}

/** 有无「非否定的」命中——正例检测（如「鸟飞了吗」）也必须走同一套否定过滤 */
const has = (text, pat) => hits(text, pat).length > 0

const P = {
  bellRings: /(铜铃|铃铛|铃)[^，,]{0,6}(鸣|响|震|颤|摇动|摇起)/,
  birdsFly: /(禽鸟|飞鸟|群鸟|鸟群|宿鸟|寒鸦|鸦|雀|鹭)[^，,]{0,8}(惊起|惊飞|飞起|腾空|掠起|四散|散去|冲天)/,
  gateOpen: /(空间门|石门|门扉)[^，,]{0,8}(开启|洞开|大开|敞开|裂开|透出光|透光)/,
  weapon: /(刀|剑|兵刃|长枪|弓|弩|矛|斧)/,
  disarmed: /(交械|卸下|解下|缴械|空手|未佩|不佩)/,
  linZheng: /林峥/,
  baiYao: /白遥/,
  shenYan: /沈砚/,
  seeThrough: /(识破|看穿|了然|瞪|质问|戒备|审视|狐疑|盯住|逼视|寒声问)/,
  expose: /(点破|指认|当众揭|揭穿|喝破)/,
}

// ── V1 · 道具持有正确性 ───────────────────────────────────────────────────
// 三件事：值域、单调、终局。单调是这里最要紧的一条——
// 转交是不可逆事件，钥匙在角色之间来回瞬移正是视频里最典型的崩坏形态，
// 而它在**任何单帧上都看不出来**，只有把镜头排成序列才判得出。
function checkCustody(shots, inv) {
  const findings = []
  const objId = inv.object
  const seq = shots.filter((s) => s.props[objId]).map((s) => ({ shot: s, p: s.props[objId] }))

  let handedOver = false
  for (const { shot, p } of seq) {
    const h = p.holder
    if (h && !inv.allowed_holders.includes(h))
      findings.push({ kind: 'V1', shot: shot.id, why: `持有者 ${h} 不在允许集合 ${inv.allowed_holders.join('/')} 内` })

    if (inv.monotonic) {
      if (h === inv.final_holder) handedOver = true
      else if (handedOver && h)
        findings.push({ kind: 'V1', shot: shot.id, why: `钥匙已交回 ${inv.final_holder}，此镜又回到 ${h}——转交不可逆` })
    }

    for (const [field, want] of Object.entries(inv.must_stay ?? {})) {
      if (p[field] !== undefined && p[field] !== want)
        findings.push({ kind: 'V1', shot: shot.id, why: `${objId}.${field} 应恒为 ${want}，此镜为 ${p[field]}` })
    }
  }

  if (!seq.length) findings.push({ kind: 'V1', shot: '—', why: `全片无一镜出现 ${objId}，终局持有者无从判定` })
  else {
    const last = seq.at(-1)
    if (last.p.holder !== inv.final_holder)
      findings.push({ kind: 'V1', shot: last.shot.id, why: `终局持有者应为 ${inv.final_holder}，实为 ${last.p.holder ?? '未写'}` })
  }

  return { findings, keyShots: seq.length }
}

// ── V2 · 外观属性跨镜头持续性 ─────────────────────────────────────────────
// 「一致性崩坏」的可测代理。角色在场即须带着该属性；缺失与写成 false 都算掉落，
// 但分别记明——缺失是「忘了」，false 是「写反了」，对上游是两种不同的毛病。
function checkPersistence(shots, checks) {
  const findings = []
  const denom = {}
  for (const c of checks) {
    const present = shots.filter((s) => s.cast.includes(c.character))
    denom[c.character] = present.length
    for (const s of present) {
      const got = s.appearance[c.character]?.[c.attribute]
      if (got === undefined)
        findings.push({ kind: 'V2', shot: s.id, why: `${c.character} 在场但未带 ${c.attribute}（应恒为 ${c.value}）——属性掉落`, drop: 'missing' })
      else if (got !== c.value)
        findings.push({ kind: 'V2', shot: s.id, why: `${c.character}.${c.attribute} 应为 ${c.value}，此镜为 ${got}——属性翻转`, drop: 'flipped' })
    }
  }
  return { findings, denom }
}

// ── V3 · 世界规则的视觉后果 ───────────────────────────────────────────────
// 视觉方言独有的一类。rule:bell-birds 的规格原文写着「可观测现象，不可静默发生」——
// 正文里作者可以不写鸟，分镜表里不画就是漏了画面元素。
function checkConsequence(shots, checks) {
  const findings = []
  let bellShots = 0

  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    const next = shots[i + 1]

    for (const c of checks) {
      if (c.type === 'co_occurrence' && c.rule === 'rule:bell-birds') {
        if (!has(s.visual, P.bellRings)) continue
        bellShots++
        // 同镜或紧邻下一镜——铃响与鸟飞在分镜上允许拆成两镜，这是正常的剪辑语法。
        // 正例一侧同样走否定过滤：「却不见飞鸟惊起」不能算作满足了这条规则。
        const ok = has(s.visual, P.birdsFly) || (next && next.chapter === s.chapter && has(next.visual, P.birdsFly))
        if (!ok) findings.push({ kind: 'V3', shot: s.id, why: `铃响镜未见禽鸟惊飞（${c.rule}：可观测现象，不可静默发生）` })
      }

      if (c.type === 'forbidden_visual' && c.rule === 'fz:gate-closed') {
        for (const seg of hits(s.visual, P.gateOpen))
          findings.push({ kind: 'V3', shot: s.id, why: `画面显示空间门开启（${c.rule}）：「${seg}」` })
      }

      if (c.type === 'conditional_forbidden' && c.rule === 'rule:disarm') {
        const inTown = s.location === 'loc:dukou-zhen'
        const hasToken = 'obj:beiting-token' in s.props
        if (inTown && hasToken && P.weapon.test(s.visual) && !P.disarmed.test(s.visual))
          findings.push({ kind: 'V3', shot: s.id, why: `持北庭令牌者在渡口镇画面中仍带兵器（${c.rule}）` })
      }
    }
  }
  return { findings, bellShots }
}

// ── V4 · 知识边界的画面泄漏（正则通道，单列不并入主分）────────────────────
// 禁区在视觉方言里换了形态：正文里泄密是写出来的一句话，分镜表里泄密是一个**表演指示**。
// 正则只能抓表层措辞，沿用 Run #4 的纪律——判官校准完成前，这一类结果单列。
function checkLeak(shots) {
  const findings = []
  for (const s of shots) {
    const v = s.visual
    if (P.linZheng.test(v) && P.baiYao.test(v) && P.seeThrough.test(v))
      findings.push({ kind: 'V4', shot: s.id, why: `林峥对白遥的表演指示疑似泄露已知叛变（fz:betrayal-secret）：「${v.slice(0, 60)}」` })
    if (P.shenYan.test(v) && P.baiYao.test(v) && P.expose.test(v))
      findings.push({ kind: 'V4', shot: s.id, why: `沈砚疑似当众点破内应身份（fz:suspicion-unresolved）：「${v.slice(0, 60)}」` })
  }
  return { findings }
}

export function scoreW3V(reported, task = loadShotTask()) {
  const shots = ordered(reported.shots ?? [])
  const inv = task.visual_invariants

  const v1 = checkCustody(shots, inv.V1_custody)
  const v2 = checkPersistence(shots, inv.V2_persistence.checks)
  const v3 = checkConsequence(shots, inv.V3_visual_consequence.checks)
  const v4 = checkLeak(shots)

  // 主分只含确定性三类；V4 单列（正则通道，未校准）
  const findings = [...v1.findings, ...v2.findings, ...v3.findings]
  const errors = findings.length
  const total = shots.length
  const chapters = new Set(shots.map((s) => s.chapter)).size

  // ── 接触度（Run #10 的教训在视觉方言里更容易犯）─────────────────────────
  // 少画几个镜头、不让白遥出场、不给钥匙特写，确定性通道就判它零错误。
  // 「接触少而错误少不是正确，是回避」——所以下限不达标必须显式标注出来。
  const baiYaoShots = v2.denom['char:bai-yao'] ?? 0
  const floor = task.engagement.floor
  const spc = chapters ? total / chapters : 0
  const shortfalls = []
  if (spc < floor.shots_per_chapter_min) shortfalls.push(`SPC ${spc.toFixed(1)} < ${floor.shots_per_chapter_min}`)
  if (baiYaoShots < floor.bai_yao_shots_min) shortfalls.push(`白遥在场 ${baiYaoShots} 镜 < ${floor.bai_yao_shots_min}`)
  if (v1.keyShots < floor.key_shots_min) shortfalls.push(`含钥匙 ${v1.keyShots} 镜 < ${floor.key_shots_min}`)

  const drops = v2.findings.length

  return {
    arm: reported.arm,
    shots: total,
    chapters,
    // 主指标：每百镜错误数。镜头数由各臂自由决定，绝对错误数会被镜头数稀释。
    eps: total ? (errors / total) * 100 : 0,
    errors,
    byKind: {
      V1: v1.findings.length,
      V2: v2.findings.length,
      V3: v3.findings.length,
      V4: v4.findings.length,
    },
    // 次要但最贴题：与「一致性崩坏」直接对应的那个数
    attributeDropRate: baiYaoShots ? drops / baiYaoShots : null,
    engagement: { spc: Number(spc.toFixed(2)), baiYaoShots, keyShots: v1.keyShots, bellShots: v3.bellShots, shortfalls },
    engagementOk: shortfalls.length === 0,
    findings,
    leakFindings: v4.findings,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  if (!file) {
    console.log('用法: node shot-diff.mjs <arm-output.json> [--json]')
    process.exit(1)
  }
  const r = scoreW3V(JSON.parse(readFileSync(file, 'utf8')))
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2))
  } else {
    console.log(`# W3-V 视觉投影正确性 · ${r.arm}\n`)
    console.log(`  ${r.shots} 镜 / ${r.chapters} 章 → EPS ${r.eps.toFixed(1)}（每百镜错误数，主指标）`)
    console.log(`  错误 ${r.errors} 处：V1 持有 ${r.byKind.V1}｜V2 属性掉落 ${r.byKind.V2}｜V3 视觉后果 ${r.byKind.V3}`)
    if (r.attributeDropRate !== null) console.log(`  属性掉落率 ${(r.attributeDropRate * 100).toFixed(1)}%（白遥在场 ${r.engagement.baiYaoShots} 镜）`)
    console.log(`  接触度：SPC ${r.engagement.spc}｜白遥 ${r.engagement.baiYaoShots} 镜｜钥匙 ${r.engagement.keyShots} 镜｜铃响 ${r.engagement.bellShots} 镜`)
    if (!r.engagementOk) console.log(`  ⚠ 接触不足（${r.engagement.shortfalls.join('，')}）——本轮分数不可与达标轮次并列`)
    for (const f of r.findings) console.log(`     ✗ [${f.kind}] ${f.shot} ${f.why}`)
    if (r.leakFindings.length) {
      console.log(`\n  V4 知识泄漏（正则通道，未并入主分）：${r.leakFindings.length} 处`)
      for (const f of r.leakFindings) console.log(`     ? ${f.shot} ${f.why}`)
    }
  }
}
