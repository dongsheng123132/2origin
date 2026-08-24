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
import { parseDxf, geometryOf, textOf, insertOf, blockBBox } from './dxf.mjs'
import { initPackage, appendHistory } from '../../compiler/store.mjs'
import { cadConstraints, cadLimits, CAD_MANIFEST } from './dialect.mjs'

const GEOMETRY_TYPES = new Set(['LINE', 'POLYLINE', 'LWPOLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'SPLINE', 'SOLID', 'INSERT'])
const TEXT_TYPES = new Set(['TEXT', 'MTEXT'])

/** 图层名进 ID：去掉会破坏引用语法的字符，保留中文。 */
const slug = (s) => String(s ?? '0').replace(/[\s:/*]+/g, '_')

const contentId = (e, g) =>
  createHash('sha1')
    .update([
      e.type, e.layer, JSON.stringify(g.bbox ?? null), g.radius ?? '', g.vertices ?? '', textOf(e) ?? '',
      // 块名与属性一并入哈希：同一型号的两樘窗几何完全相同，只有编号不同，
      // 不算进去就会被判成同一个对象，直接丢掉一樘。
      e.type === 'INSERT' ? insertOf(e).block + '|' + JSON.stringify(e.attrs) + '|' + JSON.stringify(g.at) : '',
    ].join('|'))
    .digest('hex')
    .slice(0, 8)

export function dxfToObjects(dxf, { name }) {
  const objects = [{ id: `dwg:${name}`, type: 'dwg', title: name, dxf_version: dxf.version, has_handles: dxf.hasHandles }]
  const seen = new Map()

  // 有些真实 DXF（包括美国市政官方模板）ENTITIES 会使用未列入 LAYER 表的图层。
  // 图层表不完备不应让关系悬空：表内保留颜色，表外按实体引用补成 implied layer。
  const declaredLayers = new Map(dxf.layers.map((l) => [l.name, l]))
  const usedLayers = new Set([
    ...dxf.entities.map((e) => e.layer),
    ...[...dxf.blocks.values()].flatMap((b) => b.entities.map((e) => e.layer)),
  ].filter(Boolean))
  for (const name of new Set([...declaredLayers.keys(), ...usedLayers])) {
    const l = declaredLayers.get(name)
    objects.push({ id: `layer:${name}`, type: 'layer', name, color: l?.color ?? null, declared_in_table: Boolean(l) })
  }

  // 块定义本身也是对象：换型号、改尺寸时要能回答「哪些图元用了这个块」
  for (const [bname, b] of dxf.blocks ?? []) {
    const bb = blockBBox(b)
    objects.push({
      id: `block:${slug(bname)}`, type: 'block', name: bname,
      entities: b.entities.length, drawing: `dwg:${name}`,
      ...(bb ? { width: Math.round((bb[2] - bb[0]) * 100) / 100, height_mm: Math.round((bb[3] - bb[1]) * 100) / 100 } : {}),
    })
  }

  for (const e of dxf.entities) {
    const isText = TEXT_TYPES.has(e.type)
    if (!isText && !GEOMETRY_TYPES.has(e.type)) continue

    const g = geometryOf(e, dxf.blocks)
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
    if (e.type === 'INSERT') {
      const ins = insertOf(e)
      o.block = `block:${slug(ins.block)}`
      o.block_name = ins.block
      // 属性摊平成 attr_<标签> 字段。谓词判的是「一个稳定 ID 上的一个具名字段」，
      // 嵌套对象进不了这套判定——而门窗编号、设备型号恰恰几乎都存在属性里。
      for (const [tag, val] of Object.entries(e.attrs ?? {})) o[`attr_${tag}`] = val
      if (ins.columns > 1 || ins.rows > 1) o.array = `${ins.columns}×${ins.rows}`
    }
    if (dup) o.duplicate_of = `${isText ? 'text' : 'ent'}:${slug(e.layer)}/${key}`
    objects.push(o)
  }
  return objects
}

/** DWG 版本魔数 → 人话。这几个字节是明文的，不解压也读得到。 */
const DWG_VERSIONS = {
  AC1009: 'R12', AC1012: 'R13', AC1014: 'R14', AC1015: 'AutoCAD 2000',
  AC1018: 'AutoCAD 2004', AC1021: 'AutoCAD 2007', AC1024: 'AutoCAD 2010',
  AC1027: 'AutoCAD 2013', AC1032: 'AutoCAD 2018',
}

/**
 * 认一下这个文件到底是什么，认不了就说清楚为什么、以及该怎么办。
 *
 * 真实项目里拿到的多半是 .dwg（AutoCAD 私有二进制，分段压缩）或图纸导出的 .pdf。
 * 两者都读不了，但**读不了的原因完全不同**，给出的建议也就不同——
 * 一句笼统的「不支持」会让人去试错误的方向。
 */
export function sniff(path, head) {
  const magic = head.slice(0, 6).toString('latin1')
  if (magic in DWG_VERSIONS) {
    const ver = DWG_VERSIONS[magic]
    // 实体句柄（组码 5）自 R13（AC1012）起普及；只有 R12（AC1009）没有。
    // （曾误写为 `magic !== 'AC1009' && magic !== 'AC1012'`，把 R13 也判成无句柄——
    //   与 import.mjs/dxf.mjs 注释自相矛盾，此处已更正。）
    const hasHandles = magic !== 'AC1009'
    return {
      kind: 'dwg', version: `${magic}（${ver}）`, readable: false, hasHandles,
      why: 'DWG 是 AutoCAD 私有二进制格式，分段压缩，没有公开规范。本项目零依赖，不内置 DWG 解析。',
      how: [
        `好消息：${ver} ${hasHandles ? '**有实体句柄**，转成 DXF 后 ID 是真正稳定的（挪动构件仍是同一个对象）' : '没有实体句柄，ID 只能退化为内容哈希'}。`,
        '转换办法，任选其一：',
        '  ① 在 CAD 里「另存为 → AutoCAD 2004/2013 DXF」——AutoCAD / 浩辰 / 中望都支持，一次点击',
        '  ② 装 ODA File Converter（免费、离线、可批量）：https://www.opendesign.com/guestfiles/oda_file_converter',
        '  ③ 请出图方直接给 DXF',
        '⚠ 不要用在线转换网站——施工图属于客户资料，上传给第三方是泄密。',
      ].join('\n'),
    }
  }
  if (head.slice(0, 5).toString('latin1') === '%PDF-')
    return {
      kind: 'pdf', readable: false,
      why: 'PDF 是图纸的**投影**，不是本源。CAD 导出 PDF 时文字通常被转成曲线，图层、块、属性、对象身份全部丢失。',
      how: [
        '实测：一份 17 页施工图 PDF 里有 545,480 条矢量绘图指令，文字绘制指令只有 65 条，',
        '且是无 ToUnicode 的子集字体字形码——门窗编号、标高、房间名一个字都提不出来。',
        'OCR 也救不回来：它能给出字符串，给不出「这个编号属于哪一樘窗」。',
        '→ 请拿 DXF 或 DWG，不要拿 PDF。',
      ].join('\n'),
    }
  return { kind: 'dxf', readable: true }
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

  const probe = sniff(src, readFileSync(src).subarray(0, 16))
  if (!probe.readable) {
    process.stderr.write(`无法导入：${src}\n\n这是 ${probe.kind.toUpperCase()}${probe.version ? ' ' + probe.version : ''}。\n${probe.why}\n\n${probe.how}\n`)
    process.exit(2)
  }

  const counted = opt('--counted', '门窗')
  const numberAttr = opt('--number-attr', 'NUMBER')
  const dxf = parseDxf(readFileSync(src, 'utf8'))
  const objects = dxfToObjects(dxf, { name })

  // 图纸是用块属性编号，还是用独立文字标注？两种规则集不能混用——
  // 对块属性图纸套「构件数=标注数」会得到假警报，几次之后没人再看体检结果。
  const numbering = objects.some((o) => o.id.startsWith(`ent:${counted}/`) && o[`attr_${numberAttr}`] !== undefined) ? 'block' : 'text'
  objects[0].numbering = numbering

  const constraints = cadConstraints({
    countedLayer: counted,
    annotationLayer: opt('--annot', '标注'),
    minTextHeight: Number(opt('--min-text', '200')),
    numberAttr, numbering,
  })

  initPackage(dir, { manifest: CAD_MANIFEST(name, name, src), objects, constraints,
    limits: cadLimits({ hasHandles: dxf.hasHandles, numbering }) })
  appendHistory(dir, [{ event: 'imported', source: src, dxf_version: dxf.version, has_handles: dxf.hasHandles, entities: objects.length - 1, at: new Date().toISOString(), by: 'dxf-import' }])

  const ents = objects.filter((o) => o.type === 'ent').length
  const texts = objects.filter((o) => o.type === 'text').length
  process.stderr.write(`导入 ${name}：${dxf.layers.length} 图层、${ents} 图元、${texts} 文字（DXF ${dxf.version}）\n`)
  if (!dxf.hasHandles)
    process.stderr.write('⚠ 该 DXF 无实体句柄（R12 或更早）——ID 退化为内容哈希，图元一移动就会被看成「删了再加」。\n  要做真正的版本对比，导出时请选 R13 以上。\n')
  process.stdout.write(dir + '\n')
}
