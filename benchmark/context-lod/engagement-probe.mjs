#!/usr/bin/env node
// 触发阈值探针：**这个世界在多大预算下，预算斜坡才会真的动？**
//
//   node benchmark/context-lod/engagement-probe.mjs [<pkg.origin> …]
//
// 用途是省钱。跑一次真实模型基准要花时间和 token，而如果被测机制在实际运行的
// 预算点上根本不会触发，那笔钱买到的只是噪声——而且是**看起来像结论**的噪声
// （results-log 反复强调单次运行方差大到能翻转结论）。
//
// 判据很直白：把预算从大到小扫一遍，看什么时候开始出现降档 / 丢弃。
//   若「实际运行预算」远在触发阈值之上 → 机制恒不触发，别跑，先换个更大的世界。
//   若落在阈值附近或之下 → 值得跑。
//
// 这个探针是 2026-08 那次实测的直接产物：ShadowBench-W 的世界只有 13 个可渲染对象、
// 状态段 1527 字符，而实验预算是 6000。斜坡要到 1600 以下才开始动——也就是说，
// 在 ShadowBench-W 上跑 LOD 臂，花钱测的是零。

import { loadOrigin } from '../../compiler/index.mjs'
import { compileContext } from '../../compiler/context-compiler.mjs'

const BUDGETS = [24000, 12000, 6000, 4000, 3000, 2000, 1500, 1200, 900, 600, 400]
const pkgs = process.argv.slice(2)
if (!pkgs.length) pkgs.push('project.origin', 'spec/examples/sales-2026.origin')

for (const dir of pkgs) {
  let origin
  try { origin = loadOrigin(dir) } catch (e) { console.log(`\n## ${dir}\n  读取失败：${e.message}`); continue }

  const task = { goal: '恢复项目当前状态' }
  console.log(`\n## ${dir}`)
  console.log(`世界规模：${origin.ids.size} 个对象，${origin.relations.length} 条关系，${origin.constraints.length} 条约束`)

  // 满档成本：所有对象都给全字段要多少字符——这就是「装得下」的门槛
  const full = compileContext({ origin, task, budget: Number.MAX_SAFE_INTEGER })
  console.log(`满档投影：${full.estChars} 字符（斜坡在预算低于此值时才有事可做）\n`)

  console.log('| 预算 | 字符 | full/key/id | 丢弃 | 斜坡动了? |')
  console.log('|---:|---:|---|---:|---|')
  for (const budget of BUDGETS) {
    const c = compileContext({ origin, task, budget })
    const bl = c.byLevel
    const engaged = bl.key.length > 0 || bl.id.length > 0 || c.dropped.length > 0
    console.log(
      `| ${budget} | ${c.estChars} | ${bl.full.length}/${bl.key.length}/${bl.id.length} | ` +
      `${c.dropped.length} | ${engaged ? '✔' : '—'} |`,
    )
  }
  // 阈值不是扫出来的，是算出来的：预算低于满档成本，斜坡就必须动手；高于则无事可做。
  // 扫描表只是佐证 + 看降级的形状（先降档还是已经开始丢）。
  console.log(
    `\n**触发阈值 = 满档成本 ${full.estChars}**：预算 ≥ 此值时斜坡恒不触发，` +
    `在这个世界上做 LOD 对照＝花钱测噪声；预算 < 此值才有可测的差异。`,
  )
}
