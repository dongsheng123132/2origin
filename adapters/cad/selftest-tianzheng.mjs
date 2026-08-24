import assert from 'node:assert/strict'
import { classifyProxyPayload, summarizeRows, rowsToOrigin } from './import-tianzheng.mjs'
import { decodeOpeningAnchor, decodeOpeningRows } from './decode-tianzheng-opening-anchor.mjs'

assert.equal(classifyProxyPayload('xx门窗用途yy'), 'window')
assert.equal(classifyProxyPayload('xx门口线偏移距离yy'), 'door')
assert.equal(classifyProxyPayload('opaque'), 'unknown')

const rows = [
  { handle: 'A1', owner: '2', layer: 'WINDOW', bytes: 3, text: '门窗用途', hex: '010203' },
  { handle: 'A2', owner: '2', layer: 'WINDOW', bytes: 3, text: '门窗用途', hex: '010204' },
  { handle: 'A3', owner: '2', layer: 'DOOR', bytes: 3, text: '门口线偏移距离', hex: '010205' },
  { handle: 'A4', owner: 'FF', layer: 'WINDOW', bytes: 3, text: '门窗用途', hex: '010206' },
]
const summary = summarizeRows(rows, '2')
assert.deepEqual(
  { total: summary.total, placed: summary.placed, excluded: summary.excluded, windows: summary.windows, doors: summary.doors, unknown: summary.unknown },
  { total: 4, placed: 3, excluded: 1, windows: 2, doors: 1, unknown: 0 },
)

const built = rowsToOrigin(rows, {
  artifactId: 'fixture', modelOwner: '2',
  source: { sha256: 'a'.repeat(64), bytes: 10, magic: 'AC1018', extractSha256: 'b'.repeat(64), libredwg: { count: 4, sha256: 'c'.repeat(64) } },
})
assert.equal(built.objects.filter((o) => o.type === 'tch_opening').length, 4)
assert.equal(built.objects.filter((o) => o.id.startsWith('membership:window/')).length, 2)
assert.ok(built.limits.some((l) => l.code === 'glass-material-not-resolved'))
assert.ok(built.objects.every((o) => !('text' in o) && !('hex' in o)))

const windowPayload = Buffer.alloc(130)
windowPayload.writeDoubleLE(71_073.835, 43)
windowPayload.writeDoubleLE(-85_489.27, 87)
const decodedWindow = decodeOpeningAnchor({ text: '门窗用途', hex: windowPayload.toString('hex') })
assert.equal(decodedWindow.ok, true)
assert.deepEqual(decodedWindow.anchor, { x: -85_489.27, y: 71_073.835, z: 0, unit: 'drawing-unit' })

const doorPayload = Buffer.alloc(170)
doorPayload.writeDoubleLE(70_415.761, 47)
doorPayload.writeDoubleLE(62_388.262, 119)
doorPayload.writeDoubleLE(215_168.5, 152)
const decodedDoor = decodeOpeningAnchor({ text: '门口线偏移距离', hex: doorPayload.toString('hex') })
assert.equal(decodedDoor.ok, true)
assert.deepEqual(decodedDoor.anchor, { x: 62_388.262, y: 70_415.761, z: 0, unit: 'drawing-unit' })

const decodedRows = decodeOpeningRows([
  { handle: 'W1', owner: '2', layer: 'WINDOW', text: '门窗用途', hex: windowPayload.toString('hex') },
  { handle: 'D1', owner: '2', layer: 'DOOR', text: '门口线偏移距离', hex: doorPayload.toString('hex') },
], '2')
assert.deepEqual({ placed: decodedRows.placed, resolved: decodedRows.resolved, unresolved: decodedRows.unresolved }, { placed: 2, resolved: 2, unresolved: 0 })

console.log('tianzheng importer selftest: 15/15')
