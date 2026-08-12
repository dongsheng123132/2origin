// 世界规格指纹：判分结果只在同一版 ground truth 下可比。
//
// 事故（2026-08-03）：M-lite 升级往 state-changes.jsonl 追加了 27 条，其中 **2 条落在
// S 级评测区间内**（ch11 黑钥匙转手给林峥、ch14 云姑获知铃钥同源）。旧规格在 ch11-15
// 没有任何 canonical 状态变更，新规格有了——replay() 产出的 ground truth 随之改变，
// 同一批正文重打分，A0 0.54→0.72、A3 0.28→0.58，而正文一个字都没动。
//
// 纯新增、无删除，`git diff --stat` 看着人畜无害，问题却出在「新增的位置在评测区间内」。
// 所以不能靠人眼看 diff，必须让判分器自己发现口径变了。

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
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
 * 判分器指纹 = eval/ 下参与判分的代码文件内容。
 *
 * 第四起同类事故（2026-08-03，补语料时暴露）：specHash 只覆盖 ground truth，不覆盖
 * **判分器本身**。ced.mjs 的 custody / left-hand 两条规则原先完全没做否定与转述过滤
 *（「钥匙不在赵七处」被判成钥匙归赵七、「左手垂在身侧，未抬」被判成伤手挥抬），
 * 修完 W1 的 findings 从 18 条降到 12 条——同一批正文、同一版规格，分数却变了。
 * 而 specHash 纹丝不动，provenance 会理直气壮地声称「同一口径」。
 *
 * 规格与判分器是 ground truth 的两半：一半定义「对错是什么」，一半定义「怎么判」。
 * 少记任何一半，跨批次的分数都不能并列。
 */
function hashOf(here, names) {
  const h = createHash('sha1')
  const dir = join(here, 'eval')
  for (const name of names.filter((n) => existsSync(join(dir, n))).sort()) {
    h.update(name)
    h.update(readFileSync(join(dir, name)))
  }
  return h.digest('hex').slice(0, 12)
}

// 只取真正参与判分的模块——selftest/rescore/calibrate 是工具，改它们不影响分数
const SCORERS = ['ced.mjs', 'state-diff.mjs', 'detect-score.mjs', 'judge.mjs', 'replay.mjs', 'engagement.mjs']

export function judgeHash(here) {
  return hashOf(here, SCORERS)
}

/**
 * 分维度指纹（2026-08-05 加）。
 *
 * 整体 `judgeHash` 太粗：`ced.mjs` 只参与 W1（判正文），可它一改，
 * **W3 的历史数据也会被一并标成「口径过期」**——而 W3 比的是结构化状态字段，
 * 判它的只有 `state-diff.mjs`，跟词表毫无关系。
 *
 * 词表补丁（Run #24）正撞上这个问题：它必须改 `ced.mjs`，而 Run #27 的 W3 结论
 * 不该被连坐。两个维度分开记指纹，闸门才能只拦该拦的那一半。
 *
 * 保留 `judgeHash` 不动——历史结果里记的是它，去掉会让旧数据无从校验。
 */
export const judgeHashW1 = (here) => hashOf(here, ['ced.mjs', 'judge.mjs', 'engagement.mjs'])
export const judgeHashW3 = (here) => hashOf(here, ['state-diff.mjs'])

/**
 * 实验臂指纹 = arms/ 下全部 .mjs 的内容。
 *
 * 第八起（2026-08-05）暴露的第三个盲区：specHash 记「对错是什么」，judgeHash 记「怎么判」，
 * **没有任何东西记「是怎么跑出来的」**。探询提示词就住在 arms/ 里——它泄题、不传上下文、
 * 问的字段与判的字段对不上，全都发生在这两个指纹的视野之外，而 provenance 依然显示口径一致。
 *
 * gitCommit 只在工作区干净时才等价于代码指纹，改了没提交就跑是常态，挡不住。
 */
/**
 * 跨目录依赖：A3 的跑法**不止**取决于 arms/ 里的代码。
 *
 * 2026-08-05 补：`armsHash` 原先只走 `arms/`，而 A3 的提交编译器 import 了三个外部文件——
 * 词表补丁改了 `eval/ced.mjs`，A3 的正文门禁当场变严（Run #26/#28 实测多拦 19 处），
 * 而 `armsHash` 一动不动。**一个自称记录「怎么跑的」的指纹，漏掉了决定它怎么跑的文件。**
 *
 * 与第二起（specHash 漏任务文件）、第四起（judgeHash 漏判分器）同族：
 * 指纹的覆盖面必须跟着**实际依赖**走，不能跟着目录走。
 */
const ARM_EXTERNAL_DEPS = [
  ['eval', 'ced.mjs'], //                 a3-benxiang/commit-compiler.mjs 的正文门禁规则源
  ['..', '..', 'compiler', 'commit-compiler.mjs'], // 参考实现：校验/应用事务
  ['..', '..', 'compiler', 'constraints.mjs'], //     参考实现：通用约束检查
  // 输入侧：a3-benxiang/context-compiler.mjs 自 2026-08 起是核心的方言着色器，
  // 选取、渲染与预算斜坡都住在核心里。**漏掉这一条，改核心就能悄悄改掉提示词而指纹不动**
  // ——正是第八起的同一个形状（规格与判分器都没变、跑法变了，旧指纹一个都察觉不到）。
  ['..', '..', 'compiler', 'context-compiler.mjs'], // 参考实现：投影 + 预算斜坡
]

export function armsHash(here) {
  const h = createHash('sha1')
  const root = join(here, 'arms')
  if (!existsSync(root)) return null
  for (const f of walk(root).filter((p) => p.endsWith('.mjs'))) {
    h.update(f.slice(root.length).replace(/\\/g, '/'))
    h.update(readFileSync(f))
  }
  for (const parts of ARM_EXTERNAL_DEPS) {
    const p = join(here, ...parts)
    if (!existsSync(p)) continue
    h.update('dep:' + parts.join('/'))
    h.update(readFileSync(p))
  }
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
