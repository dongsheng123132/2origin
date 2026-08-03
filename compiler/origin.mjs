// 本象包加载器——把 .origin 目录读成内存中的世界。
//
// 一个 .origin 包的最小形态（见 spec/examples/）：
//   manifest.yaml          包的身份、语义、投影声明
//   graph/objects.jsonl    对象：稳定 ID + 类型 + 任意字段
//   graph/relations.jsonl  关系：subject-predicate-object 三元组
//   graph/constraints.json 约束：不可违反的规则（见 constraints.mjs）
//   provenance/history.jsonl  谁在何时改了什么
//
// **状态就是对象的可变字段**——这是让协议跨域的关键抽象。
// 小说里是 char:lin-zheng.location，销售数据里是 projection:revenue-trend.chart，
// 二者在协议层是同一件事：一个稳定 ID 上的一个具名字段。没有这层统一，
// 每个领域都得写自己的状态机；有了它，校验器与编译器可以完全领域无关。

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const readJsonl = (p) =>
  existsSync(p)
    ? readFileSync(p, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : []

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback)

/**
 * manifest.yaml 的极简解析——只取顶层 `key:` 与二级 `  key: value`。
 * 不引第三方 YAML 依赖：manifest 是声明式清单，结构浅且受 schema 约束，
 * 真需要完整 YAML 时由宿主传入已解析对象（见 loadOrigin 的 manifest 参数）。
 */
function parseSimpleYaml(text) {
  const out = {}
  let section = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line.trim() || line.trim().startsWith('#')) continue
    const top = line.match(/^([\w-]+):\s*(.*)$/)
    if (top) {
      const [, k, v] = top
      if (v.trim()) out[k] = v.trim()
      else out[(section = k)] = {}
      continue
    }
    const sub = line.match(/^\s{2}([\w-]+):\s*(.*)$/)
    if (sub && section && typeof out[section] === 'object') out[section][sub[1]] = sub[2].trim()
  }
  return out
}

/**
 * 从对象列表折出初始状态：{ [id]: { ...字段 } }。
 * id 与 type 是身份，不算状态；其余字段都是可被事务改动的状态。
 */
export function stateFromObjects(objects) {
  const state = {}
  for (const o of objects) {
    const { id, type, ...fields } = o
    if (!id) continue
    state[id] = { ...fields }
    if (type) state[id]._type = type
  }
  return state
}

export function loadOrigin(dir, { manifest: manifestOverride } = {}) {
  const manifestPath = join(dir, 'manifest.yaml')
  const manifest =
    manifestOverride ?? (existsSync(manifestPath) ? parseSimpleYaml(readFileSync(manifestPath, 'utf8')) : {})

  const objects = readJsonl(join(dir, 'graph', 'objects.jsonl'))
  const relations = readJsonl(join(dir, 'graph', 'relations.jsonl'))
  const constraints = readJson(join(dir, 'graph', 'constraints.json'), [])
  const history = readJsonl(join(dir, 'provenance', 'history.jsonl'))

  return {
    dir,
    manifest,
    objects,
    relations,
    constraints,
    history,
    state: stateFromObjects(objects),
    ids: new Set(objects.map((o) => o.id).filter(Boolean)),
  }
}
