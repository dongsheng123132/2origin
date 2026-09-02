#!/usr/bin/env node
// 把 cases/xlsx-budget-model-audit.origin/ 里的真实包数据打包成静态 data.js，供浏览器 demo 直接加载。
//
//   node website/zh/demo-xlsx/build-data.mjs
//
// 不做任何加工：objects.jsonl / relations.jsonl / constraints.json / limits.json / history.jsonl
// 原样进入 data.js。另附案例包 projections/ 里的三份参考产物（diagnose.txt、stale-after-tx.json、
// trace-汇总-B3.txt），只用于页面内的「浏览器重算 vs 案例包记录」比对，不参与计算。
//
// 输出用 `window.XLSX_DEMO_DATA = …` 而不是 fetch json——file:// 直接双击打开也能跑，
// 与「纯静态托管、无构建步骤」的部署条件一致。零依赖，只用 node 内置模块。

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')
const pkg = join(repo, 'cases/xlsx-budget-model-audit.origin')

const read = (rel) => readFileSync(join(pkg, rel), 'utf8')
const jsonl = (rel) => read(rel).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
const sha = (rel) => createHash('sha256').update(readFileSync(join(pkg, rel))).digest('hex')

const files = [
  'graph/objects.jsonl', 'graph/relations.jsonl', 'graph/constraints.json', 'graph/limits.json',
  'provenance/history.jsonl',
  'projections/diagnose.txt', 'projections/stale-after-tx.json', 'projections/trace-汇总-B3.txt',
]

const data = {
  package: 'cases/xlsx-budget-model-audit.origin',
  generated_at: new Date().toISOString(),
  sources: Object.fromEntries(files.map((f) => [f, sha(f)])),
  objects: jsonl('graph/objects.jsonl'),
  relations: jsonl('graph/relations.jsonl'),
  constraints: JSON.parse(read('graph/constraints.json')),
  limits: JSON.parse(read('graph/limits.json')),
  history: jsonl('provenance/history.jsonl'),
  reference: {
    diagnose_txt: read('projections/diagnose.txt'),
    stale_after_tx: JSON.parse(read('projections/stale-after-tx.json')),
    trace_txt: read('projections/trace-汇总-B3.txt'),
  },
}

const out = join(here, 'data.js')
writeFileSync(out,
  '// 由 build-data.mjs 从 ' + data.package + ' 原样打包生成，请勿手改；重新生成：node website/zh/demo-xlsx/build-data.mjs\n'
  + 'window.XLSX_DEMO_DATA = ' + JSON.stringify(data, null, 0) + ';\n')
process.stderr.write(`写出 ${out}：对象 ${data.objects.length}，关系 ${data.relations.length}，约束 ${data.constraints.length}，边界 ${data.limits.length}，history ${data.history.length}\n`)
