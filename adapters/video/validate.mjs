#!/usr/bin/env node
// 本象·视频方言 —— 校验器
//
// 它存在的唯一理由：**让缺席发声**（bugscope A4）。
//
// 一条视频管线可以在三种情况下「零 error 全错」：
//   1. 时间码错了（我们真踩过：drawtext 写成 t*5，全片 ×5，render 照样输出 30.000s 并报 OK）
//   2. 素材换了（同名不同内容，旧时间码剪新视频，静默错位）
//   3. 抽帧盲区吞掉了事件（fps=1/5 时，5 秒内的任何事都不存在，而 timeline 看起来是完整的）
//
// 三种全部不报错、不崩溃、产出合法 mp4。所以它们不能靠"跑一下看看"发现，
// 只能在**入口拦**（RFC-0004：「验证器抓不出来，这类死角只能在入口拦。」）
//
// 用法:
//   node validate.mjs timeline.origin.json          # 人读
//   node validate.mjs timeline.origin.json --json   # 给 AI 吃
// 退出码: 0 = 无 error（可能有 warn）; 1 = 有 error; 2 = 用法错误

import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'

/** 第七要素的五种边界类型（沿用 本象协议/compiler/limits.mjs，不另发明） */
const LIMIT_KINDS = {
  degraded: '本该有的能力退化了，仍可用但会失真',
  uncovered: '参照数据不完备，判定范围小于声称范围',
  undetectable: '这一类问题确定性检查抓不到',
  lossy: '这一步已经丢掉了信息',
  unverified: '有主张但尚未在真实条件下测过',
}

/** value 的判据来源。**只描述那个分是怎么来的**，不描述 gist 从哪来——两者正交。
 *  A1 的解法不是把断言变成观察，是不让断言冒充观察。
 *  现实里美学/价值判断几乎永远是 asserted；只有接了真实反馈数据才配叫 measured。 */
const BASIS = {
  measured: '由外部数据支撑（完播率、点赞、下单、留人曲线）——可复算',
  observed: 'value 本身就是可直接观察的事实（如「画面全屏铺满」），不含审美判断',
  asserted: '模型/人的判断（爆点、卖点、值不值得剪）——不可复核，必须带口径与日期',
}

/** v0.3 · 判断层的刻度（bugscope A3：判断与决策分离）
 *
 *  问模型要一个 [0,1] 的浮点，它会给你 0.94。那个 4 是编的——
 *  它既不代表可复现的测量，也不代表模型内部真有 1% 的分辨率，只代表"看起来很确定"。
 *  本项目 v0.1 的 `value: 0.92` 就是这么来的（见 docs/00-反思 §三·A1）。
 *
 *  改法抄自 MENTIS（arXiv 2607.27201，Hao Fei / Yiran Zhao）的 branch evaluation：
 *  **强制模型先出 1–5 档，再由确定性函数映射到固定分值**，模型无权直接写 value。
 *  这不提高准确率，它做的是**让分数诚实地暴露自己的分辨率**——
 *  五档就是五档，写不出 0.94 这种假精度。
 *
 *  归属：离散档 + 确定性映射的做法是 MENTIS 的，本项目引用，不声称原创。
 *  详见 docs/03-心智世界建模-先例实查与本象定位.md */
const GRADE_SCALE = { 1: 0, 2: 0.25, 3: 0.5, 4: 0.75, 5: 1 }
const GRADE_VALUES = new Set(Object.values(GRADE_SCALE))

/** gist 的来源。与 basis 正交：转写来源再可靠，也不能让 value 免于被标成断言。 */
const GIST_FROM = {
  'read-on-screen': '从画面上读到的（烧录字幕、UI 文字）',
  transcribed: '从音频转写来的，可回到 ref 复听（转写本身可能错）',
  described: '人/模型自己概括的，非原文',
}

const out = []
const push = (severity, code, msg, extra = {}) => out.push({ severity, code, msg, ...extra })
const err = (...a) => push('error', ...a)
const warn = (...a) => push('warn', ...a)
const note = (...a) => push('note', ...a)

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const file = argv.find(a => !a.startsWith('--'))
if (!file) {
  console.error('用法: node validate.mjs <timeline.origin.json> [--json]')
  process.exit(2)
}
const root = dirname(resolve(file))
let doc
try {
  doc = JSON.parse(readFileSync(file, 'utf8'))
} catch (e) {
  console.error(`无法解析 ${file}: ${e.message}`)
  process.exit(2)
}

// ── 第一问 · 新鲜度：这份表示描述的到底是哪条素材？（引用优先 ④ / A4 失效 #3）
let realDuration = null
const src = doc.source ?? {}
const srcPath = src.file ? resolve(root, src.file) : null

if (!srcPath || !existsSync(srcPath)) {
  err('src-missing', `source.file 指向的素材不存在：${src.file ?? '(未声明)'} —— 表示无法被解析回真源`)
} else {
  try {
    const probed = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', srcPath,
    ], { encoding: 'utf8' }).trim()
    realDuration = parseFloat(probed)
  } catch {
    warn('probe-failed', 'ffprobe 不可用，跳过时长核对——本次校验的时间码值域检查不成立')
  }

  if (!src.sha256) {
    err('src-no-fingerprint',
      'source 缺少 sha256 —— 换一条同名素材，全部时间码会静默错位而管线照常输出成片（bugscope A4）')
  } else {
    const actual = createHash('sha256').update(readFileSync(srcPath)).digest('hex')
    if (actual !== src.sha256) {
      err('src-fingerprint-mismatch',
        `素材指纹不符：声明 ${src.sha256.slice(0, 12)}… 实际 ${actual.slice(0, 12)}… —— 这份 timeline 描述的不是这条素材`)
    } else {
      note('src-fresh', `素材指纹核对通过 ${actual.slice(0, 12)}…`)
    }
  }

  if (realDuration != null && src.duration_s != null && Math.abs(realDuration - src.duration_s) > 1) {
    err('src-duration-mismatch',
      `声明时长 ${src.duration_s}s 与实际 ${realDuration.toFixed(1)}s 不符`)
  }
}

const D = realDuration ?? src.duration_s ?? null

// ── 第二问 · 值域：时间码落在片子里吗？（正是 ×5 bug 的解药）
const events = Array.isArray(doc.events) ? doc.events : []
if (!events.length) err('no-events', 'events 为空——这份表示什么都没说')

const spans = []
events.forEach((e, i) => {
  const at = e.id ?? `#${i}`
  const t = e.t
  if (!Array.isArray(t) || t.length !== 2 || t.some(x => typeof x !== 'number')) {
    err('bad-t', `事件 ${at} 的 t 不是 [start, end] 数字对`)
    return
  }
  const [s, x] = t
  if (x <= s) err('t-not-increasing', `事件 ${at} 的 t=[${s},${x}] 结束不晚于开始`)
  if (s < 0) err('t-negative', `事件 ${at} 的起点 ${s} < 0`)
  if (D != null && x > D + 0.5) {
    err('t-out-of-range',
      `事件 ${at} 的终点 ${x}s 超出素材时长 ${D.toFixed(1)}s —— 时间码基准很可能错了（我们踩过 ×5 的坑）`)
  }
  spans.push({ at, s, x, e })
})

// ── v0.2：value 不在 events 里，在 appraisals 里
// 「哪段值钱」不是视频的内在属性，是视频与观众之间的关系。所以它属于投影层，不属于本象。
const appraisals = Array.isArray(doc.appraisals) ? doc.appraisals : []
const audiences = Array.isArray(doc.audiences) ? doc.audiences : []
const eventIds = new Set(events.map(e => e.id))
const audienceIds = new Set(audiences.map(a => a.id))
const isV2 = doc.$schema?.includes('v0.2')

/** 某事件在任一受众下的最高估值——用于"要不要精读"这类与受众无关的判断 */
const maxValueOf = id => {
  const hits = appraisals.filter(a => a.event === id && typeof a.value === 'number')
  return hits.length ? Math.max(...hits.map(h => h.value)) : null
}
/** 某事件在指定受众下的估值。有 measured 的以 measured 为准——真实数据压过断言。 */
const valueFor = (id, aud) => {
  const hits = appraisals.filter(a => a.event === id && a.audience === aud)
  if (!hits.length) return null
  return (hits.find(a => a.basis === 'measured') ?? hits[hits.length - 1]).value
}

// 重叠 / 乱序
const sorted = [...spans].sort((a, b) => a.s - b.s)
for (let i = 1; i < sorted.length; i++) {
  if (sorted[i].s < sorted[i - 1].x - 0.01) {
    warn('span-overlap', `事件 ${sorted[i - 1].at} 与 ${sorted[i].at} 时间重叠——同一秒有两个"真相"`)
  }
}

// ── 第三问 · 缺席：哪些地方我没看？（A4 失效 #1）
if (D != null && sorted.length) {
  let covered = 0, cursor = 0
  const gaps = []
  for (const sp of sorted) {
    if (sp.s > cursor + 0.5) gaps.push([+cursor.toFixed(1), +sp.s.toFixed(1)])
    covered += Math.max(0, sp.x - Math.max(sp.s, cursor))
    cursor = Math.max(cursor, sp.x)
  }
  if (cursor < D - 0.5) gaps.push([+cursor.toFixed(1), +D.toFixed(1)])
  const pct = (covered / D) * 100
  note('coverage', `事件覆盖 ${pct.toFixed(1)}% 的素材时长`, { gaps })
  if (gaps.length) {
    warn('coverage-gap',
      `有 ${gaps.length} 段未被任何事件描述，合计 ${(D - covered).toFixed(1)}s —— 这不等于那里没内容，只等于没人看过`,
      { gaps })
  }
}

// ── 第四问 · 盲区：采样粒度决定了我看不见什么（A4 失效 #1 的根因）
const sampling = doc.sampling ?? {}
const stride = sampling.pass1?.stride_s ?? sampling.video_interval_s
if (!stride) {
  err('no-sampling-declared',
    'sampling.pass1.stride_s 未声明 —— 不说明抽帧粒度，就无法知道这份 timeline 漏掉了多长的事件')
} else {
  warn('sampling-blindspot',
    `一遍抽帧间隔 ${stride}s：短于 ${stride}s 的事件可能整个落在两格之间，未做二遍精读的事件边界精度不优于 ${stride}s`)

  // 把 V-PASS1-RESOLUTION 的 remedy 变成可执行检查：高价值事件必须做过二遍精读
  // 用"任一受众下的最高估值"——对某个受众值钱，边界就得划准
  const ranges = (sampling.pass2 ?? []).map(p => p.range).filter(r => Array.isArray(r) && r.length === 2)
  const coarse = spans.filter(({ e }) => (maxValueOf(e.id) ?? e.value ?? 0) >= 0.7)
    .filter(({ s, x }) => !ranges.some(([a, b]) => s >= a - 0.5 && x <= b + 0.5))
  if (coarse.length) {
    warn('hi-value-not-refined',
      `${coarse.length} 个高价值事件（≥0.7）只经过一遍 ${stride}s 粗读，未做二遍精读：` +
      `${coarse.map(c => c.at).join(' ')} —— 它们的边界和爆点位置可能像 e10 一样是错的`)
  }
}
if (!sampling.asr || sampling.asr === 'none') {
  warn('no-asr',
    '未使用 ASR。若素材没有烧录字幕，语音通道完全缺席；即使有字幕，语气/停顿/笑声/语速也全部丢失')
}

// ── 第五问 · events 里不许再出现 value：那是投影，不是本象
for (const { at, e } of spans) {
  if (isV2 && e.value != null) {
    err('value-in-event',
      `事件 ${at} 里还带着 value —— v0.2 起 value 属于 appraisals。`
      + `「哪段值钱」不是视频的内在属性，是视频与观众的关系，放进本象就等于把一个投影当成了事实`)
  }
  // gist 的来源与估值的判据正交。转写来源再可靠，也不能让 value 免于被标成断言——
  // 这两件事被塞进同一个字段时，断言会重新隐身（本项目 2026-08-09 亲手踩过一次）。
  if (e.gist && !e.gist_from) {
    err('gist-no-source',
      `事件 ${at} 有 gist 却没写 gist_from —— 读来的、听来的、还是自己概括的，下游据此决定信几分`)
  } else if (e.gist_from && !(e.gist_from in GIST_FROM)) {
    err('bad-gist-from',
      `事件 ${at} 的 gist_from=${JSON.stringify(e.gist_from)} 不在 ${Object.keys(GIST_FROM).join(' / ')} 内`)
  }
  if (e.gist_from === 'transcribed' && !(Array.isArray(e.evidence) && e.evidence.length)) {
    err('transcribed-no-ref', `事件 ${at} 的 gist 来自转写，却没给可复听的 ref`)
  }
}

// ── 第五问之二 · 受众：口径的载体
if (isV2) {
  if (!audiences.length) {
    err('no-audiences', 'v0.2 缺 audiences[] —— 没有受众就没有口径，value 就无处安放')
  }
  for (const [i, a] of audiences.entries()) {
    const at = a.id ?? `#${i}`
    if (!a.id) err('audience-no-id', `受众 ${at} 缺 id`)
    if (!a.criterion) err('audience-no-criterion', `受众 ${at} 缺 criterion —— 按什么标准评的分`)
    if (!a.as_of) err('audience-no-as-of', `受众 ${at} 缺 as_of —— 口径会过期（A5）`)
    if (!a.who || /（.*补）/.test(a.who)) {
      warn('audience-placeholder',
        `受众 ${at} 的 who 是占位 —— 不知道他们是谁、为什么看、什么会让他们划走，这个口径就是空的`)
    }

    // v0.3 · 口径必须说清自己由什么构成，否则 value 是个不可追问的混合物
    const dims = a.dimensions
    if (dims == null) {
      warn('audience-no-dimensions',
        `受众 ${at} 未声明 dimensions —— value 是一个把"钩子强不强""说清楚没有""值不值得看完"揉成一个数的混合物。`
        + `揉进去之后就问不出"到底哪一项拉低了它"，判断与决策也没法分开（A3）`)
    } else if (typeof dims !== 'object' || Array.isArray(dims) || !Object.keys(dims).length) {
      err('audience-bad-dimensions', `受众 ${at} 的 dimensions 必须是非空的 {维度: 权重} 对象`)
    } else {
      const bad = Object.entries(dims).filter(([, w]) => typeof w !== 'number' || w < 0 || w > 1)
      if (bad.length) {
        err('audience-bad-weight',
          `受众 ${at} 的权重不在 [0,1]：${bad.map(([k, v]) => `${k}=${v}`).join(' ')}`)
      } else {
        const sum = Object.values(dims).reduce((s, w) => s + w, 0)
        if (Math.abs(sum - 1) > 1e-6) {
          err('audience-weights-not-normalized',
            `受众 ${at} 的权重和为 ${sum.toFixed(4)}，不是 1 —— 权重不归一，value 就不再落在 [0,1]，跨受众也没法比`)
        }
      }
    }
  }
}

// ── 第六问 · 估值：这个分是观察来的还是声称来的？（A1 / A2 / A5）
const byAud = {}
const falsePrecision = []   // 断言分落在五档之外的（假精度）
let derivedOk = 0           // value 由 grades 确定性算出的条数
for (const [i, a] of appraisals.entries()) {
  const at = `${a.event ?? '?'}@${a.audience ?? '?'}`
  if (!eventIds.has(a.event)) err('appraisal-bad-event', `估值 #${i} 指向不存在的事件 ${a.event}`)
  if (audiences.length && !audienceIds.has(a.audience)) {
    err('appraisal-bad-audience', `估值 ${at} 指向不存在的受众 ${a.audience}`)
  }
  if (typeof a.value !== 'number' || a.value < 0 || a.value > 1) {
    err('bad-value', `估值 ${at} 的 value=${a.value} 不在 [0,1]`)
  }
  if (!a.basis) {
    err('value-no-basis',
      `估值 ${at} 没有 basis —— 一个断言长得像观察，正是 bugscope A1 说的"存在被当成验证"`)
    continue
  }
  if (!(a.basis in BASIS)) {
    err('bad-basis', `估值 ${at} 的 basis=${JSON.stringify(a.basis)} 不在 ${Object.keys(BASIS).join(' / ')} 内`)
    continue
  }
  ;(byAud[a.audience] ??= { n: 0, asserted: 0 }).n++
  if (a.basis === 'asserted') {
    byAud[a.audience].asserted++
    if (!a.as_of) err('asserted-no-as-of', `估值 ${at} 是断言，却没写什么时候打的分（A5：验证会衰减）`)
    if (!a.by) warn('asserted-no-author', `估值 ${at} 是断言，没写是谁下的判断（A2：自证需要署名才能被追责）`)
  }
  if ((a.basis === 'observed' || a.basis === 'measured') && !(Array.isArray(a.evidence) && a.evidence.length)) {
    err('no-evidence',
      `估值 ${at} 声称 ${a.basis}，却没给 evidence —— 声称"我看到/我测过"本身就是声称（bugscope §4 自我指涉）`)
  }

  // ── v0.3 · A3：判断（打档）与决策（算分）分离
  const audDef = audiences.find(x => x.id === a.audience)
  const dims = audDef?.dimensions

  // 否决：安全/合规/授权类问题不参与加权，直接压 0。
  // 一个 5 档的爆点如果露了没授权的脸，它的正确分值是 0 而不是 0.9——加权算不出这个。
  if (a.veto != null) {
    if (!a.veto?.reason) err('veto-no-reason', `估值 ${at} 有 veto 却没写 reason —— 否决必须能被追问`)
    if (a.value !== 0) {
      err('veto-value-nonzero',
        `估值 ${at} 被 veto 却仍有 value=${a.value} —— 否决就是否决，不参与加权`)
    }
  } else if (a.basis === 'asserted' && dims && typeof dims === 'object' && !Array.isArray(dims)) {
    const g = a.grades
    if (g == null) {
      err('grades-missing',
        `估值 ${at} 是断言，受众已声明 ${Object.keys(dims).length} 个维度，却没给 grades —— `
        + `模型无权直接写 value：先按维度打 1–5 档（判断），value 由权重确定性算出（决策）`)
    } else if (typeof g !== 'object' || Array.isArray(g)) {
      err('bad-grades', `估值 ${at} 的 grades 必须是 {维度: 1–5} 对象`)
    } else {
      const missing = Object.keys(dims).filter(d => !(d in g))
      const extra = Object.keys(g).filter(d => !(d in dims))
      const illegal = Object.entries(g).filter(([, v]) => !Number.isInteger(v) || !(v in GRADE_SCALE))
      if (missing.length) {
        err('grade-dim-missing',
          `估值 ${at} 缺维度档位：${missing.join(' ')} —— 口径里有这一项而没打分，等于悄悄按 0 算（A4）`)
      }
      if (extra.length) {
        err('grade-dim-unknown',
          `估值 ${at} 打了口径里没有的维度：${extra.join(' ')} —— 它不参与加权，等于白打`)
      }
      if (illegal.length) {
        err('bad-grade',
          `估值 ${at} 的档位必须是整数 1–5：${illegal.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')} —— `
          + `档位就是分辨率，写 4.5 等于偷偷把五档变成九档`)
      }
      if (!missing.length && !extra.length && !illegal.length) {
        const derived = +Object.entries(dims)
          .reduce((s, [d, w]) => s + w * GRADE_SCALE[g[d]], 0).toFixed(4)
        if (Math.abs(a.value - derived) > 1e-4) {
          err('value-not-derived',
            `估值 ${at} 的 value=${a.value}，但按档位与权重算出来是 ${derived} —— `
            + `value 是决策层的产物，不许手写。判断权在 grades，决策权在这个公式，两者不能同时握在一只手里（A3）`)
        } else {
          derivedOk++
        }
      }
    }
  } else if (a.basis === 'asserted' && !GRADE_VALUES.has(a.value)) {
    falsePrecision.push(`${at}=${a.value}`)
  }
}
if (falsePrecision.length) {
  warn('value-false-precision',
    `${falsePrecision.length} 条断言估值的 value 不落在五档刻度 {0, .25, .5, .75, 1} 上：`
    + `${falsePrecision.slice(0, 6).join(' ')}${falsePrecision.length > 6 ? ' …' : ''} —— `
    + `这些数字的小数位是编出来的，模型内部没有 1% 的分辨率。补 dimensions + grades 即可消除`)
}
if (derivedOk) note('value-derived', `${derivedOk} 条估值的 value 由档位与权重确定性算出，判断与决策已分离（A3）`)
// 同一 {事件,受众} 有多条估值是**允许且鼓励**的（A5：旧断言不删，新数据追加），
// 但必须能分辨哪条当前有效——有 measured 就以 measured 为准。
const dupes = {}
for (const a of appraisals) (dupes[`${a.event}|${a.audience}`] ??= []).push(a)
for (const [k, list] of Object.entries(dupes)) {
  if (list.length > 1 && !list.some(x => x.basis === 'measured')) {
    warn('appraisal-ambiguous',
      `${k} 有 ${list.length} 条估值且都不是 measured —— 无法判定哪条当前有效，取的是最后一条`)
  }
}
for (const [aud, s] of Object.entries(byAud)) {
  const pct = (s.asserted / s.n) * 100
  note('assertion-ratio', `受众「${aud}」：${s.asserted}/${s.n}（${pct.toFixed(0)}%）的估值是不可复核的断言`)
  if (pct > 50) {
    warn('assertion-heavy',
      `受众「${aud}」超过一半的估值是断言。这不是 bug，是缺了构成"价值"的另一半——受众反馈。`
      + `拿到真实数据后追加 basis=measured 的估值即可，旧断言不必删`)
  }
}
// 覆盖缺口：哪些事件在哪些受众下没人评过
if (isV2 && audiences.length && spans.length) {
  const missing = []
  for (const a of audiences) {
    const has = new Set(appraisals.filter(x => x.audience === a.id).map(x => x.event))
    const gap = events.filter(e => !has.has(e.id)).map(e => e.id)
    if (gap.length) missing.push(`${a.id} 缺 ${gap.length} 条`)
  }
  if (missing.length) {
    warn('appraisal-gap',
      `估值不完整：${missing.join('；')} —— 没评过不等于不值钱，只等于没人看过（A4）`)
  }
}

// ── 第六问 · 双份账本：真值被复制了吗？（引用优先 ⑤）
for (const { at, e } of spans) {
  for (const k of ['speech', 'transcript', 'subtitle']) {
    if (typeof e[k] === 'string' && e[k].length > 40) {
      warn('duplicated-truth',
        `事件 ${at} 的 ${k} 字段复制了台词原文 —— 真源是素材本身，副本会漂移（双份账本是状态腐坏的头号来源）。` +
        `若确需人读摘要，请改名 gist 并在 limits 里声明为 lossy`)
    }
  }
}

// ── 第七要素 · 边界必须进包
const limits = Array.isArray(doc.limits) ? doc.limits : null
if (!limits || !limits.length) {
  err('no-limits',
    '⚠ 本包未声明任何边界。这不等于它没有边界，只等于没人写下来——请勿据此认为它是无损、完备、已验证的')
} else {
  const seen = new Set()
  limits.forEach((l, i) => {
    const at = l?.code ?? `#${i}`
    if (!l?.code) err('limit-no-code', `边界 ${at} 缺少 code——没有稳定标识就无法在下一版里说「这条已经补上了」`)
    else if (seen.has(l.code)) err('limit-duplicate-code', `边界 code 重复：${l.code}`)
    else seen.add(l.code)
    if (!(l?.kind in LIMIT_KINDS)) err('limit-bad-kind', `边界 ${at} 的 kind=${JSON.stringify(l?.kind)} 不在 ${Object.keys(LIMIT_KINDS).join(' / ')} 内`)
    if (!l?.scope) err('limit-no-scope', `边界 ${at} 缺少 scope——不说清管到哪，下游无法判断自己受不受影响`)
    if (!l?.statement) err('limit-no-statement', `边界 ${at} 缺少 statement`)
    if (!l?.remedy) err('limit-no-remedy', `边界 ${at} 缺少 remedy——边界应当是待办，不是永久借口`)
  })
  note('limits-declared', `声明了 ${limits.length} 条边界`)
}

// ── 投影：pick 必须落在已知世界里
for (const [name, p] of Object.entries(doc.projections ?? {})) {
  const picks = p?.pick
  if (!Array.isArray(picks)) { err('bad-projection', `投影 ${name} 缺少 pick 数组`); continue }
  let total = 0
  picks.forEach((seg, i) => {
    if (!Array.isArray(seg) || seg.length !== 2) { err('bad-pick', `投影 ${name} 第 ${i} 段格式错`); return }
    const [s, x] = seg
    total += x - s
    if (D != null && (s < 0 || x > D + 0.5)) {
      err('pick-out-of-range', `投影 ${name} 第 ${i} 段 [${s},${x}] 超出素材时长 ${D.toFixed(1)}s`)
    }
    // 跨多个相邻事件是合法的，所以按事件并集判覆盖，而不是要求落在单个事件内
    let cur = s
    for (const sp of sorted) {
      if (sp.x <= cur + 0.5) continue
      if (sp.s > cur + 0.5) break        // 并集里出现空洞
      cur = Math.max(cur, sp.x)
      if (cur >= x - 0.5) break
    }
    if (cur < x - 0.5) {
      warn('pick-unbacked',
        `投影 ${name} 第 ${i} 段 [${s},${x}] 中的 [${cur.toFixed(1)},${x}] 未被任何事件描述 —— 在剪一段没人看过的素材`)
    }
  })
  note('projection', `${name}: ${picks.length} 段 / 合计 ${total.toFixed(1)}s`)

  // ── v0.3 · A3 的另一半：决策必须对判断负责
  //
  // 上面把「打分」拆成了 grades（判断）+ 权重（决策）。但整条管线还有第二个决策：
  // **哪几段真的进成片**。v0.2 里它是模型直接写的 pick 数组，旁边一句散文 logic。
  // 于是同一个模型既说"e02 值 0.94"，又说"我不剪它"，两句话之间没有任何东西对得上。
  //
  // 这里不假装剪辑是个算法（它不是）。要求只有一条：
  // **判断层说值钱的东西，决策层扔掉时必须点名。** 缺席不会自己发声（A4）。
  if (p.audience) {
    const threshold = typeof p.threshold === 'number' ? p.threshold : 0.7
    const prose = `${p.dropped ?? ''} ${p.logic ?? ''} ${p.kept ?? ''}`
    const named = id => new RegExp(`(^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`).test(prose)
    const overlapsPick = sp => picks.some(seg =>
      Array.isArray(seg) && seg.length === 2 && seg[0] < sp.x - 0.5 && seg[1] > sp.s + 0.5)

    const silentDrops = [], silentKeeps = []
    for (const sp of sorted) {
      const v = valueFor(sp.e.id, p.audience)
      if (v == null) continue
      const inCut = overlapsPick(sp)
      if (v >= threshold && !inCut && !named(sp.e.id)) silentDrops.push(`${sp.e.id}=${v}`)
      if (v < threshold && inCut && !named(sp.e.id)) silentKeeps.push(`${sp.e.id}=${v}`)
    }
    if (silentDrops.length) {
      err('hi-value-silently-dropped',
        `投影 ${name} 丢弃了 ${silentDrops.length} 个高价值事件却没点名：${silentDrops.join(' ')} —— `
        + `判断层说它们值钱（≥${threshold}），决策层扔了，中间没有一句话对得上。`
        + `剪掉可以，但必须在 dropped 里**点事件 id**、写为什么（A3：决策要对判断负责；A4：缺席不会自己发声）。`
        + `注意：写"275-287s 含糊帧"这种时间码说明**不算数**——`
        + `边界一旦被二遍精读改掉，那句散文会静默过期，而 id 不会。这正是双份账本（引用优先 ⑤）`)
    }
    if (silentKeeps.length) {
      warn('low-value-silently-kept',
        `投影 ${name} 剪进了 ${silentKeeps.length} 个低价值事件却没说明：${silentKeeps.join(' ')} —— `
        + `低于阈值仍然保留通常是对的（承上启下、节奏、交代），但理由要写进 logic，否则下次没人知道它为什么在那儿`)
    }
  } else {
    warn('projection-no-audience',
      `投影 ${name} 没声明 audience —— 不知道它按谁的口径剪的，就没法检查决策有没有对判断负责`)
  }
}

// ── 输出
const errors = out.filter(o => o.severity === 'error')
const warns = out.filter(o => o.severity === 'warn')

if (asJson) {
  console.log(JSON.stringify({
    ok: errors.length === 0,
    file,
    counts: { error: errors.length, warn: warns.length, note: out.length - errors.length - warns.length },
    findings: out,
  }, null, 2))
} else {
  const icon = { error: '✗', warn: '⚠', note: '·' }
  for (const o of out) {
    console.log(`${icon[o.severity]} [${o.code}] ${o.msg}`)
    if (o.gaps) console.log(`    未覆盖区间: ${o.gaps.map(g => `${g[0]}–${g[1]}s`).join(', ')}`)
  }
  console.log('')
  console.log(errors.length === 0
    ? `通过：0 error, ${warns.length} warn`
    : `不通过：${errors.length} error, ${warns.length} warn`)
  console.log('注意：零 error 只等于「已启用的检查都过了」。本校验器查不到的，见包里的 limits 段。')
}

process.exit(errors.length ? 1 : 0)
