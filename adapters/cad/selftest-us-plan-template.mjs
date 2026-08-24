import assert from 'node:assert/strict'
import { parseDxf } from './dxf.mjs'

const fixture = `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1032\n9\n$INSUNITS\n70\n1\n9\n$MEASUREMENT\n70\n0\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nTEXT\n5\nA1\n8\nTITLE\n10\n1\n20\n2\n40\n0.1\n1\nCOVER SHEET\n0\nENDSEC\n0\nEOF\n`
const dxf = parseDxf(fixture)
assert.equal(dxf.version, 'AC1032')
assert.equal(dxf.headers.$INSUNITS, 1)
assert.equal(dxf.headers.$MEASUREMENT, 0)
assert.equal(dxf.entities[0].handle, 'A1')
console.log('us plan template selftest: 4/4')
