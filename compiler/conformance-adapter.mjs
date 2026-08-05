#!/usr/bin/env node
// 一致性适配器（参考实现）——把本象协议的一致性测试向量喂进这份 JS 实现。
//
// **这个文件是给别人抄的。** 换成 Python / Rust / Go 写一份本象实现时，照着这里
// 实现同一个 stdin/stdout 契约，就能跑同一套向量自证合规：
//
//   stdin  ← {"version":1,"cases":[{"id":"…","op":"…","input":{…}},…]}
//   stdout → {"results":[{"id":"…","output":{…}},…]}
//
// 全文不到 80 行，且没有一行是「为了通过测试」写的——每个 op 都直接转调公开 API。
// 若某个 op 你的实现暂时没有，回 {"id":"…","unsupported":true}，如实报告即可；
// 运行器会把它算作**未通过**，不会让你靠沉默混过去。
//
// 契约细节见 spec/conformance/README.md。

import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateTransaction, applyTransaction, normalizeTransaction, fold } from './commit-compiler.mjs'
import { checkConstraints } from './constraints.mjs'
import { stateFromObjects, loadOrigin } from './origin.mjs'
import { replay } from './provenance.mjs'
import { commit, initPackage, seqOf, appendHistory } from './store.mjs'
import { checkLimits, relevantLimits, renderLimits } from './limits.mjs'
import { planProjection, disclosure } from './project.mjs'

/**
 * 断言在协议里是**宿主登记的谓词**，跨语言传不了函数。
 * 所以向量把断言写成「名字 → 约束判定」的数据，由各实现自己搭成谓词——
 * 考的是「未登记的断言降级为警告、登记的断言不成立则拒绝」这套机制，
 * 而不是某个具体断言的内容。
 */
const buildAssertions = (decl = {}) =>
  Object.fromEntries(Object.entries(decl).map(([name, check]) => [name, (state) => checkConstraints(state, [{ id: name, check }]).length === 0]))

const codes = (violations, wantWarning) =>
  violations.filter((v) => (wantWarning ? v.severity === 'warning' : v.severity !== 'warning')).map((v) => v.code).sort()

const OPS = {
  // 归一化：补回命名空间前缀。
  // changeKeys 额外报出每条变更**实际带有哪些键**——因为 JSON 序列化会把
  // `{from: undefined}` 和「压根没有 from」抹成同一个 `{}`，而这两者在协议里
  // 天差地别（前者会触发一条本不该有的前值检查）。不报键名就测不出这个差别。
  normalize: ({ ids = [], transaction }) => {
    const tx = normalizeTransaction(transaction, new Set(ids))
    return { transaction: tx, changeKeys: (tx?.state_changes ?? []).map((c) => Object.keys(c).sort()) }
  },

  // 校验：协议的核心判定
  validate: ({ state = {}, constraints = [], assertions = {}, transaction }) => {
    const r = validateTransaction({ tx: transaction, stateBefore: state, constraints, assertions: buildAssertions(assertions) })
    return { ok: r.ok, codes: codes(r.violations, false), warnings: codes(r.violations, true) }
  },

  // 约束谓词单测：与事务无关，直接判一个状态
  constraints: ({ state = {}, stateBefore = {}, constraints = [] }) => {
    const v = checkConstraints(state, constraints, stateBefore)
    return { codes: codes(v, false), warnings: codes(v, true), ids: v.filter((x) => x.severity !== 'warning').map((x) => x.id).sort() }
  },

  // 折叠：状态变更如何落进状态
  fold: ({ state = {}, changes = [] }) => ({ state: fold(state, changes) }),

  // 落地：状态 + append-only 日志
  apply: ({ state = {}, transaction, by = 'conformance', at = null, history = [] }) => {
    const r = applyTransaction({ tx: transaction, state, history, by, at })
    return { state: r.state, journal: r.journal }
  },

  // 重放：当前状态由出生状态折叠全部历史得出
  replay: ({ objects = [], history = [], until = null }) => ({ state: replay(stateFromObjects(objects), history, { until }) }),

  // 边界（第七要素）：这份表示保证不了什么。
  // 考三件事：声明本身合不合格、按范围取子集、**空清单也必须出话**。
  // 最后一条是语言中立的——不断言中文原文，只断言「渲染结果非空」，
  // 因为「没有边界声明」与「不声明边界」是两回事，实现不许用空串把它们混为一谈。
  limits: ({ limits = [], scope = null }) => {
    const v = checkLimits(limits)
    const picked = relevantLimits(limits, scope)
    return {
      codes: codes(v, false), warnings: codes(v, true),
      picked: picked.map((l) => l.code).sort(),
      renderedNonEmpty: renderLimits(picked).trim().length > 0,
      renderedEmptyListNonEmpty: renderLimits([]).trim().length > 0,
    }
  },

  // 投影：一源万影的「影」这一侧。
  // 核心承诺是**披露**：投影天然有损，有损不是问题，假装无损才是。
  // 所以考的是「该出现在丢弃清单里的东西一条都不能少」，以及 plan 必须只读。
  project: ({ objects = [], relations = [], history = [], select = ['*'], carries = null, format = 'test' }) => {
    const origin = { state: stateFromObjects(objects), relations, history }
    const before = JSON.stringify(origin.state)
    const plan = planProjection(origin, { id: 'conf', format, select, carries })
    return {
      selected: plan.selected.sort(),
      droppedCodes: plan.dropped.map((d) => d.code).sort(),
      lossless: plan.lossless,
      // 借 USD 的立场：投影是在本源之上叠一层，本源始终不动
      sourceUntouched: JSON.stringify(origin.state) === before,
      disclosureNonEmpty: disclosure(plan).trim().length > 0,
    }
  },

  // ── 以下属 full 级：包格式与持久化。只做内存语义的实现可如实回 unsupported ──

  // 装载：把一个磁盘上的本象包读成状态。测的是「objects 是出生证明、history 是履历」
  // 这条规矩在**落盘层面**也成立——直接把当前值写回 objects 的实现会在这里露馅。
  load: (input) => withPackage(input, (dir) => {
    const o = loadOrigin(dir)
    return { state: o.state, ids: [...o.ids].sort(), seq: seqOf(dir) }
  }),

  // 提交：校验 + 落盘 + 水位冲突检测。三条硬规矩都在这一个 op 里可验：
  // 只追加不覆写、不通过零字节写入、水位对不上则拒绝（首个写者胜）。
  commit: (input) => withPackage(input, (dir) => {
    const before = readFileSync(join(dir, 'graph', 'objects.jsonl'), 'utf8')
    const r = commit(dir, input.transaction, {
      by: input.by ?? 'conformance',
      at: input.at ?? null,
      expectedSeq: input.expectSeq ?? null,
      assertions: buildAssertions(input.assertions),
    })
    return {
      ok: r.ok,
      codes: (r.violations ?? []).filter((v) => v.severity !== 'warning').map((v) => v.code).sort(),
      seq: seqOf(dir),
      state: loadOrigin(dir).state,
      // 出生证明必须一字未动——当前状态是重放出来的，不是写回去的
      objectsUntouched: readFileSync(join(dir, 'graph', 'objects.jsonl'), 'utf8') === before,
    }
  }),
}

/** 按向量给的内容起一个真实的本象包，跑完即删。持久化语义只有落到真盘上才算数。 */
function withPackage({ objects = [], constraints = [], history = [] }, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'benxiang-conf-'))
  try {
    initPackage(dir, { objects, constraints })
    if (history.length) appendHistory(dir, history)
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── 驱动 ────────────────────────────────────────────────────────────────
let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => (buf += d))
process.stdin.on('end', () => {
  let req
  try {
    req = JSON.parse(buf)
  } catch (e) {
    process.stderr.write(`适配器：stdin 不是合法 JSON — ${e.message}\n`)
    process.exit(2)
  }
  const results = (req.cases ?? []).map(({ id, op, input }) => {
    const fn = OPS[op]
    if (!fn) return { id, unsupported: true }
    try {
      return { id, output: fn(input ?? {}) }
    } catch (e) {
      return { id, error: `${e.constructor.name}: ${e.message}` }
    }
  })
  process.stdout.write(JSON.stringify({ results }))
})
