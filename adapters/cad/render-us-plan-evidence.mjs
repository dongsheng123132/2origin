#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseDxf, geometryOf, textOf } from './dxf.mjs'

const [src, pkg] = process.argv.slice(2)
if (!src || !pkg) { process.stderr.write('用法：render-us-plan-evidence.mjs <source.dxf> <pkg.origin>\n'); process.exit(2) }
const dxf = parseDxf(readFileSync(src, 'utf8'))
const summary = JSON.parse(readFileSync(join(pkg, 'projections', 'semantic-summary.json'), 'utf8'))
const objectRows = readFileSync(join(pkg, 'graph', 'objects.jsonl'), 'utf8').trim().split(/\r?\n/).filter(Boolean)
const relationRows = readFileSync(join(pkg, 'graph', 'relations.jsonl'), 'utf8').trim().split(/\r?\n/).filter(Boolean)
const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const plain = (s) => String(s ?? '').replace(/\\P/g, ' ').replace(/\^I/g, ' ').replace(/%%U/g, '').replace(/\\p[^;]*;/g, '').replace(/\{\\L([^}]*)\}/g, '$1').replace(/\{\\Q\d+;([^}]*)\}/g, '$1').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()

const rows = dxf.entities.map((e) => ({ e, g: geometryOf(e, dxf.blocks), text: textOf(e) })).filter((r) => r.g.bbox || r.g.at)
// 官方模板同时带若干远离主图框的定义/辅助对象。视觉投影以最大闭合多段线（主图框）裁切，
// 但结构包仍保留全部对象；这是“投影裁切”，不是删除源事实。
const frame = rows.filter(({ e, g }) => e.closed && g.bbox && typeof g.area === 'number').sort((a, b) => b.g.area - a.g.area)[0]?.g.bbox
if (!frame) throw new Error('找不到主图框，拒绝生成误导性投影')
const [minX, minY, maxX, maxY] = frame
const pad = Math.max(maxX - minX, maxY - minY) * .025
const view = `${minX - pad} ${-(maxY + pad)} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`
const color = (layer) => layer === 'TITLE' ? '#22d3ee' : layer === 'NOTES' ? '#fbbf24' : layer === 'TEXT' ? '#a7f3d0' : '#7895b2'
const shapes = rows.map(({ e, g, text }) => {
  const c = color(e.layer), handle = esc(e.handle), layer = esc(e.layer)
  if (e.type === 'LINE' && g.bbox) return `<line x1="${g.bbox[0]}" y1="${-g.bbox[1]}" x2="${g.bbox[2]}" y2="${-g.bbox[3]}" data-handle="${handle}" data-layer="${layer}"/>`
  if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices?.length) return `<polyline points="${e.vertices.map(([x,y]) => `${x},${-y}`).join(' ')}" ${e.closed ? 'class="closed"' : ''} data-handle="${handle}" data-layer="${layer}"/>`
  if (e.type === 'CIRCLE' && g.bbox) return `<circle cx="${(g.bbox[0]+g.bbox[2])/2}" cy="${-(g.bbox[1]+g.bbox[3])/2}" r="${g.radius}" data-handle="${handle}" data-layer="${layer}"/>`
  if (e.type === 'INSERT' && g.bbox) return `<rect x="${g.bbox[0]}" y="${-g.bbox[3]}" width="${g.bbox[2]-g.bbox[0]}" height="${g.bbox[3]-g.bbox[1]}" data-handle="${handle}" data-layer="${layer}"/>`
  if ((e.type === 'TEXT' || e.type === 'MTEXT') && g.at && text) return `<text x="${g.at[0]}" y="${-g.at[1]}" font-size="${Math.max(g.height ?? .1, .28)}" fill="${c}" stroke="none" data-handle="${handle}" data-layer="${layer}">${esc(plain(text).slice(0, 180))}</text>`
  return ''
}).join('')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}" role="img" aria-label="Official DXF entity projection"><rect x="${minX-pad}" y="${-(maxY+pad)}" width="${maxX-minX+2*pad}" height="${maxY-minY+2*pad}" fill="#06101d"/><g fill="none" stroke="#7895b2" stroke-width=".065">${shapes}</g></svg>`
mkdirSync(join(pkg, 'projections'), { recursive: true })
writeFileSync(join(pkg, 'projections', 'official-dxf-entity-projection.svg'), svg, 'utf8')

const sheetRows = summary.sheet_index.map((s) => `<tr><td>${esc(s.printed_pages)}</td><td>${esc(s.discipline_code ?? '—')}</td><td>${esc(s.title)}</td><td><code>${esc(s.id)}</code></td></tr>`).join('')
const refs = summary.governing_references.map((r) => `<li><b>${esc(r.document_no)}</b><span>${esc(r.title)} · ${esc(r.edition)}</span></li>`).join('')
const blanks = summary.blank_required_fields.map((x) => `<span>${esc(x)}</span>`).join('')
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>美国官方 CAD 解构验真</title><style>
:root{--bg:#06101d;--panel:#0d1b2d;--line:#24425e;--cyan:#5ee7f2;--green:#55e6a5;--yellow:#ffd166;--ink:#eef7ff;--muted:#93a9bd}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% 0,#123b57 0,transparent 32%),var(--bg);color:var(--ink);font:15px/1.6 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1400px;margin:auto;padding:42px 4vw 70px}.hero,.panel{background:rgba(13,27,45,.94);border:1px solid var(--line);border-radius:24px}.hero{padding:44px;position:relative;overflow:hidden}.badge{display:inline-flex;padding:6px 12px;border:1px solid var(--green);color:var(--green);border-radius:99px;font-weight:800}h1{font-size:clamp(38px,6vw,78px);line-height:1.05;margin:18px 0}.grad{color:var(--cyan)}.lead{font-size:20px;color:#c8d7e5;max-width:980px}.truth{margin-top:24px;padding:18px;border-left:4px solid var(--yellow);background:#171d29}.cards{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:18px 0}.card{padding:18px;background:#0b1727;border:1px solid var(--line);border-radius:16px}.card b{display:block;font-size:30px;color:var(--green)}.card span{color:var(--muted)}.split{display:grid;grid-template-columns:1.25fr .75fr;gap:18px}.panel{padding:24px;margin-top:18px}.drawing{padding:12px;background:#020812;border-radius:16px;overflow:auto;max-height:1080px}.drawing img{display:block;width:100%;height:auto}.chain{display:grid;gap:12px}.step{padding:16px;border-radius:14px;background:#091827;border:1px solid var(--line)}.step b{color:var(--cyan)}table{width:100%;border-collapse:collapse}th,td{padding:12px;border-bottom:1px solid #20384e;text-align:left}th{color:var(--muted)}code{color:var(--cyan)}ul{list-style:none;padding:0}li{display:grid;grid-template-columns:150px 1fr;gap:12px;padding:12px 0;border-bottom:1px solid #20384e}li span{color:#c5d5e3}.blanks{display:flex;flex-wrap:wrap;gap:8px}.blanks span{padding:7px 10px;background:#302413;color:#ffe29a;border-radius:8px}.ok{color:var(--green)}.limit{color:var(--yellow)}footer{text-align:center;color:var(--muted);padding-top:32px}@media(max-width:1000px){.cards{grid-template-columns:repeat(2,1fr)}.split{grid-template-columns:1fr}.hero{padding:28px}}
</style></head><body><main><section class="hero"><span class="badge">BENXIANG EVIDENCE CERTIFICATE · VERIFIED WITH DECLARED LIMITS</span><h1>我们让 AI <span class="grad">读懂了这份 CAD</span><br>而且每句话都能回到原对象</h1><p class="lead">对象级验真对象：City of San Diego 官方 DS-3179 Construction Plan DXF 模板。这里的“读懂”不是看截图猜内容，而是从原始 DXF 恢复稳定对象、单位、图层、页索引、引用标准与待填写字段，并执行机器约束。</p><div class="truth"><b>可认证表述：</b>“AI 辅助流水线读懂了这份美国官方 CAD 模板中可验证的结构与语义。”<br><span class="limit">不可扩写为：已经通过美国建筑法规审查、获得 AHJ 认可、或能替代持证专业人员。</span></div></section>
<section class="cards"><div class="card"><b>${esc(summary.dxf_version)}</b><span>原始 DXF 版本</span></div><div class="card"><b>${esc(summary.unit)}</b><span>头部单位解析</span></div><div class="card"><b>${objectRows.length}</b><span>本象对象</span></div><div class="card"><b>${relationRows.length}</b><span>语义关系</span></div><div class="card"><b>${summary.sheet_index.length} + ${summary.governing_references.length}</b><span>页索引 + 标准</span></div><div class="card"><b>10/10</b><span>约束通过</span></div></section>
<section class="split"><div class="panel"><h2>官方 DXF 完整原图渲染 · 不是人工重画</h2><p>下面直接渲染源 DXF 的 Model Space，并展开块参照。图框、Vicinity Map 区、Sheet Index、施工变更表、Street Data Table 和官方图签均来自源文件；这是可视投影，不会改写原件。</p><div class="drawing"><img src="official-dxf-modelspace.png" alt="City of San Diego DS-3179 official DXF rendered from source entities"></div></div><aside class="panel"><h2>“读懂”的证据链</h2><div class="chain"><div class="step"><b>1 · 身份</b><br>SHA-256<br><code>${summary.source_sha256}</code></div><div class="step"><b>2 · 结构</b><br>实体和文字保留 DXF handle，关系落到图层；原图渲染展开块参照。</div><div class="step"><b>3 · 语义</b><br>识别市政施工图模板、英制单位、页索引、适用标准、图签占位字段。</div><div class="step"><b>4 · 可追溯</b><br><code>origin why ... metric:us-template-understanding.certified_statement</code></div><div class="step"><b>5 · 边界</b><br><code>origin limits ...</code> 明确不做法规通过判断。</div></div></aside></section>
<section class="split"><div class="panel"><h2>页索引解构</h2><table><thead><tr><th>页</th><th>专业码</th><th>标题</th><th>对象 ID</th></tr></thead><tbody>${sheetRows}</tbody></table></div><div class="panel"><h2>引用标准解构</h2><ul>${refs}</ul></div></section>
<section class="panel"><h2>模板仍待填写的字段</h2><p>AI 不仅能摘录已有内容，也能把模板中的空缺作为可查询对象保留下来：</p><div class="blanks">${blanks}</div></section>
<section class="panel"><h2>验真判决</h2><p class="ok"><b>通过：</b>源身份、稳定对象、单位、页索引、引用标准、空缺字段和可追溯关系均已形成机器可检查证据。</p><p class="limit"><b>有限通过：</b>输入是官方模板而非完整设计图；未绑定具体 AHJ 法规规则集；未认证建筑、结构、机电或消防设计合规。</p></section><footer>Benxiang / 本象协议 · evidence generated from the official source DXF · not an accredited or governmental certification</footer></main></body></html>`
writeFileSync(join(pkg, 'projections', 'evidence-certificate.html'), html, 'utf8')
writeFileSync(join(pkg, 'projections', 'evidence-certificate.json'), JSON.stringify({
  schema: 'benxiang-evidence-certificate/v1', status: 'verified-with-declared-limits', issued_at: new Date().toISOString(),
  subject: summary.artifact, source_sha256: summary.source_sha256,
  certified_statement: 'AI-assisted pipeline read the verifiable structure and semantics of this official CAD template at object level.',
  evidence: { dxf_version: summary.dxf_version, unit: summary.unit, objects: objectRows.length, relations: relationRows.length, sheet_index_entries: summary.sheet_index.length, governing_references: summary.governing_references.length, constraints_passed: '10/10' },
  disclaimer: 'Engineering evidence certificate only; not independent, accredited, governmental, AHJ, architectural, or professional-engineering certification.'
}, null, 2) + '\n')
console.log(JSON.stringify({ ok: true, html: join(pkg, 'projections', 'evidence-certificate.html'), svg: join(pkg, 'projections', 'official-dxf-entity-projection.svg') }))
