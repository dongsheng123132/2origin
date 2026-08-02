// 世界规格指纹：判分结果只在同一版 ground truth 下可比。
//
// 事故（2026-08-03）：M-lite 升级往 state-changes.jsonl 追加了 27 条，其中 **2 条落在
// S 级评测区间内**（ch11 黑钥匙转手给林峥、ch14 云姑获知铃钥同源）。旧规格在 ch11-15
// 没有任何 canonical 状态变更，新规格有了——replay() 产出的 ground truth 随之改变，
// 同一批正文重打分，A0 0.54→0.72、A3 0.28→0.58，而正文一个字都没动。
//
// 纯新增、无删除，`git diff --stat` 看着人畜无害，问题却出在「新增的位置在评测区间内」。
// 所以不能靠人眼看 diff，必须让判分器自己发现口径变了。

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

/** 递归收集目录下所有文件，路径排序后逐个入哈希——保证同内容同指纹、跨平台一致 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/**
 * 规格指纹 = world/spec.origin 全部文件内容 + 任务文件。
 * 任务文件也算进去：换任务（S 级 continuation.json / M 级 continuation-m.json）
 * 等于换考题，跨任务的分数同样不可比。
 */
export function specHash(here, taskFile = 'continuation.json') {
  const h = createHash('sha1')
  const root = join(here, 'world', 'spec.origin')
  for (const f of walk(root)) {
    h.update(f.slice(root.length).replace(/\\/g, '/'))
    h.update(readFileSync(f))
  }
  h.update('task:' + taskFile)
  return h.digest('hex').slice(0, 12)
}

/**
 * 检查一批结果是否同口径。返回 { ok, current, groups, unknown }。
 * 没有 provenance 的历史结果计入 unknown——它们无法证明自己对着哪版规格判的。
 */
export function checkSpecConsistency(results, current) {
  const groups = {}
  let unknown = 0
  for (const r of results) {
    const h = r.provenance?.specHash
    if (!h) unknown++
    else (groups[h] ??= []).push(r.label ?? '?')
  }
  const hashes = Object.keys(groups)
  return {
    ok: unknown === 0 && hashes.length <= 1 && (hashes.length === 0 || hashes[0] === current),
    current,
    groups,
    unknown,
  }
}
