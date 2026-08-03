#!/usr/bin/env node
// 建一个本象记忆包。
//
//   node adapters/memory/init.mjs <包路径> <项目ID> [标题]
//
// 建出来是空的——**里面每一条决策、每一个待办，都必须经由事务写入**，
// 所以每一条都自带「谁在什么时候基于什么写的」。若允许手工往 objects.jsonl 里塞，
// 那些条目就成了没有来历的既成事实，证据链从第一天起就是破的。

import { initPackage } from '../../compiler/store.mjs'
import { MEMORY_CONSTRAINTS, MEMORY_MANIFEST, seedObjects } from './dialect.mjs'

const [dir, projectId, title] = process.argv.slice(2)
if (!dir || !projectId) {
  process.stderr.write('用法：init.mjs <包路径> <项目ID> [标题]\n')
  process.exit(2)
}

const name = title ?? projectId
initPackage(dir, {
  manifest: MEMORY_MANIFEST(projectId, name),
  objects: seedObjects(projectId, name),
  constraints: MEMORY_CONSTRAINTS,
})

process.stderr.write(`已创建记忆包 ${dir}（${MEMORY_CONSTRAINTS.length} 条机器可判定约束）\n`)
process.stdout.write(dir + '\n')
