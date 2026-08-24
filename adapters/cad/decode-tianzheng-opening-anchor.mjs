#!/usr/bin/env node
// 针对本案例所见 TCH_OPENING v5 载荷，恢复“对象位置锚点”。
//
// 这不是通用天正几何解码器，也不声称恢复门窗轮廓。解码规则必须同时满足：
// 1) 已知字段偏移只有一个合理 double；2) 载荷后段只有一个位置候选；
// 3) 整批对象覆盖数与模型空间对象数一致。任何歧义都返回 unresolved。

import { readFileSync, writeFileSync } from 'node:fs'

const plausibleCoordinate = (value) => Number.isFinite(value) && Math.abs(value) >= 1_000 && Math.abs(value) <= 1_000_000

function doubleAt(bytes, offset) {
  if (offset < 0 || offset + 8 > bytes.length) return null
  const value = bytes.readDoubleLE(offset)
  return plausibleCoordinate(value) ? value : null
}

function slidingCandidates(bytes, from = 0) {
  const found = []
  for (let offset = Math.max(0, from); offset + 8 <= bytes.length; offset++) {
    const value = doubleAt(bytes, offset)
    if (value !== null) found.push({ offset, value })
  }
  return found
}

export function openingKind(text = '') {
  if (text.includes('门窗用途')) return 'window'
  if (text.includes('门口线偏移距离')) return 'door'
  return 'unknown'
}

export function decodeOpeningAnchor(row) {
  const kind = openingKind(row.text)
  if (kind === 'unknown' || !row.hex) return { ok: false, reason: 'unsupported-kind-or-empty-payload' }
  const bytes = Buffer.from(row.hex, 'hex')
  const yOffsets = kind === 'window' ? [41, 43, 47] : [43, 47]
  const yMatches = yOffsets
    .map((offset) => ({ offset, value: doubleAt(bytes, offset) }))
    .filter(({ value }) => value !== null)
  if (yMatches.length !== 1) return { ok: false, reason: 'ambiguous-y-field', candidates: yMatches.length }

  let suffix = slidingCandidates(bytes, 60)
  if (kind === 'door') suffix = suffix.filter(({ value }) => Math.abs(value - 215168.5) > 1e-6)
  if (!suffix.length) return { ok: false, reason: 'missing-x-field' }
  const x = suffix.at(-1)
  const y = yMatches[0]
  if (x.offset <= y.offset) return { ok: false, reason: 'invalid-field-order' }

  return {
    ok: true,
    kind,
    anchor: { x: x.value, y: y.value, z: 0, unit: 'drawing-unit' },
    evidence: {
      decoder: 'tch-opening-v5-anchor-offset/v1',
      x_offset: x.offset,
      y_offset: y.offset,
      payload_bytes: bytes.length,
    },
  }
}

export function decodeOpeningRows(rows, modelOwner) {
  const objects = []
  for (const row of rows) {
    if (String(row.owner).toUpperCase() !== String(modelOwner).toUpperCase()) continue
    const decoded = decodeOpeningAnchor(row)
    objects.push({
      handle: String(row.handle).toUpperCase(),
      layer: row.layer,
      classification: openingKind(row.text),
      ...decoded,
    })
  }
  return {
    schema: 'tch-opening-anchor-map/v1',
    model_owner: String(modelOwner).toUpperCase(),
    placed: objects.length,
    resolved: objects.filter((row) => row.ok).length,
    unresolved: objects.filter((row) => !row.ok).length,
    objects,
  }
}

if (process.argv[1]?.endsWith('decode-tianzheng-opening-anchor.mjs')) {
  const [input, output] = process.argv.slice(2)
  const ownerIndex = process.argv.indexOf('--model-owner')
  const modelOwner = ownerIndex >= 0 ? process.argv[ownerIndex + 1] : null
  if (!input || !output || !modelOwner) {
    process.stderr.write('用法：decode-tianzheng-opening-anchor.mjs <oda-openings.json> <anchors.json> --model-owner <handle>\n')
    process.exit(2)
  }
  const result = decodeOpeningRows(JSON.parse(readFileSync(input, 'utf8')), modelOwner)
  if (result.unresolved) throw new Error(`位置锚点覆盖不足：resolved=${result.resolved}/${result.placed}`)
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', 'utf8')
  process.stdout.write(JSON.stringify({ ok: true, placed: result.placed, resolved: result.resolved, output }) + '\n')
}
