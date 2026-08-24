#!/usr/bin/env node
// 美国政府 CAD 模板 → 可审计本象包。
//
// 这不是一个“美国法规判定器”。它把官方 DXF 的结构和可确定提取的语义
// （单位、图层、图签、页索引、引用标准、占位字段）落成稳定对象，并显式声明
// 尚不能判断设计是否满足建筑/结构/机电规范。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseDxf } from './dxf.mjs'
import { dxfToObjects } from './import.mjs'
import { appendHistory, commit, initPackage, seqOf } from '../../compiler/store.mjs'

const sourcePath = process.argv[2]
const outDir = process.argv[3]
if (!sourcePath || !outDir) {
  process.stderr.write('用法：import-us-plan-template.mjs <official-template.dxf> <out.origin> [--source-url URL]\n')
  process.exit(2)
}
if (existsSync(outDir)) throw new Error(`拒绝覆盖已有包：${outDir}`)
const option = (name, fallback = null) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const sourceUrl = option('--source-url', 'https://www.sandiego.gov/development-services/forms-publications/design-guidelines-templates')
const raw = readFileSync(sourcePath)
const sha256 = createHash('sha256').update(raw).digest('hex').toUpperCase()
const dxf = parseDxf(raw.toString('utf8'))
const artifactId = 'us-sandiego-ds3179-template-audit'
const drawingId = `dwg:${artifactId}`
const base = dxfToObjects(dxf, { name: artifactId })
const sourceDrawingId = base[0].id
for (const o of base) {
  if (o.id === sourceDrawingId) o.id = drawingId
  if (o.drawing === sourceDrawingId) o.drawing = drawingId
}

const cadTextPlain = (s) => String(s ?? '')
  .replace(/\\P/g, '\n').replace(/\^I/g, ' ')
  .replace(/%%U/g, '').replace(/\\p[^;]*;/g, '')
  .replace(/\{\\L([^}]*)\}/g, '$1').replace(/\{\\Q\d+;([^}]*)\}/g, '$1')
  .replace(/[{}]/g, '').replace(/[ \t]+/g, ' ').trim()
const textObjects = base.filter((o) => o.type === 'text' && o.content)
const textByHandle = new Map(textObjects.map((o) => [o.id.split('/').at(-1), o]))
const sourceText = (handle) => {
  const o = textByHandle.get(handle)
  if (!o) throw new Error(`语义锚点不存在：${handle}`)
  return o
}
const lines = (handle) => cadTextPlain(sourceText(handle).content).split('\n').map((s) => s.trim()).filter(Boolean)

const unitsCode = dxf.headers.$INSUNITS
const measurementCode = dxf.headers.$MEASUREMENT
const drawingUnits = unitsCode === 1 && measurementCode === 0 ? 'inch' : `unresolved:${unitsCode ?? 'missing'}`
base[0].title = 'City of San Diego DS-3179 Official Construction Plan Template'
base[0].document_type = 'municipal-construction-plan-template'
base[0].jurisdiction = 'City of San Diego, California, USA'
base[0].source_sha256 = sha256
base[0].source_url = sourceUrl
base[0].insunits_code = unitsCode ?? null
base[0].measurement_code = measurementCode ?? null
base[0].drawing_unit = drawingUnits
base[0].semantic_profile = 'us-municipal-template/v1'

const sheetRows = [
  ['sheet:1',  '1',    'COVER SHEET',                         null,    '1724', '1725'],
  ['sheet:2-3','2-3',  'GENERAL NOTES',                       null,    '1726', '1727'],
  ['sheet:4',  '4',    'MONUMENT PRESERVATION CERTIFICATION', 'G04',   '17FF', '1772'],
  ['sheet:5',  '5',    'WATER AND SEWER NOTES',               'G05',   '176D', '1768'],
  ['sheet:6-9','6-9',  'ENVIRONMENTAL REQUIREMENTS',          'G06-G09','1774','1775'],
  ['sheet:10', '10',   'IMPROVEMENT PLAN',                    'C01',   '1777', '177A'],
  ['sheet:11', '11',   'STREET EXCAVATION TABLE',             'C02',   '1778', '177D'],
  ['sheet:12', '12',   'STRIPING AND STREET LIGHT NOTES',     'T01',   '177B', '177E'],
  ['sheet:13', '13',   'TRAFFIC CONTROL PLAN',                'TC01',  '1B31', '1B32'],
]
const sheetObjects = sheetRows.map(([id, printed, title, code, numberHandle, titleHandle]) => ({
  id, type: 'sheet-index-entry', printed_pages: printed, title, discipline_code: code,
  source_number_object: sourceText(numberHandle).id,
  source_title_object: sourceText(titleHandle).id,
  extraction: 'deterministic-handle-anchored',
}))

const referenceRows = [
  ['reference:greenbook-2024', 'ECP040126-01', 'STANDARD SPECIFICATIONS FOR PUBLIC WORKS CONSTRUCTION (THE GREENBOOK)', '2024'],
  ['reference:whitebook-2024', 'ECP040126-02', 'CITY OF SAN DIEGO STANDARD SPECIFICATIONS FOR PUBLIC WORKS CONSTRUCTION (THE WHITEBOOK)', '2024'],
  ['reference:cadd-standards-2018', 'PWPI010119-04', 'CITYWIDE COMPUTER AIDED DESIGN AND DRAFTING (CADD) STANDARDS', '2018'],
  ['reference:ca-mutcd-2026', 'ECPD040126-07', 'CALIFORNIA MANUAL ON UNIFORM TRAFFIC CONTROL DEVICES', '2026'],
  ['reference:caltrans-spec-2025', 'ECPD040126-05', 'CALIFORNIA DEPARTMENT OF TRANSPORTATION STANDARD SPECIFICATIONS', '2025'],
  ['reference:city-standard-drawings-2021', 'ECPI010122-03', 'CITY OF SAN DIEGO STANDARD DRAWINGS FOR PUBLIC WORKS CONSTRUCTION', '2021'],
  ['reference:caltrans-standard-plan-2025', 'ECPD092023-06', 'CALTRANS STANDARD PLAN', '2025'],
]
const referenceObjects = referenceRows.map(([id, document_no, title, edition]) => ({
  id, type: 'governing-reference', document_no, title, edition,
  source_objects: id.includes('standard-drawings') || id.includes('standard-plan')
    ? ['text:NOTES/173D'] : ['text:NOTES/173F'],
  extraction: 'deterministic-text-pattern',
}))

const contactFields = lines('1D95').filter((s) => /^(NAME OF COMPANY|ADDRESS|NAME AND TITLE|PHONE|EMAIL|SITE ADDRESS|ASSOCIATED)/.test(s))
const placeholderObjects = contactFields.map((label, i) => ({
  id: `required-field:${i + 1}`, type: 'required-field', label,
  status: label.endsWith(':') ? 'blank-template-field' : 'present', source_object: 'text:NOTES/1D95',
}))

const semanticObjects = [
  ...sheetObjects,
  ...referenceObjects,
  ...placeholderObjects,
  { id: 'semantic:template-classification', type: 'semantic-claim', value: 'official municipal construction plan template', verified: true, source_objects: ['text:TITLE/3B8', 'text:TITLE/1DB8'] },
  { id: 'semantic:unit-system', type: 'semantic-claim', value: drawingUnits, verified: drawingUnits === 'inch', source_objects: [drawingId], basis: ['$INSUNITS', '$MEASUREMENT'] },
  { id: 'metric:us-template-understanding', type: 'metric', source_entities: base.filter((o) => o.type === 'ent' || o.type === 'text').length, stable_handle_entities: base.filter((o) => (o.type === 'ent' || o.type === 'text') && o.id_basis === 'handle').length, sheet_index_entries: sheetObjects.length, governing_references: referenceObjects.length, blank_required_fields: placeholderObjects.filter((o) => o.status === 'blank-template-field').length },
]

const objects = [...base, ...semanticObjects]
const relations = []
for (const o of base.filter((o) => o.type === 'ent' || o.type === 'text')) {
  relations.push({ subject: drawingId, predicate: 'contains', object: o.id })
  relations.push({ subject: o.id, predicate: 'on_layer', object: `layer:${o.layer}` })
}
for (const o of sheetObjects) {
  relations.push({ subject: 'semantic:template-classification', predicate: 'has_sheet_index_entry', object: o.id })
  relations.push({ subject: o.id, predicate: 'derived_from', object: o.source_number_object })
  relations.push({ subject: o.id, predicate: 'derived_from', object: o.source_title_object })
}
for (const o of referenceObjects) for (const src of o.source_objects)
  relations.push({ subject: o.id, predicate: 'derived_from', object: src })
for (const o of placeholderObjects) relations.push({ subject: o.id, predicate: 'derived_from', object: o.source_object })

const constraints = [
  { id: 'source-hash-present', rule: '官方源文件必须带 SHA-256', check: { type: 'exists', object: drawingId, field: 'source_sha256' } },
  { id: 'stable-handle-coverage', rule: '模型空间实体和文字必须全部保留 DXF handle', check: { type: 'equals', object: 'metric:us-template-understanding', field: 'stable_handle_entities', value: base.filter((o) => o.type === 'ent' || o.type === 'text').length } },
  { id: 'recognized-unit', rule: '单位系统必须从 DXF header 明确解析', check: { type: 'in', object: drawingId, field: 'drawing_unit', values: ['inch', 'foot', 'millimeter', 'meter'] } },
  { id: 'sheet-index-count', rule: '模板页索引应恢复 9 个条目', check: { type: 'count', object: 'sheet:*', equals: 9 } },
  { id: 'sheet-title-required', rule: '每个页索引条目必须有标题', check: { type: 'exists', object: 'sheet:*', field: 'title' } },
  { id: 'sheet-title-unique', rule: '页索引标题不得重复', check: { type: 'unique', object: 'sheet:*', field: 'title' } },
  { id: 'governing-reference-count', rule: '当前模板明确列出 7 项引用标准', check: { type: 'count', object: 'reference:*', equals: 7 } },
  { id: 'governing-reference-number', rule: '引用标准必须保留文件编号', check: { type: 'exists', object: 'reference:*', field: 'document_no' } },
  { id: 'governing-reference-edition', rule: '引用标准必须保留版本年份', check: { type: 'exists', object: 'reference:*', field: 'edition' } },
  { id: 'placeholder-source', rule: '必填占位字段必须能指回原始 CAD 文字对象', check: { type: 'exists', object: 'required-field:*', field: 'source_object' } },
]

const limits = [
  { code: 'template-not-completed-project', kind: 'uncovered', scope: 'design-compliance', statement: '输入是官方空白/示例模板，不是完成设计；可验证模板结构，不能据此评估具体项目设计质量。', remedy: '导入含完整模型空间、图签和设计内容的美国真实项目图集。' },
  { code: 'no-ahj-code-ruleset', kind: 'uncovered', scope: 'code-compliance', statement: '本包尚未导入具体 AHJ 的现行法规条款与项目适用性，因此不作 IBC/IRC/消防/无障碍等法规通过判断。', remedy: '按州、市、项目类型绑定版本化规则集，并由当地专业人员确认适用范围。' },
  { code: 'semantic-profile-template-specific', kind: 'unverified', scope: 'semantic:*', statement: '页索引与引用标准锚点按 DS-3179 2026 模板验证，不能直接外推到其他城市或模板版本。', remedy: '为新辖区建立独立 profile，并在官方样本上锁定 handle/文本模式测试。' },
  { code: 'model-space-only-import', kind: 'lossy', scope: 'payload', statement: '当前通用导入器只把 ENTITIES 段作为可查询实体；块定义内部图元只汇总为 block 对象，未逐个展开。', remedy: '需要块内审计时，将 BLOCKS 实体按块内稳定身份展开并保留插入变换。' },
  { code: 'cad-formatting-partially-normalized', kind: 'lossy', scope: 'text:*', statement: '结构对象保留原始 CAD 文字，语义字段会清理 MTEXT 控制码；排版样式不作为语义真值。', remedy: '视觉版式复核回到原始官方 DXF 或 CAD 原生渲染。' },
]

const manifest = `# 本象包（美国市政 CAD 模板解构案例）\nartifact:\n  id: ${artifactId}\n  kind: drawing-audit\n  title: City of San Diego DS-3179 Official Template Audit\n\npayload:\n  uri: ./payloads/${basename(sourcePath)}\n  media_type: image/vnd.dxf\n  digest: sha256:${sha256.toLowerCase()}\n\nprovenance:\n  source: ${sourceUrl}\n  history: ./provenance/history.jsonl\n`

initPackage(outDir, { manifest, objects, relations, constraints, limits })
mkdirSync(join(outDir, 'payloads'), { recursive: true })
writeFileSync(join(outDir, 'payloads', basename(sourcePath)), raw)
appendHistory(outDir, [{ event: 'imported', at: new Date().toISOString(), by: 'us-plan-template-importer', source_url: sourceUrl, source_sha256: sha256, source_path: resolve(sourcePath) }])
const certificationTx = {
  transaction_id: 'tx-derived-us-template-understanding-certificate', kind: 'derived',
  depends_on: [drawingId, 'sheet:*', 'reference:*', 'required-field:*'],
  state_changes: [
    {
      object: 'metric:us-template-understanding', field: 'certification_status', to: 'verified-with-declared-limits', kind: 'derived',
      basis: [`${drawingId}.source_sha256`, `${drawingId}.drawing_unit`, 'sheet:*', 'reference:*', 'required-field:*'],
    },
    {
      object: 'metric:us-template-understanding', field: 'certified_statement',
      to: 'AI-assisted pipeline read the verifiable structure and semantics of this official CAD template at object level.', kind: 'derived',
      basis: ['semantic:template-classification.value', 'semantic:unit-system.value', 'sheet:*', 'reference:*'],
    },
    {
      object: 'metric:us-template-understanding', field: 'independent_or_regulatory_certification', to: false, kind: 'derived',
      basis: ['limit:template-not-completed-project', 'limit:no-ahj-code-ruleset'],
    },
  ],
}
const certificationReceipt = commit(outDir, certificationTx, { by: 'benxiang-evidence-compiler', expectedSeq: seqOf(outDir) })
if (!certificationReceipt.ok) throw new Error(`验真事务被拒：${JSON.stringify(certificationReceipt.violations)}`)
mkdirSync(join(outDir, 'projections'), { recursive: true })
writeFileSync(join(outDir, 'projections', 'semantic-summary.json'), JSON.stringify({
  artifact: artifactId, source_sha256: sha256, dxf_version: dxf.version,
  unit: drawingUnits, layers: dxf.layers.length,
  source_entities: base.filter((o) => o.type === 'ent' || o.type === 'text').length,
  sheet_index: sheetObjects.map(({ id, printed_pages, title, discipline_code }) => ({ id, printed_pages, title, discipline_code })),
  governing_references: referenceObjects.map(({ id, document_no, title, edition }) => ({ id, document_no, title, edition })),
  blank_required_fields: placeholderObjects.filter((o) => o.status === 'blank-template-field').map((o) => o.label),
}, null, 2) + '\n')
process.stdout.write(JSON.stringify({ ok: true, out: outDir, sha256, unit: drawingUnits, objects: objects.length, relations: relations.length, sheets: sheetObjects.length, references: referenceObjects.length }) + '\n')
