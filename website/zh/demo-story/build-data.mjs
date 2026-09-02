#!/usr/bin/env node
// 把 novels/月落渡口.origin/ 里真实在跑的连载案例包打包成静态 data.js，供浏览器 demo 直接加载。
//
//   node website/zh/demo-story/build-data.mjs
//
// 不做任何加工：objects.jsonl / constraints.json / limits.json / history.jsonl / gate-report.json
// 原样进入 data.js。另附两条示例事务（tx-legal-example.json 演示违规被拒、tx-accepted-example.json
// 演示合法通过）——文件名容易读反，页面只依据文件内的 text 字段说明预期结果，不依据文件名。
//
// 输出用 `window.STORY_DEMO_DATA = …` 而不是 fetch json——file:// 直接双击打开也能跑。
// 零依赖，只用 node 内置模块。

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')
const pkg = join(repo, 'novels/月落渡口.origin')
const scripts = join(repo, 'novels/demo-scripts')

const read = (base, rel) => readFileSync(join(base, rel), 'utf8')
const jsonl = (base, rel) => read(base, rel).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
const sha = (base, rel) => createHash('sha256').update(readFileSync(join(base, rel))).digest('hex')

const pkgFiles = [
  'graph/objects.jsonl', 'graph/relations.jsonl', 'graph/constraints.json', 'graph/limits.json',
  'provenance/history.jsonl',
  'narrative/chapters/outline.jsonl',
  'runs/2026-09-01T14-47-06.727Z/gate-report.json',
]
const scriptFiles = ['tx-legal-example.json', 'tx-accepted-example.json']

const data = {
  package: 'novels/月落渡口.origin',
  generated_at: new Date().toISOString(),
  sources: {
    ...Object.fromEntries(pkgFiles.map((f) => [f, sha(pkg, f)])),
    ...Object.fromEntries(scriptFiles.map((f) => ['demo-scripts/' + f, sha(scripts, f)])),
  },
  objects: jsonl(pkg, 'graph/objects.jsonl'),
  relations: jsonl(pkg, 'graph/relations.jsonl'),
  constraints: JSON.parse(read(pkg, 'graph/constraints.json')),
  limits: JSON.parse(read(pkg, 'graph/limits.json')),
  history: jsonl(pkg, 'provenance/history.jsonl'),
  outline: jsonl(pkg, 'narrative/chapters/outline.jsonl'),
  reference: {
    gate_report_ch15: JSON.parse(read(pkg, 'runs/2026-09-01T14-47-06.727Z/gate-report.json')),
  },
  demo_txs: {
    legal_example: JSON.parse(read(scripts, 'tx-legal-example.json')),
    accepted_example: JSON.parse(read(scripts, 'tx-accepted-example.json')),
  },
}

const out = join(here, 'data.js')
writeFileSync(out,
  '// 由 build-data.mjs 从 ' + data.package + ' 原样打包生成，请勿手改；重新生成：node website/zh/demo-story/build-data.mjs\n'
  + 'window.STORY_DEMO_DATA = ' + JSON.stringify(data, null, 0) + ';\n')
process.stderr.write(`写出 ${out}：对象 ${data.objects.length}，约束 ${data.constraints.length}，边界 ${data.limits.length}，history ${data.history.length}，章节 ${data.outline.length}\n`)
