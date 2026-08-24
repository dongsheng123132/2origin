#!/usr/bin/env node
// 生成单文件、无客户文字的 TCH_OPENING 对象级复核地图。

import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'

const [geometryPath, anchorsPath, outputPath] = process.argv.slice(2)
if (!geometryPath || !anchorsPath || !outputPath) {
  process.stderr.write('用法：render-opening-object-map.mjs <sanitized-geometry.json> <anchors.json> <output.html>\n')
  process.exit(2)
}

const geometry = JSON.parse(readFileSync(geometryPath, 'utf8')).entities ?? []
const anchorDoc = JSON.parse(readFileSync(anchorsPath, 'utf8'))
const anchors = (anchorDoc.objects ?? []).filter((row) => row.ok)
const packageName = basename(dirname(dirname(outputPath)))
const crop = { minX: -205000, minY: -165000, width: 735000, height: 280000 }
const maxX = crop.minX + crop.width
const maxY = crop.minY + crop.height
const inside = (x, y) => Number.isFinite(x) && Number.isFinite(y) && x >= crop.minX && x <= maxX && y >= crop.minY && y <= maxY
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const shapes = []
for (const entity of geometry) {
  if (entity.type === 'LINE') {
    const a = entity.startPoint, b = entity.endPoint
    if (!a || !b || !inside((a.x + b.x) / 2, (a.y + b.y) / 2)) continue
    shapes.push(`<line x1="${a.x}" y1="${-a.y}" x2="${b.x}" y2="${-b.y}"/>`)
  } else if (entity.type === 'LWPOLYLINE') {
    const points = entity.vertices ?? []
    if (!points.length) continue
    const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length
    const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length
    if (!inside(cx, cy)) continue
    shapes.push(`<polyline points="${points.map((p) => `${p.x},${-p.y}`).join(' ')}"/>`)
    if (entity.closed) shapes.push(`<line x1="${points.at(-1).x}" y1="${-points.at(-1).y}" x2="${points[0].x}" y2="${-points[0].y}"/>`)
  } else if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
    const c = entity.center
    if (c && inside(c.x, c.y)) shapes.push(`<circle cx="${c.x}" cy="${-c.y}" r="${entity.radius}"/>`)
  }
}

const dots = anchors.map((row) => {
  const { x, y } = row.anchor
  const kind = row.classification === 'door' ? 'door' : 'window'
  return `<circle id="o-${esc(row.handle)}" class="opening ${kind}" cx="${x}" cy="${-y}" r="1050" data-handle="${esc(row.handle)}" tabindex="0"/>`
}).join('\n')

const safeRows = anchors.map((row) => ({
  handle: row.handle,
  classification: row.classification,
  layer: row.layer,
  anchor: row.anchor,
  evidence: row.evidence,
}))

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>本象协议｜CAD 门窗对象级复核案例</title>
<style>
:root{--bg:#07111f;--panel:#0c1a2c;--line:#6aa9d8;--green:#39d98a;--orange:#ff9f43;--ink:#ecf6ff;--muted:#91a7bc;--cyan:#5ad7ff}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,"Microsoft YaHei",sans-serif}header{padding:36px 5vw 24px;background:radial-gradient(circle at 75% 0,#123c5d 0,transparent 40%)}h1{margin:0 0 8px;font-size:clamp(28px,4vw,52px)}h2{font-size:22px;margin:0 0 14px}.lead{max-width:900px;color:#c5d7e7;font-size:18px}.cards{display:grid;grid-template-columns:repeat(6,minmax(110px,1fr));gap:10px;margin-top:24px}.card,.panel{background:rgba(12,26,44,.94);border:1px solid #203b55;border-radius:14px}.card{padding:14px}.card b{display:block;font-size:26px;color:var(--cyan)}main{padding:18px 3vw 48px}.toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px}.toolbar input{min-width:220px;padding:10px 12px;background:#07111f;border:1px solid #31516c;border-radius:9px;color:white}.toolbar button{padding:9px 12px;border:1px solid #31516c;border-radius:9px;background:#11273c;color:white;cursor:pointer}.toolbar button:hover{border-color:var(--cyan)}.workspace{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:14px}.map-panel{overflow:hidden;position:relative}.map-scroll{overflow:auto;max-height:72vh}svg{display:block;width:100%;height:auto;background:#06101d}.cad line,.cad polyline,.cad circle{fill:none;stroke:var(--line);stroke-width:125;opacity:.55;vector-effect:non-scaling-stroke}.opening{stroke:white;stroke-width:180;cursor:pointer;vector-effect:non-scaling-stroke}.opening.window{fill:var(--green)}.opening.door{fill:var(--orange)}.opening.hidden{display:none}.opening.selected{fill:#ff4fd8;stroke:#fff700;stroke-width:520}.side{padding:18px;position:sticky;top:10px;height:max-content}.kv{display:grid;grid-template-columns:98px 1fr;gap:8px;margin:6px 0}.kv span:first-child{color:var(--muted)}code{word-break:break-all;background:#06101d;border:1px solid #213a52;padding:8px;border-radius:8px;display:block;color:#b8e7ff}.legend{display:flex;gap:16px;color:var(--muted);margin:9px 0}.dot{width:11px;height:11px;border-radius:50%;display:inline-block;margin-right:5px}.note{margin-top:14px;padding:12px;border-left:3px solid #f2cc60;background:#151d29;color:#d9e3eb}.flow{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}.flow span{padding:8px 11px;background:#0d2135;border:1px solid #25435d;border-radius:999px}.flow i{align-self:center;color:#63829c}@media(max-width:900px){.cards{grid-template-columns:repeat(2,1fr)}.workspace{grid-template-columns:1fr}.side{position:static}}
.cad line,.cad polyline,.cad circle,.opening{vector-effect:none}
</style></head><body>
<header><h1>不是只报“168”</h1><div class="lead">本象把 CAD 计数结果保存成 168 个可查询的窗对象。每个对象都有稳定 handle、分类、载荷指纹和原图坐标锚点，可点击、搜索、逐个复核。</div>
<div class="cards"><div class="card"><b>194</b>TCH_OPENING</div><div class="card"><b>4</b>块定义模板</div><div class="card"><b>190</b>实际放置</div><div class="card"><b>168</b>窗对象</div><div class="card"><b>22</b>门对象</div><div class="card"><b>190/190</b>位置已解析</div></div>
<div class="flow"><span>受控 DWG</span><i>→</i><span>ODA 离线转换</span><i>→</i><span>TCH_OPENING 对象</span><i>→</i><span>本象 .origin</span><i>→</i><span>对象级复核投影</span></div></header>
<main><div class="toolbar"><input id="search" placeholder="输入 handle，例如 38A"><button id="find">定位对象</button><button data-filter="all">全部 190</button><button data-filter="window">只看窗 168</button><button data-filter="door">只看门 22</button><button id="reset">恢复全图</button></div>
<div class="legend"><span><i class="dot" style="background:var(--green)"></i>窗对象</span><span><i class="dot" style="background:var(--orange)"></i>门对象</span><span>蓝线：脱敏原始基础几何（无文字、无图签内容）</span></div>
<div class="workspace"><section class="panel map-panel"><div class="map-scroll"><svg id="map" viewBox="${crop.minX} ${-maxY} ${crop.width} ${crop.height}" aria-label="CAD 门窗对象复核地图"><g class="cad">${shapes.join('')}</g><g>${dots}</g></svg></div></section>
<aside class="panel side"><h2>单对象复核</h2><div id="empty">点击任意彩色点，或输入 handle 搜索。</div><div id="detail" hidden><div class="kv"><span>对象 ID</span><strong id="oid"></strong></div><div class="kv"><span>分类</span><strong id="kind"></strong></div><div class="kv"><span>坐标</span><strong id="coord"></strong></div><div class="kv"><span>解码器</span><strong id="decoder"></strong></div><div class="kv"><span>字段偏移</span><strong id="offsets"></strong></div><p>命令行独立查询：</p><code id="command"></code></div><div class="note"><b>边界：</b>168 的单位是窗樘/窗洞对象，不是玻璃分格或采购块数；当前恢复的是位置锚点，不冒充精确轮廓或 bbox。</div></aside></div></main>
<script>
const rows=${JSON.stringify(safeRows)};const byHandle=new Map(rows.map(r=>[r.handle.toUpperCase(),r]));const map=document.querySelector('#map');const full='${crop.minX} ${-maxY} ${crop.width} ${crop.height}';
function select(handle){const key=handle.toUpperCase();const row=byHandle.get(key)||rows.find(r=>r.handle.toUpperCase().includes(key));if(!row)return false;document.querySelectorAll('.opening.selected').forEach(e=>e.classList.remove('selected'));const el=document.querySelector('#o-'+CSS.escape(row.handle));el.classList.add('selected');map.setAttribute('viewBox',(row.anchor.x-15000)+' '+(-row.anchor.y-15000)+' 30000 30000');document.querySelector('#empty').hidden=true;document.querySelector('#detail').hidden=false;document.querySelector('#oid').textContent='opening:'+row.handle;document.querySelector('#kind').textContent=row.classification==='window'?'窗 window':'门 door';document.querySelector('#coord').textContent=row.anchor.x.toFixed(3)+', '+row.anchor.y.toFixed(3);document.querySelector('#decoder').textContent=row.evidence.decoder;document.querySelector('#offsets').textContent='x@'+row.evidence.x_offset+' / y@'+row.evidence.y_offset;document.querySelector('#command').textContent='origin why cases/${esc(packageName)} opening:'+row.handle+'.position_anchor';return true}
document.querySelectorAll('.opening').forEach(el=>el.addEventListener('click',()=>select(el.dataset.handle)));document.querySelector('#find').addEventListener('click',()=>select(document.querySelector('#search').value.trim()));document.querySelector('#search').addEventListener('keydown',e=>{if(e.key==='Enter')select(e.target.value.trim())});document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{const f=b.dataset.filter;document.querySelectorAll('.opening').forEach(el=>el.classList.toggle('hidden',f!=='all'&&!el.classList.contains(f)))}));document.querySelector('#reset').addEventListener('click',()=>{map.setAttribute('viewBox',full);document.querySelectorAll('.opening.selected').forEach(e=>e.classList.remove('selected'))});
</script></body></html>`

if (/<text\b|<image\b|\bATTRIB\b|\bMTEXT\b/i.test(html)) throw new Error('脱敏闸门失败：HTML 含禁用 CAD 内容')
writeFileSync(outputPath, html, 'utf8')
process.stdout.write(JSON.stringify({ ok: true, output: outputPath, geometry_shapes: shapes.length, positioned_objects: anchors.length }) + '\n')
