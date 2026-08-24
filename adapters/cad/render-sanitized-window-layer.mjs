#!/usr/bin/env node
// 从离线 DWG 结构摘要生成“只含 WINDOW 图层几何”的脱敏 SVG。
//
// 安全约束：只访问 windowLayerEntities；不读取 texts / block name；不输出任何 <text>、
// ATTRIB、MTEXT、TEXT 或图签。INSERT 只画十字定位符，不写块名。

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [input, outDir] = process.argv.slice(2)
if (!input || !outDir) {
  process.stderr.write('用法：render-sanitized-window-layer.mjs <dwg-summary.json> <out-dir> --crop name,minX,minY,width,height [--crop ...]\n')
  process.exit(2)
}

const crops = []
let anchorsPath = null
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--anchors') {
    anchorsPath = process.argv[++i]
    continue
  }
  if (process.argv[i] !== '--crop') continue
  const [name, ...nums] = String(process.argv[++i]).split(',')
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(Number(n)))) throw new Error(`坏 crop：${name},${nums.join(',')}`)
  crops.push({ name, box: nums.map(Number) })
}
if (!crops.length) throw new Error('至少给一个 --crop；公开截图的范围必须由人显式选择，不能自动把整图内容带出去')

const inputBytes = readFileSync(input)
const data = JSON.parse(inputBytes)
const entities = data.windowLayerEntities ?? data.entities ?? []
const sourceCollection = data.windowLayerEntities ? 'windowLayerEntities' : 'sanitized-basic-geometry.entities'
const anchors = anchorsPath ? (JSON.parse(readFileSync(anchorsPath, 'utf8')).objects ?? []) : []
mkdirSync(outDir, { recursive: true })

const typeCount = {}
for (const e of entities) typeCount[e.type] = (typeCount[e.type] ?? 0) + 1

function render({ name, box: [minX, minY, width, height] }) {
  const maxX = minX + width
  const maxY = minY + height
  const inside = (x, y) => Number.isFinite(x) && Number.isFinite(y) && x >= minX && x <= maxX && y >= minY && y <= maxY
  const shapes = []
  const stroke = Math.max(width, height) / 4800
  const marker = Math.max(width, height) / 520

  for (const e of entities) {
    if (e.type === 'LINE') {
      const a = e.startPoint, b = e.endPoint
      if (!a || !b || !inside((a.x + b.x) / 2, (a.y + b.y) / 2)) continue
      shapes.push(`<line x1="${a.x}" y1="${-a.y}" x2="${b.x}" y2="${-b.y}" class="line"/>`)
    } else if (e.type === 'LWPOLYLINE') {
      const points = e.vertices ?? []
      if (!points.length) continue
      const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length
      const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length
      if (!inside(cx, cy)) continue
      shapes.push(`<polyline points="${points.map((p) => `${p.x},${-p.y}`).join(' ')}" class="poly"/>`)
      if ((e.flag & 1) || e.closed) shapes.push(`<line x1="${points.at(-1).x}" y1="${-points.at(-1).y}" x2="${points[0].x}" y2="${-points[0].y}" class="poly"/>`)
    } else if (e.type === 'ARC') {
      const c = e.center
      if (!c || !inside(c.x, c.y)) continue
      // 公开投影只需证明原始几何存在，不拿近似圆弧做尺寸复核；用完整圆淡化显示。
      shapes.push(`<circle cx="${c.x}" cy="${-c.y}" r="${e.radius}" class="arc"/>`)
    } else if (e.type === 'CIRCLE') {
      const c = e.center
      if (!c || !inside(c.x, c.y)) continue
      shapes.push(`<circle cx="${c.x}" cy="${-c.y}" r="${e.radius}" class="arc"/>`)
    } else if (e.type === 'INSERT') {
      const p = e.insertionPoint
      if (!p || !inside(p.x, p.y)) continue
      // 绝不输出 e.name；块名可能含客户自定义信息。
      shapes.push(`<path d="M ${p.x - marker} ${-p.y} H ${p.x + marker} M ${p.x} ${-p.y - marker} V ${-p.y + marker}" class="insert"/>`)
    }
  }

  let anchorsInCrop = 0
  for (const object of anchors) {
    const [x, y] = object.anchor ?? []
    if (!inside(x, y)) continue
    anchorsInCrop++
    const css = object.classification === 'door' ? 'door-anchor' : 'window-anchor'
    shapes.push(`<circle cx="${x}" cy="${-y}" r="${marker * 0.62}" class="${css}" data-handle="${String(object.handle).replace(/[^0-9A-F]/gi, '')}"/>`)
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${-maxY} ${width} ${height}" width="1600" height="1000" style="background:#07111f">
<rect x="${minX}" y="${-maxY}" width="${width}" height="${height}" fill="#07111f"/>
<g fill="none" stroke-linecap="round" stroke-linejoin="round">
  <style>.line{stroke:#79c0ff;stroke-width:${stroke}}.poly{stroke:#a5d6ff;stroke-width:${stroke}}.arc{stroke:#f2cc60;stroke-width:${stroke}}.insert{stroke:#ff7b72;stroke-width:${stroke * 1.35}}.window-anchor{fill:#39d98a;stroke:#fff;stroke-width:${stroke * 2}}.door-anchor{fill:#ff9f43;stroke:#fff;stroke-width:${stroke * 2}}</style>
  ${shapes.join('\n  ')}
</g>
</svg>`
  if (/<text\b|<image\b|ATTRIB|MTEXT|客户|项目|图签/i.test(svg)) throw new Error(`${name} 脱敏闸门失败`)
  writeFileSync(join(outDir, `${name}.svg`), svg, 'utf8')
  return { name, crop: [minX, minY, width, height], shapes: shapes.length, anchors: anchorsInCrop }
}

const rendered = crops.map(render)
const report = {
  ok: true,
  source_summary_sha256: createHash('sha256').update(inputBytes).digest('hex'),
  source_collection: sourceCollection,
  source_entity_types: typeCount,
  anchor_source: anchorsPath ? 'decoded-tch-opening-anchor-map' : null,
  anchor_count: anchors.length,
  included: ['LINE', 'LWPOLYLINE', 'ARC', 'INSERT-as-cross'],
  omitted: sourceCollection === 'windowLayerEntities'
    ? ['TEXT', 'MTEXT', 'ATTRIB', 'block-name', 'HATCH', 'title-block', 'all-non-WINDOW-layers']
    : ['TEXT', 'MTEXT', 'ATTRIB', 'block-name', 'HATCH', 'proxy-binary'],
  guarantees: ['no-text-elements', 'no-images', 'no-block-names', 'explicit-human-selected-crops'],
  rendered,
}
writeFileSync(join(outDir, 'sanitization.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
process.stdout.write(JSON.stringify(report) + '\n')
