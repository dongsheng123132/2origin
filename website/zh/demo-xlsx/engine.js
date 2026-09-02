/*
 * 本象 xlsx 方言——浏览器端重实现（纯 JS，无依赖，无 import）。
 *
 * 对应 Node 原件：
 *   compiler/origin.mjs       stateFromObjects / loadOrigin（objects 折初始态，history 重放成当前态）
 *   compiler/provenance.mjs   replay / stateChanges / diagnose
 *   compiler/constraints.mjs  matchIds / PREDICATES / checkConstraints
 *   adapters/xlsx/trace.mjs   toId / trace / render / leaves
 *   adapters/xlsx/project.mjs staleCells
 *
 * Node 版依赖 node:fs / node:zlib 读包，无法直接搬进浏览器，所以这里按同样语义重写。
 * 判据的口径以 Node 输出为准：本文件的 diagnoseText() 产出与 `origin diagnose` 完全相同的文本，
 * 页面会拿它和案例包 projections/diagnose.txt 逐行比对——不一致即视为本实现有错。
 *
 * 未移植：findMirrorPairs（双份账本探测）与聚合谓词 unique / count / unchanged——
 * 本案例包的约束只用到 in / not_equals，这些分支在本包上不会被触发；遇到未知谓词会像 Node 一样
 * 报 unknown-predicate 警告而不是静默跳过。
 */
(function (root) {
  'use strict'

  // ── 状态：objects 是出生证明，history 才是变化 ───────────────────────────
  function stateFromObjects(objects) {
    const state = {}
    for (const o of objects) {
      const { id, type, ...fields } = o
      if (!id) continue
      state[id] = { ...fields }
      if (type) state[id]._type = type
    }
    return state
  }

  function stateChanges(history) {
    return (history || []).filter((e) => e && e.event === 'state_change')
  }

  function replay(base, history) {
    const state = {}
    for (const id of Object.keys(base)) state[id] = { ...base[id] }
    for (const r of stateChanges(history)) {
      if (!state[r.object]) state[r.object] = {}
      if (r.op === 'delete') delete state[r.object][r.field]
      else state[r.object][r.field] = r.to
    }
    return state
  }

  function loadOrigin(data) {
    const initial = stateFromObjects(data.objects)
    return {
      objects: data.objects,
      relations: data.relations,
      constraints: data.constraints,
      limits: data.limits,
      history: data.history,
      initial,
      state: replay(initial, data.history),
      ids: new Set(Object.keys(initial)),
    }
  }

  // ── 约束谓词（compiler/constraints.mjs） ─────────────────────────────────
  const get = (state, object, field) => (state && state[object] ? state[object][field] : undefined)
  const J = (v) => JSON.stringify(v)

  const PREDICATES = {
    equals: (state, c) => {
      const got = get(state, c.object, c.field)
      return J(got) === J(c.value) ? null : `${c.object}.${c.field} 应为 ${J(c.value)}，实为 ${J(got)}`
    },
    not_equals: (state, c) => {
      const got = get(state, c.object, c.field)
      return J(got) !== J(c.value) ? null : `${c.object}.${c.field} 不得为 ${J(c.value)}`
    },
    not_contains: (state, c) => {
      const arr = get(state, c.object, c.field)
      if (!Array.isArray(arr)) return null
      return arr.includes(c.value) ? `${c.object}.${c.field} 不得包含 ${J(c.value)}` : null
    },
    contains: (state, c) => {
      const arr = get(state, c.object, c.field)
      return Array.isArray(arr) && arr.includes(c.value) ? null : `${c.object}.${c.field} 必须包含 ${J(c.value)}`
    },
    range: (state, c) => {
      const got = get(state, c.object, c.field)
      if (typeof got !== 'number') return null
      if (c.min !== undefined && got < c.min) return `${c.object}.${c.field} = ${got}，低于下限 ${c.min}`
      if (c.max !== undefined && got > c.max) return `${c.object}.${c.field} = ${got}，高于上限 ${c.max}`
      return null
    },
    in: (state, c) => {
      const got = get(state, c.object, c.field)
      if (got === undefined) return null // 缺失不判——「没写」与「写错」必须分开
      const set = c.values || []
      return set.some((v) => J(v) === J(got)) ? null : `${c.object}.${c.field} = ${J(got)}，不在允许取值 ${J(set)} 内`
    },
    exists: (state, c) => {
      const got = get(state, c.object, c.field)
      const empty = got === undefined || got === null || got === '' || (Array.isArray(got) && got.length === 0)
      return empty ? `${c.object}.${c.field} 必填，当前为空` : null
    },
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  function matchIds(state, pattern) {
    if (typeof pattern !== 'string') return []
    if (!pattern.includes('*')) return state[pattern] ? [pattern] : []
    const re = new RegExp('^' + pattern.split('*').map(escapeRe).join('.*') + '$')
    return Object.keys(state).filter((id) => re.test(id))
  }

  function expand(check, state) {
    if (typeof (check && check.object) !== 'string' || !check.object.includes('*')) return [check]
    return matchIds(state, check.object).map((id) => ({ ...check, object: id }))
  }

  function checkConstraints(stateAfter, constraints, stateBefore) {
    const out = []
    for (const c of constraints || []) {
      const check = c.check
      if (!check) {
        out.push({ id: c.id || c.rule, severity: 'warning', code: 'unenforceable', msg: `约束「${c.rule || c.id}」无机器判定，未校验` })
        continue
      }
      const pred = PREDICATES[check.type]
      if (!pred) {
        out.push({ id: c.id || c.rule, severity: 'warning', code: 'unknown-predicate', msg: `未知谓词 ${check.type}` })
        continue
      }
      for (const one of expand(check, stateAfter)) {
        const msg = pred(stateAfter, one, stateBefore || {})
        if (msg) out.push({
          id: c.id || c.rule, severity: c.severity || 'error', code: 'constraint',
          msg: `${c.rule ? c.rule + '｜' : ''}${msg}`,
          object: one.object, field: one.field,
        })
      }
    }
    return out
  }

  // ── 体检（compiler/provenance.mjs diagnose） ────────────────────────────
  function diagnose(origin) {
    const findings = []
    const initial = origin.initial || origin.state || {}
    const state = replay(initial, origin.history || [])
    const ids = origin.ids || new Set(Object.keys(state))

    for (const v of checkConstraints(state, origin.constraints || [], initial))
      findings.push({ code: v.code, severity: v.severity || 'error', msg: v.msg, object: v.object, field: v.field, rule: v.id })

    for (const r of origin.relations || []) {
      for (const end of ['subject', 'object']) {
        const id = r[end]
        if (id && !ids.has(id))
          findings.push({
            code: 'dangling-relation', severity: 'warning',
            msg: `关系 ${r.subject} ${r.predicate} ${r.object} 的 ${end} 「${id}」不在本包对象表中（跨包引用？）`,
            object: r.subject,
          })
      }
    }

    for (const r of stateChanges(origin.history || []))
      if (!ids.has(r.object))
        findings.push({ code: 'dangling-history', severity: 'warning', msg: `history seq=${r.seq} 改动了不存在的对象 ${r.object}` })

    // findMirrorPairs 未移植（见文件头）。

    const changes = stateChanges(origin.history || [])
    const drift = changes.filter((r) => 'claimed_from' in r).length
    if (changes.length)
      findings.push({
        code: 'drift-rate', severity: drift ? 'warning' : 'info',
        msg: `模型前值声明偏差 ${drift}/${changes.length}（${((drift / changes.length) * 100).toFixed(1)}%）`,
      })

    const enforceable = (origin.constraints || []).filter((c) => c.check).length
    const total = (origin.constraints || []).length
    if (total && enforceable < total)
      findings.push({ code: 'unenforceable-ratio', severity: 'warning', msg: `${total} 条约束中只有 ${enforceable} 条可机器判定，其余 ${total - enforceable} 条无人守` })

    return {
      ok: !findings.some((f) => f.severity === 'error'),
      objects: ids.size,
      relations: (origin.relations || []).length,
      constraints: { total, enforceable },
      changes: changes.length,
      findings,
    }
  }

  /** 与 `origin diagnose` 的 stdout 逐字一致（compiler/cli.mjs diagnose 分支的打印格式）。 */
  function diagnoseText(d) {
    const lines = [`对象 ${d.objects}｜关系 ${d.relations}｜约束 ${d.constraints.enforceable}/${d.constraints.total} 可判定｜变更 ${d.changes}`]
    for (const f of d.findings) lines.push(`${f.severity}\t${f.code}\t${f.msg}`)
    const errors = d.findings.filter((f) => f.severity === 'error').length
    lines.push(errors ? `✗ ${errors} 个 error 级问题` : '✓ 无 error 级问题')
    return lines.join('\n') + '\n'
  }

  // ── 依赖追踪（adapters/xlsx/trace.mjs） ─────────────────────────────────
  function toId(ref) {
    if (ref.startsWith('cell:') || ref.startsWith('header:')) return ref
    const m = /^(?:(.+)!)?([A-Z]{1,3})(\d+)$/.exec(ref)
    if (!m) return null
    return `cell:${m[1] == null ? '' : m[1]}!${m[2]}/${m[3]}`
  }

  const short = (id) => id.replace(/^cell:/, '').replace(/!([A-Z]{1,3})\/(\d+)$/, '!$1$2')

  function depsIndex(relations) {
    const deps = new Map()
    for (const r of relations || []) {
      if (r.predicate !== 'depends_on') continue
      if (!deps.has(r.subject)) deps.set(r.subject, [])
      deps.get(r.subject).push(r.object)
    }
    return deps
  }

  function trace(origin, rootId, opts) {
    const depth = (opts && opts.depth) || 6
    const state = origin.state
    const deps = depsIndex(origin.relations)
    const walk = (id, level, seen) => {
      const cell = state[id]
      const node = {
        id, ref: short(id),
        value: cell && cell.value !== undefined ? cell.value : null,
        formula: cell && cell.formula !== undefined ? cell.formula : null,
        kind: cell ? cell.kind : 'missing',
        children: [],
      }
      if (!cell) { node.note = '不在本包中（跨包引用或超出 --max-cells）'; return node }
      if (seen.has(id)) { node.note = '循环引用，到此为止'; return node }
      if (level >= depth) { node.note = `深度超过 ${depth}，未继续展开`; return node }
      const next = new Set(deps.get(id) || [])
      const nextSeen = new Set(seen); nextSeen.add(id)
      for (const child of next) node.children.push(walk(child, level + 1, nextSeen))
      return node
    }
    return walk(rootId, 0, new Set())
  }

  function render(node, prefix, last, top) {
    if (prefix === undefined) prefix = ''
    if (last === undefined) last = true
    if (top === undefined) top = true
    const head = top ? '' : prefix + (last ? '└ ' : '├ ')
    const val = node.value === null ? '（空）' : J(node.value)
    const basis = node.formula ? `  ← =${node.formula}`
      : node.kind === 'input' ? '  （人工录入）'
      : node.kind === 'text' ? '  （文字）'
      : ''
    const note = node.note ? `  ⚠ ${node.note}` : ''
    let out = `${head}${node.ref} = ${val}${basis}${note}\n`
    const childPrefix = top ? '' : prefix + (last ? '   ' : '│  ')
    node.children.forEach((c, i) => { out += render(c, childPrefix, i === node.children.length - 1, false) })
    return out
  }

  function leaves(node, acc) {
    if (!acc) acc = []
    if (!node.children.length && node.kind === 'input') acc.push(node)
    for (const c of node.children) leaves(c, acc)
    return acc
  }

  /** 与 trace.mjs CLI 的 stdout+stderr 拼起来一致（案例包 trace-汇总-B3.txt 就是这么存的）。 */
  function traceText(tree) {
    const src = leaves(tree)
    return render(tree) + `\n这个数最终由 ${src.length} 个人工录入的格子决定：${src.map((n) => n.ref).join('、') || '（无——全是常量或跨包）'}\n`
  }

  // ── 过期传播（adapters/xlsx/project.mjs staleCells） ───────────────────
  // Node 版从 history 里取被改过的对象；这里多开一个口子让页面传入「假设改了哪些格」，
  // 传播算法本身逐字对应：沿 depends_on 反向 BFS，只收 kind === 'formula' 的格子，结果排序。
  function staleCells(origin, changedIds) {
    const changed = new Set(changedIds !== undefined ? changedIds
      : stateChanges(origin.history).filter((e) => e.field === 'value').map((e) => e.object))
    if (!changed.size) return []
    const dependents = new Map()
    for (const r of origin.relations || []) {
      if (r.predicate !== 'depends_on') continue
      if (!dependents.has(r.object)) dependents.set(r.object, [])
      dependents.get(r.object).push(r.subject)
    }
    const stale = new Set()
    const queue = [...changed]
    const seen = new Set(changed)
    while (queue.length) {
      for (const up of dependents.get(queue.shift()) || []) {
        if (seen.has(up)) continue
        seen.add(up)
        if (origin.state && origin.state[up] && origin.state[up].kind === 'formula') stale.add(up)
        queue.push(up)
      }
    }
    return [...stale].sort()
  }

  const api = {
    stateFromObjects, stateChanges, replay, loadOrigin,
    matchIds, checkConstraints, diagnose, diagnoseText,
    toId, short, trace, render, leaves, traceText,
    staleCells,
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  root.XlsxDemoEngine = api
})(typeof globalThis !== 'undefined' ? globalThis : this)
