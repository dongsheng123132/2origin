#!/usr/bin/env node
// 天正 DWG 代理对象 → 本象包。
//
// 这条导入链不假装“直接理解全部 DWG”。ODA 离线转换器负责把私有 DWG 转为 DXF，
// ezdxf 负责抽取 ACAD_PROXY_ENTITY；本导入器只接收已抽出的 TCH_OPENING 记录，
// 把稳定 handle、owner、layer、分类、载荷指纹、独立解析器观察与边界写进 .origin。
// 原始文件路径、客户名、代理对象原始字节与图纸文字都不进入可发布包。

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { initPackage, appendHistory, commit, seqOf } from '../../compiler/store.mjs'
import { limit } from '../../compiler/limits.mjs'
import { decodeOpeningRows } from './decode-tianzheng-opening-anchor.mjs'

const slug = (value) => String(value ?? 'unknown').replace(/[\s:/*]+/g, '_')

export function classifyProxyPayload(text = '') {
  if (text.includes('门窗用途')) return 'window'
  if (text.includes('门口线偏移距离')) return 'door'
  return 'unknown'
}

export function summarizeRows(rows, modelOwner) {
  const normalized = rows.map((row) => ({ ...row, classification: classifyProxyPayload(row.text) }))
  const placed = normalized.filter((row) => String(row.owner).toUpperCase() === String(modelOwner).toUpperCase())
  const excluded = normalized.filter((row) => String(row.owner).toUpperCase() !== String(modelOwner).toUpperCase())
  return {
    rows: normalized,
    total: normalized.length,
    placed: placed.length,
    excluded: excluded.length,
    windows: placed.filter((row) => row.classification === 'window').length,
    doors: placed.filter((row) => row.classification === 'door').length,
    unknown: placed.filter((row) => row.classification === 'unknown').length,
  }
}

function payloadDigest(row) {
  const bytes = row.hex ? Buffer.from(row.hex, 'hex') : Buffer.from(String(row.text ?? ''), 'utf8')
  return createHash('sha256').update(bytes).digest('hex')
}

export function rowsToOrigin(rows, { artifactId, modelOwner, source }) {
  const summary = summarizeRows(rows, modelOwner)
  const positions = decodeOpeningRows(rows, modelOwner)
  const positionByHandle = new Map(positions.objects.map((row) => [row.handle, row]))
  const layerNames = [...new Set(summary.rows.map((row) => row.layer))].sort()
  const objects = [
    {
      id: `dwg:${artifactId}`, type: 'dwg', title: '脱敏厂房门窗审计',
      source_withheld: true, source_sha256: source.sha256, source_bytes: source.bytes,
      dwg_magic: source.magic, model_space_owner: modelOwner,
    },
    {
      id: 'observation:oda-tch-opening', type: 'observation', parser: 'ODA File Converter 27.1 + ezdxf',
      class: 'TCH_OPENING', proxy_class_number: 528, total: summary.total,
      placed: summary.placed, block_definition_only: summary.excluded,
      windows: summary.windows, doors: summary.doors, unknown: summary.unknown,
      extract_sha256: source.extractSha256,
    },
    {
      id: 'observation:tch-opening-position-anchor', type: 'observation',
      decoder: 'tch-opening-v5-anchor-offset/v1', placed: positions.placed,
      resolved: positions.resolved, unresolved: positions.unresolved,
      scope: 'position-anchor-not-exact-outline',
    },
    ...(source.libredwg ? [{
      id: 'observation:libredwg-class-528', type: 'observation', parser: 'GNU LibreDWG 0.14',
      class_number: 528, total: source.libredwg.count, observation_sha256: source.libredwg.sha256,
    }] : []),
    {
      id: 'metric:door-window-count', type: 'metric',
      total_openings: 0, placed_openings: 0, block_definition_only: 0,
      windows: 0, doors: 0, unknown: 0,
      position_resolved: 0, position_unresolved: 0,
      unit: 'opening-object',
    },
    ...layerNames.map((name) => ({ id: `layer:${slug(name)}`, type: 'layer', name })),
  ]
  const relations = []

  for (const row of summary.rows) {
    const handle = String(row.handle).toUpperCase()
    const placed = String(row.owner).toUpperCase() === String(modelOwner).toUpperCase()
    const id = `opening:${handle}`
    const positioned = placed ? positionByHandle.get(handle) : null
    objects.push({
      id, type: 'tch_opening', handle, layer: row.layer,
      owner: String(row.owner).toUpperCase(), owner_space: placed ? 'model_space' : 'block_definition',
      classification: placed ? row.classification : 'not_placed',
      payload_bytes: Number(row.bytes ?? 0), payload_sha256: payloadDigest(row),
      source_observation: 'observation:oda-tch-opening',
      ...(positioned?.ok ? {
        position_anchor: null,
        position_evidence: positioned.evidence,
        position_observation: 'observation:tch-opening-position-anchor',
      } : {}),
    })
    relations.push({ subject: `dwg:${artifactId}`, predicate: 'contains', object: id })
    relations.push({ subject: id, predicate: 'on_layer', object: `layer:${slug(row.layer)}` })

    const membership = placed ? `membership:placed/${handle}` : `membership:block-definition/${handle}`
    objects.push({ id: membership, type: 'membership', opening: id })
    if (placed) {
      objects.push({ id: `membership:${row.classification}/${handle}`, type: 'membership', opening: id })
      objects.push({ id: `membership:position-${positioned?.ok ? 'resolved' : 'unresolved'}/${handle}`, type: 'membership', opening: id })
    }
  }

  const constraints = [
    { id: 'opening-total-matches-metric', rule: 'TCH_OPENING 对象总数必须等于汇总数', check: { type: 'count', object: 'opening:*', equals_ref: 'metric:door-window-count.total_openings' } },
    { id: 'placed-matches-metric', rule: '模型空间放置数必须等于汇总数', check: { type: 'count', object: 'membership:placed/*', equals_ref: 'metric:door-window-count.placed_openings' } },
    { id: 'block-definition-matches-metric', rule: '块定义排除数必须等于汇总数', check: { type: 'count', object: 'membership:block-definition/*', equals_ref: 'metric:door-window-count.block_definition_only' } },
    { id: 'window-matches-metric', rule: '窗对象数必须等于汇总数', check: { type: 'count', object: 'membership:window/*', equals_ref: 'metric:door-window-count.windows' } },
    { id: 'door-matches-metric', rule: '门对象数必须等于汇总数', check: { type: 'count', object: 'membership:door/*', equals_ref: 'metric:door-window-count.doors' } },
    { id: 'unknown-matches-metric', rule: '未分类对象数必须等于汇总数', check: { type: 'count', object: 'membership:unknown/*', equals_ref: 'metric:door-window-count.unknown' } },
    { id: 'position-resolved-matches-metric', rule: '已恢复位置锚点数必须等于汇总数', check: { type: 'count', object: 'membership:position-resolved/*', equals_ref: 'metric:door-window-count.position_resolved' } },
    { id: 'position-unresolved-matches-metric', rule: '未恢复位置锚点数必须等于汇总数', check: { type: 'count', object: 'membership:position-unresolved/*', equals_ref: 'metric:door-window-count.position_unresolved' } },
  ]

  const limits = [
    limit('tianzheng-version-specific-classifier', 'unverified', 'opening:*.classification',
      '窗/门分类依赖这份图中天正代理载荷出现的“门窗用途”与“门口线偏移距离”字段；尚未验证所有天正版本都采用相同编码。',
      '收集不同天正版本的脱敏样本，按版本登记解码器并加入交叉测试。'),
    limit('glass-material-not-resolved', 'uncovered', 'metric:door-window-count.windows',
      '168 的单位是窗樘/窗洞对象，不是玻璃分格或采购块数；其中包含被建模为窗的百叶窗。',
      '导入门窗材料表，按材质与构造类型继续拆分百叶、幕墙和玻璃窗。'),
    limit('block-owner-file-specific', 'unverified', 'opening:*.owner_space',
      `模型空间 owner=${modelOwner} 由本文件离线转换结果确认，不应直接套用到另一份图。`,
      '导入下一份图时从 BLOCK_RECORD 表解析 *Model_Space 的 handle，并显式传入。'),
    limit('exact-opening-outline-not-resolved', 'lossy', 'opening:*.position_anchor',
      '本包已恢复每个模型空间门窗对象的位置锚点，可落回脱敏原图复核；尚未恢复对象自身的精确轮廓、朝向与 bbox。',
      '在带匹配天正解释器的 CAD 环境中导出可读实体，按 handle 回填 exact_bbox 并与位置锚点交叉验证。'),
    limit('position-decoder-file-version-specific', 'unverified', 'opening:*.position_anchor',
      '位置解码器依据本文件 TCH_OPENING v5 载荷的重复字段偏移建立，并已在本文件 190/190 个模型空间对象上无歧义解析；不能直接外推到其他天正版本。',
      '新文件必须重新跑覆盖闸门与脱敏叠加图复核；出现任一歧义即拒绝把位置写成已解析事实。'),
    limit('source-withheld', 'uncovered', 'payload',
      '客户原始 DWG、文件名、路径、图签与文字没有进入可发布包；包内只能按 SHA-256 对回受控原件。',
      '复核人员在客户授权的本机环境中使用同一 SHA-256 原件重新导入。'),
    limit('crosscheck-total-only', 'uncovered', 'observation:libredwg-class-528',
      'GNU LibreDWG 独立链只交叉确认 class 528 对象总数 194；168/22 分类来自 ODA 代理载荷字段，并非两条解析器独立分类。',
      '为 LibreDWG 输出实现同一版本载荷解码，再逐 handle 比较分类。'),
  ]

  return { summary, positions, objects, relations, constraints, limits }
}

async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function countNeedle(path, needleText) {
  const needle = Buffer.from(needleText)
  let tail = Buffer.alloc(0)
  let count = 0
  for await (const chunk of createReadStream(path)) {
    const data = Buffer.concat([tail, chunk])
    let at = 0
    while ((at = data.indexOf(needle, at)) >= 0) { count++; at += needle.length }
    tail = data.subarray(Math.max(0, data.length - needle.length + 1))
  }
  return count
}

function manifest({ artifactId, source }) {
  return `# 本象包（天正 CAD 门窗审计；公开脱敏版）
artifact:
  id: ${artifactId}
  kind: drawing-audit
  title: 脱敏厂房门窗审计

payload:
  uri: withheld://sha256/${source.sha256}
  media_type: image/vnd.dwg

provenance:
  source: customer-controlled-original
  history: ./provenance/history.jsonl
`
}

function summaryProjection(summary, source, positions) {
  return `# 脱敏 CAD 门窗计数

| 项目 | 数量 |
|---|---:|
| 天正 TCH_OPENING 对象 | ${summary.total} |
| 仅在块定义中 | ${summary.excluded} |
| 模型空间实际门窗洞 | ${summary.placed} |
| 窗对象 | **${summary.windows}** |
| 门对象 | **${summary.doors}** |
| 未分类 | ${summary.unknown} |
| 已恢复位置锚点 | **${positions.resolved} / ${positions.placed}** |

- 源文件：客户受控，不进入本包。
- 源文件 SHA-256：\`${source.sha256.toUpperCase()}\`
- 单位：窗樘/窗洞对象，不是玻璃分格或采购块数。
- 边界：包含被建模为窗的百叶窗；“纯玻璃窗”需继续导入材料表。
`
}

async function main() {
  const [dwgPath, openingsPath, outDir] = process.argv.slice(2)
  if (!dwgPath || !openingsPath || !outDir) {
    process.stderr.write('用法：import-tianzheng.mjs <source.dwg> <oda-openings.json> <out.origin> --model-owner <handle> [--libredwg-json native.json] [--id cad-case]\n')
    process.exit(2)
  }
  if (existsSync(outDir)) throw new Error(`输出已存在，拒绝覆盖：${outDir}`)
  const option = (name, fallback = null) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback }
  const modelOwner = option('--model-owner')
  if (!modelOwner) throw new Error('必须显式给 --model-owner；不能把某份图的模型空间 handle 猜成通用事实')
  const artifactId = slug(option('--id', basename(outDir).replace(/\.origin$/i, '')))
  const rows = JSON.parse(readFileSync(openingsPath, 'utf8'))
  const head = readFileSync(dwgPath).subarray(0, 6).toString('latin1')
  const source = {
    sha256: await hashFile(dwgPath), bytes: statSync(dwgPath).size, magic: head,
    extractSha256: await hashFile(openingsPath),
  }

  const libre = option('--libredwg-json')
  if (libre) {
    source.libredwg = { count: await countNeedle(libre, '"type": 528'), sha256: await hashFile(libre) }
    if (source.libredwg.count !== rows.length)
      throw new Error(`独立解析器不一致：ODA=${rows.length}，LibreDWG=${source.libredwg.count}；拒绝发证`)
  }

  const built = rowsToOrigin(rows, { artifactId, modelOwner, source })
  if (built.positions.unresolved)
    throw new Error(`位置锚点覆盖不足：resolved=${built.positions.resolved}/${built.positions.placed}；拒绝生成可复核版 .origin`)
  initPackage(outDir, { manifest: manifest({ artifactId, source }), objects: built.objects, relations: built.relations, constraints: built.constraints, limits: built.limits })
  appendHistory(outDir, [{
    event: 'imported', at: new Date().toISOString(), by: 'tianzheng-import',
    source_sha256: source.sha256, source_withheld: true,
    oda_extract_sha256: source.extractSha256,
    libredwg_observation_sha256: source.libredwg?.sha256 ?? null,
  }])

  const s = built.summary
  const tx = {
    transaction_id: 'tx-derived-door-window-count', kind: 'derived',
    depends_on: ['observation:oda-tch-opening.total', 'observation:libredwg-class-528.total', 'observation:tch-opening-position-anchor.resolved', 'opening:*'],
    state_changes: [
      ['total_openings', s.total, ['observation:oda-tch-opening.total', 'observation:libredwg-class-528.total']],
      ['placed_openings', s.placed, ['membership:placed/*']],
      ['block_definition_only', s.excluded, ['membership:block-definition/*']],
      ['windows', s.windows, ['membership:window/*']],
      ['doors', s.doors, ['membership:door/*']],
      ['unknown', s.unknown, ['membership:unknown/*']],
      ['position_resolved', built.positions.resolved, ['membership:position-resolved/*']],
      ['position_unresolved', built.positions.unresolved, ['membership:position-unresolved/*']],
    ].map(([field, to, basis]) => ({ object: 'metric:door-window-count', field, to, kind: 'derived', basis })),
  }
  const receipt = commit(outDir, tx, { by: 'deterministic-count-compiler', expectedSeq: seqOf(outDir) })
  if (!receipt.ok) throw new Error(`汇总事务被拒：${JSON.stringify(receipt.violations)}`)

  const positionTx = {
    transaction_id: 'tx-derived-opening-position-anchors', kind: 'derived',
    depends_on: ['observation:tch-opening-position-anchor.decoder', 'opening:*.payload_sha256'],
    state_changes: built.positions.objects.filter((row) => row.ok).map((row) => ({
      object: `opening:${row.handle}`, field: 'position_anchor',
      from: null, to: row.anchor, kind: 'derived',
      basis: [`opening:${row.handle}.payload_sha256`, `opening:${row.handle}.position_evidence`, 'observation:tch-opening-position-anchor.decoder'],
    })),
  }
  const positionReceipt = commit(outDir, positionTx, { by: 'tch-opening-anchor-decoder', expectedSeq: seqOf(outDir) })
  if (!positionReceipt.ok) throw new Error(`位置事务被拒：${JSON.stringify(positionReceipt.violations)}`)

  mkdirSync(join(outDir, 'projections'), { recursive: true })
  writeFileSync(join(outDir, 'projections', 'summary.md'), summaryProjection(s, source, built.positions), 'utf8')
  process.stdout.write(JSON.stringify({
    ok: true, package: outDir, source_sha256: source.sha256.toUpperCase(),
    total: s.total, placed: s.placed, excluded: s.excluded,
    windows: s.windows, doors: s.doors, unknown: s.unknown,
    position_resolved: built.positions.resolved, position_unresolved: built.positions.unresolved,
    crosscheck_total: source.libredwg?.count ?? null,
  }) + '\n')
}

if (process.argv[1]?.endsWith('import-tianzheng.mjs')) {
  main().catch((error) => { process.stderr.write(`导入失败：${error.message}\n`); process.exit(1) })
}
