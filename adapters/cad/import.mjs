#!/usr/bin/env node
// DXF → 本象包。
//
//   node adapters/cad/import.mjs <图纸.dxf> <包路径> [--name A-101] [--counted 门窗] [--annot 标注]
//
// 导入即这个世界的诞生：图元写进 graph/objects.jsonl（出生证明），
// 此后的每一次改图都以事务追加，于是「这根梁的标高为什么是 2.9」永远查得出。
//
// ## 稳定 ID 的现实问题（必须说清楚）
//
// 本象的地基是稳定 ID，但**R12 格式的 DXF 里图元根本没有 ID**——
// 组码 5（实体句柄）是 R13 才普及的，而「另存为 R12」在国内出图流程里极常见。
//
// 所以这里分两条路：
//   有 handle → `ent:<层>/<handle>`，真正稳定，改了坐标仍是同一个对象
//   无 handle → `ent:<层>/<几何内容哈希>`，**退化方案**：图元一移动，ID 就变了，
//               版本对比会把「移动了一根梁」看成「删一根、加一根」
//
// 退化不隐瞒：包里写 id_basis=content，diagnose 会报出来。
// 要做真正的版本对比，导出时必须选 R13 以上——**这是给出图流程的硬要求，不是建议**。

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { parseDxf, geometryOf, textOf } from './dxf.mjs'
import { initPackage, appendHistory } from '../../compiler/store.mjs'
import { cadConstraints, CAD_MANIFEST } from './dialect.mjs'

const GEOMETRY_TYPES = new Set(['LINE', 'POLYLINE', 'LWPOLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'SPLINE', 'SOLID'])
const TEXT_TYPES = new Set(['TEXT', 'MTEXT', 'ATTRIB'])

/** 图层名进 ID：去掉会破坏引用语法的字符，保留中文。 */
const slug = (s) => String(s ?? '0').replace(/[\s:/*]+/g, '_')

const contentId = (e, g) =>
  createHash('sha1')
    .update([e.type, e.layer, JSON.stringify(g.bbox ?? null), g.radius ?? '', g.vertices ?? '', textOf(e) ?? ''].join('|'))
    .digest('hex')
    .slice(0, 8)

export function dxfToObjects(dxf, { name }) {
  const objects = [{ id: `dwg:${name}`, type: 'dwg', title: name, dxf_version: dxf.version, has_handles: dxf.hasHandles }]
  const seen = new Map()

  for (const l of dxf.layers) objects.push({ id: `layer:${l.name}`, type: 'layer', name: l.name, color: l.color ?? null })

  for (const e of dxf.entities) {
    const isText = TEXT_TYPES.has(e.type)
    if (!isText && !GEOMETRY_TYPES.has(e.type)) continue

    const g = geometryOf(e)
    let key = e.handle ?? contentId(e, g)
    // 内容相同的两个图元会撞 ID（真图纸里「画重了一条线」很常见）。
    // 撞了就加序号并留下标记——重线本身是缺陷，但不该让导入丢掉其中一条。
    const dup = seen.get(key) ?? 0
    seen.set(key, dup + 1)
    const id = `${isText ? 'text' : 'ent'}:${slug(e.layer)}/${key}${dup ? `-${dup + 1}` : ''}`

    const o = {
      id, type: isText ? 'text' : 'ent',
      layer: e.layer, entity: e.type,
      drawing: `dwg:${name}`,
      id_basis: e.handle ? 'handle' : 'content',
      ...g,
    }
    if (isText) o.content = textOf(e)
    if (dup) o.duplicate_of = `${isText ? 'text' : 'ent'}:${slug(e.layer)}/${key}`
    objects.push(o)
  }
  return objects
}

// ── CLI ─────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('import.mjs')) {
  const [src, dir] = process.argv.slice(2)
  if (!src || !dir) {
    process.stderr.write('用法：import.mjs <图纸.dxf> <包路径> [--name A-101] [--counted 门窗] [--annot 标注]\n')
    process.exit(2)
  }
  const opt = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d }
  const name = opt('--name', basename(src).replace(/\.dxf$/i, ''))

  const dxf = parseDxf(readFileSync(src, 'utf8'))
  const objects = dxfToObjects(dxf, { name })
  const constraints = cadConstraints({
    countedLayer: opt('--counted', '门窗'),
    annotationLayer: opt('--annot', '标注'),
    minTextHeight: Number(opt('--min-text', '200')),
  })

  initPackage(dir, { manifest: CAD_MANIFEST(name, name, src), objects, constraints })
  appendHistory(dir, [{ event: 'imported', source: src, dxf_version: dxf.version, has_handles: dxf.hasHandles, entities: objects.length - 1, at: new Date().toISOString(), by: 'dxf-import' }])

  const ents = objects.filter((o) => o.type === 'ent').length
  const texts = objects.filter((o) => o.type === 'text').length
  process.stderr.write(`导入 ${name}：${dxf.layers.length} 图层、${ents} 图元、${texts} 文字（DXF ${dxf.version}）\n`)
  if (!dxf.hasHandles)
    process.stderr.write('⚠ 该 DXF 无实体句柄（R12 或更早）——ID 退化为内容哈希，图元一移动就会被看成「删了再加」。\n  要做真正的版本对比，导出时请选 R13 以上。\n')
  process.stdout.write(dir + '\n')
}
