#!/usr/bin/env node
// 这个数凭什么是这个数——顺着依赖链往下追到人工录入的源头。
//
//   node adapters/xlsx/trace.mjs <包路径> <预算!D7> [--depth 6] [--json]
//
// ## 为什么这个投影写在方言里，而不是加进核心的 why
//
// 核心的 `origin why` 走的是**历史链**：这个字段被谁、在什么时候、依据什么改过。
// 电子表格要问的是另一条链：**依赖链**——D7 等于 270，是因为它是 D2..D6 的和，
// 而 D2 又是 B2 减 C2。两条链都真实存在，但不是同一件事。
//
// 按 decision:projector-per-domain：协议统一的是事务与校验（输出侧），
// 不是每个域该给模型看什么（输入侧）。所以依赖链的**数据**用协议自带的
// relations 存（谁依赖谁，六要素之一，没有新增任何东西），
// 而把它渲染成人和 AI 读得懂的样子，是方言自己的事。
//
// ## Excel 答不了这个问题
//
// Excel 有「追踪引用单元格」，但它只画一层箭头，且只在打开那个文件时存在。
// 它答不了「这个数当初是谁改的、依据什么」，也没法把整条链交给 AI。
// 本象里这两条链是同一个包里的两份持久数据，都可以被命令行问出来。

import { loadOrigin } from '../../compiler/origin.mjs'

/** '预算!D7' 或 'cell:预算!D/7' → 对象 ID */
export function toId(ref) {
  if (ref.startsWith('cell:') || ref.startsWith('header:')) return ref
  const m = /^(?:(.+)!)?([A-Z]{1,3})(\d+)$/.exec(ref)
  if (!m) return null
  return `cell:${m[1] ?? ''}!${m[2]}/${m[3]}`
}

const short = (id) => id.replace(/^cell:/, '').replace(/!([A-Z]{1,3})\/(\d+)$/, '!$1$2')

/**
 * 从一个格子出发，把依赖链展开成树。
 * 环（A 依赖 B、B 又依赖 A）在真表格里是存在的（迭代计算），遇到就标出来停住，不死循环。
 */
export function trace({ state, relations }, rootId, { depth = 6 } = {}) {
  const deps = new Map()
  for (const r of relations) {
    if (r.predicate !== 'depends_on') continue
    if (!deps.has(r.subject)) deps.set(r.subject, [])
    deps.get(r.subject).push(r.object)
  }

  const walk = (id, level, seen) => {
    const cell = state[id]
    const node = {
      id, ref: short(id),
      value: cell?.value ?? null,
      formula: cell?.formula ?? null,
      kind: cell ? cell.kind : 'missing',
      children: [],
    }
    if (!cell) { node.note = '不在本包中（跨包引用或超出 --max-cells）'; return node }
    if (seen.has(id)) { node.note = '循环引用，到此为止'; return node }
    if (level >= depth) { node.note = `深度超过 ${depth}，未继续展开`; return node }

    const next = new Set(deps.get(id) ?? [])
    for (const child of next) node.children.push(walk(child, level + 1, new Set([...seen, id])))
    return node
  }
  return walk(rootId, 0, new Set())
}

/** 渲染成树。叶子若是人工录入，明确标出来——那才是链的真正源头。 */
export function render(node, prefix = '', last = true, top = true) {
  const head = top ? '' : prefix + (last ? '└ ' : '├ ')
  const val = node.value === null ? '（空）' : JSON.stringify(node.value)
  const basis = node.formula ? `  ← =${node.formula}`
    : node.kind === 'input' ? '  （人工录入）'
    : node.kind === 'text' ? '  （文字）'
    : node.kind === 'missing' ? '' : ''
  const note = node.note ? `  ⚠ ${node.note}` : ''
  let out = `${head}${node.ref} = ${val}${basis}${note}\n`
  const childPrefix = top ? '' : prefix + (last ? '   ' : '│  ')
  node.children.forEach((c, i) => { out += render(c, childPrefix, i === node.children.length - 1, false) })
  return out
}

/** 链上有多少个人工录入的源头——这个数最终由几个人填的数决定。 */
export function leaves(node, acc = []) {
  if (!node.children.length && node.kind === 'input') acc.push(node)
  for (const c of node.children) leaves(c, acc)
  return acc
}

if (process.argv[1]?.includes('trace.mjs')) {
  const [dir, ref] = process.argv.slice(2)
  if (!dir || !ref) {
    process.stderr.write('用法：trace.mjs <包路径> <预算!D7> [--depth 6] [--json]\n')
    process.exit(2)
  }
  const opt = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d }
  const id = toId(ref)
  if (!id) { process.stderr.write(`认不出地址 ${ref}，例：预算!D7\n`); process.exit(2) }

  const origin = loadOrigin(dir)
  if (!origin.state[id]) { process.stderr.write(`包里没有 ${id}\n`); process.exit(1) }

  const tree = trace(origin, id, { depth: Number(opt('--depth', '6')) })
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(tree, null, 2) + '\n')
  } else {
    process.stdout.write(render(tree))
    const src = leaves(tree)
    process.stderr.write(`\n这个数最终由 ${src.length} 个人工录入的格子决定：${src.map((n) => n.ref).join('、') || '（无——全是常量或跨包）'}\n`)
  }
}
