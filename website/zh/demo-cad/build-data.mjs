#!/usr/bin/env node
// 用真实的 adapters/cad 解析管线，把两份公开 DXF fixture（C-101 / C-101-v2）解析成对象图，
// 打包成静态 data.js 给浏览器 demo 直接加载。不新建案例包——C-101/C-101-v2 本身就是仓库里
// 已公开的 fixture（adapters/cad/fixtures/），直接调用真实解析函数 parseDxf + dxfToObjects，
// 与 CLI `node adapters/cad/import.mjs` 走的是同一段代码，不是重新实现的近似版。
//
//   node website/zh/demo-cad/build-data.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDxf } from '../../../adapters/cad/dxf.mjs'
import { dxfToObjects } from '../../../adapters/cad/import.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')
const fixtureDir = join(repo, 'adapters/cad/fixtures')

function loadDrawing(name) {
  const path = join(fixtureDir, name + '.dxf')
  const text = readFileSync(path, 'utf8')
  const dxf = parseDxf(text)
  const objects = dxfToObjects(dxf, { name })
  return { objects, sha256: createHash('sha256').update(text).digest('hex') }
}

const oldDwg = loadDrawing('C-101')
const newDwg = loadDrawing('C-101-v2')

const data = {
  fixtures: 'adapters/cad/fixtures/{C-101,C-101-v2}.dxf',
  generated_at: new Date().toISOString(),
  sources: { 'C-101.dxf': oldDwg.sha256, 'C-101-v2.dxf': newDwg.sha256 },
  old: oldDwg.objects,
  neu: newDwg.objects,
}

const out = join(here, 'data.js')
writeFileSync(out,
  '// 由 build-data.mjs 用真实 adapters/cad/dxf.mjs + import.mjs 解析 ' + data.fixtures + ' 生成，请勿手改；\n'
  + '// 重新生成：node website/zh/demo-cad/build-data.mjs\n'
  + 'window.CAD_DEMO_DATA = ' + JSON.stringify(data, null, 0) + ';\n')
process.stderr.write(`写出 ${out}：旧版 ${oldDwg.objects.length} 对象，新版 ${newDwg.objects.length} 对象\n`)
