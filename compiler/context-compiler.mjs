// 上下文编译器——本象协议的输入侧。
//
// 核心主张：**不把前文全塞进去，而是按当前任务从世界状态里挑出「此刻需要看见的」，并守住预算。**
//
// 与向量 RAG 的分界（ShadowBench-W 二十轮实测，RAG 在状态维度零改善、标准差 0）：
// RAG 检索的是**文本片段**，这里投影的是**当前状态**。「关键物品此刻在谁手上」这种答案
// 不在任何一段原文里——它是一路推演出来的，检索不回来，只能靠状态机维护。
//
// ── 渲染管线（v0.2 起）────────────────────────────────────────────
//
// 旧版把「选取」做成了二值：一个对象要么全字段渲染、要么完全不存在。实测下来
// 这条路两头都是悬崖——在本仓库自己的 project.origin（129 个对象）上：
//
//   有 task：字面匹配只命中 1 个对象，305 字符，**预算用了 5%**，128 个对象隐身
//   无 task：宿主只能退回 renderAll，41991 字符，**预算的 700%**
//
// 中间没有任何档位。修法借自 GPU：预算不是「超了才管」的上限，而是**一定要花完的帧时间**。
// 于是引入三件东西，都只是「投影」这一个既有概念的参数，不新增核心概念：
//
//   相机 camera —— 视点（focus）+ 视野半径（hops）。决定每个对象离任务多远（depth）。
//   细节层次 lod —— depth 决定初始档位：full 全字段 / key 关系与开关 / id 仅可寻址一行。
//   预算斜坡 —— 不足则从近处**升档**把预算花掉，超出则从远处**降档**直到进预算。
//
// 一条硬规矩：**约束、禁区、任务本身不参与降级。** 旧版把它们排在状态之后，
// 一旦上游按预算从尾部硬截，最先被切掉的正是「违反即拒绝」的那几行——
// 等于先扔掉规则再让模型答题。现在它们是先扣掉的固定开销。

/** 字段值指向本世界另一个对象时，这条字段其实是一条关系边——降档时最后才丢。 */
const isRef = (v, ids) => typeof v === 'string' && ids.has(v)

/**
 * 相机投射：给每个对象算一个 depth——离当前任务有多远。
 *
 * 领域无关的三条信号，逐级放宽（不假设「主角」「同地点」这类领域概念）：
 *   depth 0   任务文本里出现了它的 id 或 name，或被宿主 focus 钉住
 *   depth n   与 depth n-1 的对象之间存在一条关系（relations 三元组）
 *   depth ∞   其余全世界——**不再排除**，按最近被改动的时间排序，能塞多少塞多少
 *
 * 最后那一档是这次改动的要点。旧版把未命中的对象整个排除掉，模型连它存在都不知道，
 * 更不可能主动来问；给一行 `id（名）` 的代价是几十个字符，换来的是整个世界可寻址。
 * 排序用 provenance 的改动次序：**最近被事务动过的对象最可能与当下有关**——
 * 这是状态系统能用、而检索系统用不上的信号。
 */
export function castCamera({ origin, task, focus = [], hops = 1 }) {
  const text = [
    task?.goal ?? '',
    JSON.stringify(task?.constraints ?? []),
    JSON.stringify(task?.forbidden_zones ?? []),
  ].join(' ')

  const depth = new Map()
  for (const id of focus) if (origin.ids.has(id)) depth.set(id, 0)
  for (const o of origin.objects) {
    if (!o.id || depth.has(o.id)) continue
    if (text.includes(o.id) || (o.name && text.includes(o.name))) depth.set(o.id, 0)
  }

  for (let d = 0; d < hops; d++) {
    const frontier = [...depth].filter(([, v]) => v === d).map(([k]) => k)
    const near = new Set(frontier)
    for (const r of origin.relations ?? []) {
      if (near.has(r.subject) && r.object && !depth.has(r.object)) depth.set(r.object, d + 1)
      else if (near.has(r.object) && r.subject && !depth.has(r.subject)) depth.set(r.subject, d + 1)
    }
  }

  // 背景层：按 provenance 逆序（最近改动在前）；从未被改动过的排在最后，保持包内原序。
  const touchedAt = new Map()
  ;(origin.history ?? []).forEach((h, i) => { if (h.object) touchedAt.set(h.object, i) })
  const background = [...origin.ids]
    .filter((id) => !depth.has(id))
    .sort((a, b) => (touchedAt.get(b) ?? -1) - (touchedAt.get(a) ?? -1))

  return {
    focused: [...depth].sort((a, b) => a[1] - b[1]).map(([id, d]) => ({ id, depth: d })),
    background,
  }
}

/** 兼容旧签名：只要「选中了哪些」的调用方继续可用。 */
export function selectRelevant({ origin, task, pin = [], hops = 1 }) {
  return castCamera({ origin, task, focus: pin, hops }).focused.map((f) => f.id)
}

const LOD = ['full', 'key', 'id']

/**
 * 把一个对象渲染成给模型看的一行，按档位决定给多少。
 *
 * **实测教训**：字段值一律用完整 ID 呈现。曾为「好读」把命名空间前缀剥掉，
 * 模型照抄了那份人类可读写法，交上来的事务里全是无前缀 ID，被门禁判为未知对象，
 * 5 章全废。给模型看的格式就是它会模仿的格式——**可读性优化必须让位于可回传性**。
 * 降档同理：可以少给字段，但**给出的每一个 ID 都必须是能原样回传的完整 ID**，
 * 所以最低档保留的是 `id（名）` 而不是更省字符的序号。
 */
export function renderObject(id, level, { state, nameOf, ids }) {
  const label = nameOf[id] && nameOf[id] !== id ? `（${nameOf[id]}）` : ''
  if (level === 'id') return `  ${id}${label}`

  const s = state[id] ?? {}
  const bits = []
  for (const [k, val] of Object.entries(s)) {
    if (k === '_type' || val === undefined || val === null) continue
    if (Array.isArray(val)) {
      if (!val.length) continue
      // key 档只留指向其它对象的数组（knows=[char:…] 这类关系集合）
      if (level === 'key' && !val.some((v) => isRef(v, ids))) continue
      bits.push(`${k}=[${val.join(', ')}]`)
    } else if (typeof val === 'object') {
      continue
    } else if (level === 'key') {
      // key 档的取舍：关系边 > 状态开关 > 短标量；长文本一律丢——
      // 它是唯一能从别处重新取回来的东西（对象仍可寻址，宿主可按 ID 再查）。
      const keep = isRef(val, ids) || typeof val === 'boolean' || typeof val === 'number' || String(val).length <= 24
      if (keep) bits.push(`${k}=${val}`)
    } else {
      bits.push(`${k}=${val}`)
    }
  }
  return `  ${id}${label} ${bits.join('；')}`.trimEnd()
}

/**
 * 预算斜坡：在固定预算里，从近处开始把细节买满。
 *
 * 起始档位由 depth 给出（0→full，1→key，≥2→id），然后两个方向都走：
 *   超预算 → 从最远的对象开始降档（id 档已是底，再降就只能整个丢，并如实记进 dropped）
 *   有余量 → 从最近的对象开始升档，直到再升一档就会超——**把预算花掉**
 *
 * 不用二分或线性规划：档位只有三级、对象数量级在千位以内，逐步逼近足够快，
 * 且过程可解释——每个对象最终是什么档、为什么，都能在 lod 字段里查到。
 */
function fitBudget({ items, room, render, slope = true }) {
  const level = new Map(items.map((it) => [it.id, LOD[Math.min(it.depth, LOD.length - 1)]]))
  const cost = (id) => render(id, level.get(id)).length + 1
  const dropped = []

  let total = items.reduce((n, it) => n + cost(it.id), 0)

  // slope:false —— 每个对象停在 depth 给的档位，既不降也不升，装不下就如实溢出。
  // 这是给**已在产出数据的调用方**留的退路：投影一变，历史成绩就不可比（见
  // arms/a3-benxiang 的合同）。注意不能改用「预算给到无穷大」来实现同一效果——
  // 那会连带关掉 recentText 的截断，把 29 万字的语料尾巴整个灌进提示词。
  if (!slope) return { level, dropped, total }

  // 降档：从最远的开始
  for (let i = items.length - 1; i >= 0 && total > room; i--) {
    const { id } = items[i]
    while (total > room) {
      const cur = LOD.indexOf(level.get(id))
      if (cur >= LOD.length - 1) break
      const before = cost(id)
      level.set(id, LOD[cur + 1])
      total -= before - cost(id)
    }
  }
  // 还超：只能整块丢，但要留下账——不能让「没给模型看」这件事无声发生
  for (let i = items.length - 1; i >= 0 && total > room; i--) {
    const { id } = items[i]
    total -= cost(id)
    level.delete(id)
    dropped.push(id)
  }

  // 升档：从最近的开始，把剩余预算花掉
  let moved = true
  while (moved && total < room) {
    moved = false
    for (const { id } of items) {
      if (!level.has(id)) continue
      const cur = LOD.indexOf(level.get(id))
      if (cur <= 0) continue
      const before = cost(id)
      level.set(id, LOD[cur - 1])
      const delta = cost(id) - before
      if (total + delta > room) { level.set(id, LOD[cur] ); continue }
      total += delta
      moved = true
    }
  }

  return { level, dropped, total }
}

/** 缺省的不可降级段：任务行 + 约束 + 禁区。方言可用 project.fixed 整个换掉。 */
function defaultFixed({ origin, task }) {
  const head = []
  if (task?.goal) head.push(`【任务】${task.goal}`)

  const tail = []
  const enforceable = (origin.constraints ?? []).filter((c) => c.check)
  const advisory = (origin.constraints ?? []).filter((c) => !c.check)
  if (enforceable.length) {
    tail.push('\n【约束·机器校验，违反即拒绝】')
    for (const c of enforceable) tail.push(`  - ${c.rule ?? c.id}`)
  }
  if (advisory.length) {
    tail.push('\n【约束·人工复核】')
    for (const c of advisory) tail.push(`  - ${c.rule ?? c.id}`)
  }
  if (task?.forbidden_zones?.length) {
    tail.push('\n【禁区·越界即判失败】')
    for (const fz of task.forbidden_zones) tail.push(`  - ${fz.rule ?? fz.id}`)
  }
  return { head, tail, banner: '\n【相关对象·当前状态】（字段值请原样照抄，含 ID 前缀）' }
}

/**
 * 编译上下文。
 *
 * @param budget   字符预算。**目标值，不是上限**——不足会升档补满，超出会降档压回。
 * @param camera   { focus, hops }。旧的 pin / hops 仍受理，等价于 camera.focus / camera.hops。
 * @param background 背景层最多列出多少个仅可寻址的对象；0 关闭（回到旧版只给命中对象的行为）。
 * @param project  **方言着色器**。四个槽全部可选，缺省即当前的领域无关行为：
 *
 *   cast({ origin, task, state, focus, hops })  → { focused:[{id,depth}], background:[id] }
 *       谁进画面、离任务多远。领域概念（主角、同地点、持有者…）在这里表达。
 *   render(id, level, { origin, task, state, nameOf, ids })  → string
 *       **着色器本体**：这个对象在这一档给几个字段、怎么排。返回 '' 表示该档不显示。
 *   group(id, { origin, state })  → string | null
 *       分段标题（人物 / 物品 / 地点…）。同标题的连续对象共用一个抬头。
 *   fixed({ origin, task, state })  → { head:[], tail:[], banner:'' }
 *       不可降级段。世界规则、未回收伏笔这类「少一条就判错」的东西放这里。
 *
 * ── 为什么现在值得加这个钩子（对 arms/a3-benxiang 那条注释的正式答复）──
 *
 * A3 臂当初拒绝合并，理由记得很清楚：**「共享的只剩预算算术那三行」**，
 * 为消灭重复而造抽象不划算。那个判断在当时是对的——彼时预算逻辑确实只有
 * `room = max(0, budget - len)` 加一个 slice。
 *
 * 现在不成立了。预算侧已经长成：相机 depth 分级、三档 LOD 阶梯、超预算由远及近降档、
 * 有余量由近及远升档、装不下时显式记账、以及全文长度收敛回环——六十行，且每一行都是
 * 领域无关的。A3 臂一行都没有：它至今仍是「选中就全渲染，超了截正文尾巴」。
 *
 * 所以合并的理由从「消除重复」换成了「**方言拿不到预算纪律**」。
 * 分界也随之清楚：**投影归方言，预算归核心。** 各写各的仍然成立——
 * 各写各的是 render，不是各自再发明一遍怎么花预算。
 */
export function compileContext({
  origin, task, state = origin.state,
  pin = [], hops = 1, camera = {},
  budget = 6000, recentText = '', background = 200,
  project = {}, slope = true,
}) {
  const focus = camera.focus ?? pin
  const radius = camera.hops ?? hops
  const nameOf = Object.fromEntries(origin.objects.map((o) => [o.id, o.name ?? o.title ?? o.id]))
  const ids = origin.ids
  const shaderCtx = { origin, task, state, nameOf, ids }

  const cast = project.cast ?? castCamera
  const paint = project.render ?? renderObject
  const group = project.group ?? null

  const cam = cast({ origin, task, state, focus, hops: radius })

  // ① 不可降级的固定开销：任务、约束、禁区（方言可整体替换）。先扣，再拿剩下的买细节。
  const { head, tail, banner, recentBanner } = (project.fixed ?? defaultFixed)({ origin, task, state })
  const recentLabel = recentBanner ?? '\n【最近内容（节选）】'

  // ② 背景层参与投射，但起始就在 id 档（depth 设为 LOD 末档）
  const items = [
    ...cam.focused,
    ...(cam.background ?? []).slice(0, background).map((id) => ({ id, depth: LOD.length - 1 })),
  ]

  const render = (id, lv) => paint(id, lv, shaderCtx)

  // ③ 拼装：状态在前，规则在后，最近正文吃剩下的
  const assemble = ({ level, dropped }) => {
    const lines = [...head]
    if (banner) lines.push(banner)
    const rendered = []
    let lastGroup = null
    for (const { id } of items) {
      if (!level.has(id)) continue
      if (group) {
        const g = group(id, shaderCtx)
        if (g && g !== lastGroup) { lines.push(g); lastGroup = g }
      }
      const line = render(id, level.get(id))
      if (line) lines.push(line)
      rendered.push(id)
    }
    if (dropped.length) lines.push(`  …另有 ${dropped.length} 个对象未列出（预算不足，可按 ID 单独查询）`)
    lines.push(...tail)
    if (recentText) {
      // slope:true 才把抬头本身算进预算。旧实现只减正文长度、不减 `\n【最近内容（节选）】\n`
      // 这十几个字符，于是稳定溢出预算约 13 字符（stub 实测 utilization 1.002）。
      // 这个偏差不能顺手在 slope:false 上一并修——那条路径的合同是与旧实现**逐字节相同**，
      // 修掉就等于改了提示词，results-log 里的历史成绩随之不可比。
      // 于是这里出现一个刻意的不对称：**新路径守预算，旧路径守字节。**
      const overhead = slope ? recentLabel.length + 1 : 0
      const left = Math.max(0, budget - lines.join('\n').length - overhead)
      if (left > 0) lines.push(recentLabel + '\n' + recentText.slice(-left))
    }
    return { body: lines.join('\n'), rendered }
  }

  // 预算收敛：fitBudget 只管对象那一段，但真正受预算约束的是**拼装后的全文**——
  // 抬头、分段标题、分隔换行、`dropped` 那行提示都不在它的账里，而分段标题出现几个
  // 本身又取决于哪些对象活下来（循环依赖，没法先算）。与其在两处各维护一份长度算术
  // （改一处忘一处，且悄悄超预算最难发现），不如实测全文长度、把超出的部分从 room 里
  // 扣掉再拟合一次。四轮之内必收敛：每轮 room 单调下降，档位阶梯有限。
  let room = Math.max(0, budget - [...head, banner ?? '', ...tail].join('\n').length - (recentText ? 120 : 0))
  let fit = fitBudget({ items, room, render, slope })
  let out = assemble(fit)
  for (let i = 0; i < 4 && out.body.length > budget; i++) {
    room = Math.max(0, room - (out.body.length - budget))
    fit = fitBudget({ items, room, render, slope })
    out = assemble(fit)
  }
  const { level, dropped } = fit
  const { body, rendered } = out
  const byLevel = { full: [], key: [], id: [] }
  for (const [id, lv] of level) byLevel[lv].push(id)

  // 帧句柄：把「这一帧每个对象长什么样」留下来，下一帧才有的可差分。
  // 只存渲染后的行，不存状态快照——差分要比的就是**给模型看的那一行**变没变，
  // 状态变了但那一档没显示出来（比如长文本字段在 key 档本来就被丢掉）不该触发重发。
  const lines = {}
  for (const { id } of items) if (level.has(id)) lines[id] = render(id, level.get(id))

  return {
    text: body,
    selected: rendered,
    // 帧元数据：这一帧看见了什么、以什么精度看见、什么没看见。
    // 「没看见」必须显式可查——静默丢弃是上下文编译器最容易犯、也最难查的错。
    lod: Object.fromEntries(level),
    byLevel,
    dropped,
    depthOf: Object.fromEntries(cam.focused.map((f) => [f.id, f.depth])),
    estChars: body.length,
    budget,
    utilization: +(body.length / budget).toFixed(3),
    overBudget: body.length > budget,
    frame: { id: hashOf(body), seq: (origin.history ?? []).length, lines, tail },
  }
}

/** 帧标识：内容哈希。同样的世界 + 同样的任务 + 同样的预算 → 同一个 id。 */
function hashOf(s) {
  // FNV-1a 32 位。这里只需要「内容变没变」的廉价指纹，不是抗碰撞摘要；
  // 不引 node:crypto 是为了让本文件在浏览器/边缘运行时也能原样跑（参考实现零依赖）。
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * 差分帧：只发自上一帧起真正变了的部分。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────
 * 实测（project.origin，129 对象，预算 6000）：每轮重编都发满 ~5990 字符，
 * 而两轮之间真正改动的只有 3–5 个对象。与上一轮的公共前缀从 8.9% 一路衰减到 1.3%——
 * 因为背景层按「最近改动」排序，而新近度每轮都在变，整张对象表跟着重排。
 * **相关性排序与前缀稳定性直接冲突。** GPU 没这个矛盾（它没有前缀缓存），
 * 但视频编解码有，解法也早有定论：关键帧 + 预测帧。
 *
 * ── 三条安全规则（都不是可选项）──────────────────────────────────
 * ① **规则永远重发。** 差分里也原样带上约束与禁区。它们只要 275 字符，而一旦基帧
 *    被上下文压缩挤掉、差分又没带规则，模型就在没有护栏的情况下作答——正是本仓库
 *    修过的那个缺陷（约束排在末尾被截尾切光）的翻版。便宜的保险，不省。
 * ② **差分不小于关键帧就发关键帧。** 优化不许把事情变坏。
 * ③ **base 帧 id 随帧带出。** 编译器无从得知调用方是否还留着基帧（上下文可能被压缩过），
 *    所以不替它判断：`since` 是调用方的断言，编译器只负责把 base id 如实标出，
 *    对不上时调用方能立刻发现，而不是拿着一份「相对于某个已经不存在的东西」的差分。
 */
export function compileDelta({ since, ...opts }) {
  const next = compileContext(opts)
  if (!since?.lines) return { ...next, kind: 'key', base: null }

  const prev = since.lines
  const cur = next.frame.lines
  const changed = [], added = [], removed = []
  for (const [id, line] of Object.entries(cur)) {
    if (!(id in prev)) added.push(line)
    else if (prev[id] !== line) changed.push(line)
  }
  for (const id of Object.keys(prev)) if (!(id in cur)) removed.push(id)

  const parts = [`【状态差分】基于帧 ${since.id}（其余对象与上一帧相同，无需重读）`]
  if (changed.length) { parts.push('\n· 已变更'); parts.push(...changed) }
  if (added.length) { parts.push('\n· 新进入视野'); parts.push(...added) }
  if (removed.length) parts.push(`\n· 已移出视野（预算或相关性）：${removed.join('、')}`)
  if (!changed.length && !added.length && !removed.length) parts.push('  （无变化）')
  // 规则原样重发——见上面规则 ①
  parts.push(...(next.frame.tail ?? []))

  const text = parts.join('\n')
  // 规则 ②：差分没占到便宜就退回关键帧，别为了「用上了差分」而发更长的东西
  if (text.length >= next.text.length) return { ...next, kind: 'key', base: since.id, deltaRejected: true }

  return {
    ...next,
    kind: 'delta',
    base: since.id,
    text,
    estChars: text.length,
    utilization: +(text.length / opts.budget ?? 6000).toFixed(3),
    overBudget: false,
    delta: { changed: changed.length, added: added.length, removed: removed.length, savedChars: next.text.length - text.length },
  }
}

/** 附上输出契约。模型只有知道要交什么形状的事务，才可能交对。 */
export function buildPrompt(ctx, { extra = '' } = {}) {
  return `${ctx.text}

【输出格式】只输出一个 JSON 对象，不要有其他文字：
{
  "transaction_id": "tx-<序号>",
  "operation": "<语义操作名>",
  "target": "<目标对象 ID>",
  "state_changes": [ { "object": "对象ID", "field": "字段", "from": 变更前值, "to": 变更后值 } ],
  "assertions": ["<你声明未违反的边界>"]
}
state_changes 只写本次真实发生的状态变化。
object 与取值必须原样使用上文给出的完整 ID，不可省略前缀。
from 应与上文所给当前状态一致；不确定就不要写这条变更。
assertions 将由校验器逐条复核——写了做不到会被判失败。${extra ? '\n' + extra : ''}`
}
