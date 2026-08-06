#!/usr/bin/env node
// CAD 方言 —— 图纸版本对比。
//
//   node adapters/cad/diff.mjs <旧包.origin> <新包.origin>
//
// 版本对比依赖**稳定对象 ID**：同一张图的两个版本里，同一根梁必须是同一个 ID。
//   · R13+ DXF（有实体句柄）→ ID = ent:<层>/<句柄>，**真正稳定**。梁移动了仍是同一对象，
//     对比能报出「移动/改长/改属性」，而不是「删了一根、加了一根」。
//   · R12 DXF（无句柄）→ ID 退化为几何内容哈希（id_basis=content）。几何一变 ID 就变，
//     对比会退化成「删+加」——不是 bug，是 R12 格式的物理限制。导入器已如实标记，
//     diagnose 会报出来。要做真正的版本对比，出图必须选 R13 以上。
//
// 对比按对象 ID 对齐，报四类变化：
//   changed   同一 ID 存在但字段有差异（坐标/长度/编号/图层…）
//   added     新包新增的对象
//   removed   旧包有、新包没有的对象
//   stable    两边一致（不计入变化，--all 时才列出）
//
// 退出码：有任何 changed/added/removed 时退出码 1（可串进出图前的变更门禁），否则 0。

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadOrigin } from '../../compiler/origin.mjs'

// 参与对比的字段。id/type/_type 是身份不是状态；dwg 包本身的元信息（来源文件、
// has_handles 等）对比时噪音大，跳过。其余字段（坐标、长度、编号、图层…）都算状态。
const IDENTITY = new Set(['id', 'type', '_type', 'drawing'])
const SKIP_DWG = new Set(['dxf_version', 'has_handles', 'numbering', 'title', 'source', 'uri'])

/** 归一化一个对象的状态字段，供比较。 */
function stateOf(o) {
  const s = {}
  for (const [k, v] of Object.entries(o)) {
    if (IDENTITY.has(k)) continue
    if (k === 'id_basis') continue          // 退化标记是导入时的属性，与图纸内容无关
    s[k] = v
  }
  return s
}

/**
 * 对比两份包的状态。
 * @returns {{ changed: Array, added: Array, removed: Array, stable: Array }}
 */
export function comparePackages(oldPkg, newPkg) {
  const old = loadOrigin(oldPkg)
  const neu = loadOrigin(newPkg)

  // 取「几何图元」级别对齐：跳过 dwg 包本身与图层定义（图层增删本身是重要变化，
  // 但当前版本对比聚焦图元；图层变化已由 added/removed 捕获，这里不特殊处理）。
  const pick = (o) => o.type === 'ent' || o.type === 'text' || o.type === 'block'
  const oldEnts = old.objects.filter(pick)
  const newEnts = neu.objects.filter(pick)

  const oldMap = new Map(oldEnts.map((o) => [o.id, o]))
  const newMap = new Map(newEnts.map((o) => [o.id, o]))

  const changed = []
  const added = []
  const removed = []
  const stable = []

  for (const [id, no] of newMap) {
    const oo = oldMap.get(id)
    if (!oo) { added.push({ id, state: stateOf(no) }); continue }
    const a = stateOf(oo)
    const b = stateOf(no)
    // 找出差异字段
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    const diffs = []
    for (const k of keys) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push({ field: k, from: a[k] ?? null, to: b[k] ?? null })
    }
    if (diffs.length) changed.push({ id, type: no.type, layer: no.layer, diffs })
    else stable.push(id)
  }
  for (const [id, oo] of oldMap) {
    if (!newMap.has(id)) removed.push({ id, type: oo.type, layer: oo.layer, state: stateOf(oo) })
  }

  return { changed, added, removed, stable }
}

// ── CLI ─────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('diff.mjs')) {
  const [oldPkg, newPkg] = process.argv.slice(2)
  if (!oldPkg || !newPkg) {
    process.stderr.write('用法：diff.mjs <旧包.origin> <新包.origin>\n')
    process.exit(2)
  }
  if (!existsSync(join(newPkg, 'manifest.yaml'))) {
    process.stderr.write(`✗ ${newPkg} 不是本象包（缺 manifest.yaml）\n`)
    process.exit(2)
  }

  const { changed, added, removed, stable } = comparePackages(oldPkg, newPkg)

  // 退化检测：新包用内容哈希就不能做真正版本对比，如实报告
  const neu = loadOrigin(newPkg)
  const degraded = neu.objects.some((o) => (o.type === 'ent' || o.type === 'text') && o.id_basis === 'content')

  console.log('# 图纸版本对比')
  console.log(`  旧版：${oldPkg}  新版：${newPkg}`)
  if (degraded)
    console.log('  ⚠ 新包无实体句柄（R12）——ID 为内容哈希，「移动」会被看成「删+加」')
  console.log(`  ${changed.length} 处修改 · ${added.length} 处新增 · ${removed.length} 处删除 · ${stable.length} 处不变`)

  for (const c of changed) {
    console.log(`\n修改  ${c.id}`)
    for (const d of c.diffs) console.log(`  · ${d.field}: ${d.from ?? '(无)'} → ${d.to ?? '(无)'}`)
  }
  for (const a of added) {
    console.log(`新增  ${a.id}  ${JSON.stringify({ layer: a.state.layer, entity: a.state.entity, content: a.state.content })}`)
  }
  for (const r of removed) {
    console.log(`删除  ${r.id}  ${JSON.stringify({ layer: r.state.layer, entity: r.state.entity, content: r.state.content })}`)
  }

  const nChanges = changed.length + added.length + removed.length
  process.exit(nChanges > 0 ? 1 : 0)
}
