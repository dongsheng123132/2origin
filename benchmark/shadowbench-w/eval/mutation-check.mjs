#!/usr/bin/env node
// 判分器的**变异验证**：谁来验证「验证验证者的那个东西」。
//
// selftest.mjs 已经在做正确的事——用已知违规的夹具反测规则、用干净文本反测误报。
// 但夹具回答的是「判分器能不能发现坏输入」，回答不了另一个问题：
//
//   **如果判分器自己被改坏了，selftest 会不会红？**
//
// 一条杀不掉任何变异的自测，和没有自测是一回事：它会在每次重构后继续打勾，
// 而基准早已在悄悄给所有实验臂送分。Run #1 那次「A3 拒绝一切提交却因 CED=0 反而赢」
// 就是这一类失效——判定标准有洞，而当时没有任何东西会因为这个洞变红。
//
// 做法：往判分器源码里注入**真人可能犯的**改动（不是随机噪声），每注入一个就跑一遍
// selftest，然后还原。
//   - selftest 变红 = 这个变异被**杀死**（好：自测确实盯着这条逻辑）
//   - selftest 仍绿 = 这个变异**存活**（坏：这条逻辑没有任何断言在看，是盲区）
//
// 用法：
//   node eval/mutation-check.mjs           # 跑全部
//   node eval/mutation-check.mjs --json    # 出机器可读结果
//
// 退出码：0 = 全部被杀死；1 = 有存活变异（= 自测有盲区）

import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SELFTEST = join(HERE, 'selftest.mjs')

/**
 * 每个变异都必须是「有人真的会这么写错」的那种，理由写在 `why` 里。
 * 随机改字符能得到好看的杀死率，但证明不了任何事 —— 我们要的是
 * 「**这条业务规则有没有人在看**」，不是「代码有没有被执行过」。
 */
const MUTANTS = [
  // ── W3 状态回写（本基准唯一还成立的主张，判分器最不能有洞）──
  {
    file: 'state-diff.mjs',
    label: 'W3: 漏报字段不再算错',
    why: '把「未上报 = 失败」改成「未上报 = 跳过」。这正是 Run #1 那类洞：一个什么都不报的臂会变得完美',
    find: "    if (got === undefined) {\n      pass = false\n      detail = '未上报该字段'",
    replace: "    if (got === undefined) {\n      continue\n      detail = '未上报该字段'",
  },
  {
    file: 'state-diff.mjs',
    label: 'W3: not_contains 判反',
    why: '泄漏检测取反 —— 少一个 `!` 就从「不许含有」变成「必须含有」，是最容易手滑的一处',
    find: '      pass = !(Array.isArray(got) ? got.includes(want) : String(got).includes(want))',
    replace: '      pass = (Array.isArray(got) ? got.includes(want) : String(got).includes(want))',
  },
  {
    file: 'state-diff.mjs',
    label: 'W3: 严格比对退化成字符串比对',
    why: '`JSON.stringify` 换成 `String()`：`["林峥"]` 会等于 `"林峥"`，类型错误从此判不出来',
    find: '      pass = JSON.stringify(got) === JSON.stringify(want)',
    replace: '      pass = String(got) === String(want)',
  },
  {
    file: 'state-diff.mjs',
    label: 'W3: 准确率恒为满分',
    why: '最粗暴的送分。任何自测只要断言过一次「错的状态该扣分」，就必须杀掉它',
    find: '    stateAccuracy: rows.length ? passed / rows.length : 0,',
    replace: '    stateAccuracy: 1,',
  },
  {
    file: 'state-diff.mjs',
    label: 'W3: 证据可追溯率放水',
    why: '把「场景号格式」正则放成「非空即可」—— 证据链形同虚设，但数字更好看',
    find: '  const traceableOf = (k) => /^scene:\\d{2}-\\d{2}$|^ch\\d+/.test(reported.evidence[k] ?? \'\')',
    replace: '  const traceableOf = (k) => /./.test(reported.evidence[k] ?? \'\')',
  },

  {
    file: 'state-diff.mjs',
    label: 'W3: 覆盖率的分母换回「臂自己上报的证据数」',
    why: '这正是 2026-08-13 之前的真实口径 —— 只给 8 个必答字段中的 4 个配证据也记 100%。'
      + '一个自选分母的比率，读起来和覆盖率一模一样，却永远不会低。',
    find: '    evidenceCoverage: rows.length ? traceableRequired / rows.length : null,',
    replace: '    evidenceCoverage: evidenceKeys.length ? traceableRequired / evidenceKeys.length : null,',
  },

  {
    file: 'state-diff.mjs',
    label: 'W3: 覆盖率按 id 而非 id.field 匹配',
    why: '给 char:lin-zheng.location 配证据就算证了 char:lin-zheng.knows —— '
      + '同一个对象的另一个字段被当成同一件事，覆盖率虚高。实测 A3 每轮都会踩到。',
    find: '    return `${id}.${field}`',
    replace: '    return id',
  },

  {
    file: 'state-diff.mjs',
    label: 'W3: 没有证据的臂重新获得 null 豁免',
    why: 'null 会被均值悄悄排除，等于「一条证据都不给」不受惩罚 —— '
      + 'A0/A1/A2 与 A3 的差距恰恰全在这一项上，豁免掉它，这个区分就消失了。',
    find: '    evidenceCoverage: rows.length ? traceableRequired / rows.length : null,',
    replace: '    evidenceCoverage: traceableRequired ? traceableRequired / rows.length : null,',
  },

  // ── W2 缺陷检出 ──
  {
    file: 'detect-score.mjs',
    label: 'W2: 准确率不再受误报拖累',
    why: '分母从「所有上报」改成「命中数」→ 准确率恒为 100%，乱报一通也不扣分',
    find: '  const precision = dets.length ? found / dets.length : 0',
    replace: '  const precision = found ? found / found : 0',
  },
  {
    file: 'detect-score.mjs',
    label: 'W2: 召回率分母用「找到的」而不是「种下的」',
    why: '典型的召回/准确混淆，改完召回率恒为 1',
    find: '  const recall = found / planted.length',
    replace: '  const recall = found / (found || 1)',
  },

  // ── W1 生成一致性 ──
  {
    file: 'ced.mjs',
    label: 'W1: 错误数恒为 0',
    why: '主指标 EPC 直接归零 —— 所有臂在一致性上都完美',
    find: '    epc: n ? findings.length / n : 0, // ← 主指标',
    replace: '    epc: 0, // ← 主指标',
  },
  {
    file: 'ced.mjs',
    label: 'W1: 黑钥匙保管链不再检查',
    why: '删掉一条确定性规则的告警。词表回归号称「40 条真违规须全部命中」，这条该当场红',
    find: "            out.push({ quote: s.trim(), why: `保管链错误：黑钥匙应在${names[holder] ?? holder}处，文中归于${c.name}` })",
    replace: '            void 0',
  },
]

const results = []
for (const m of MUTANTS) {
  const path = join(HERE, m.file)
  const original = readFileSync(path, 'utf8')
  if (!original.includes(m.find)) {
    // 锚点找不到 = 判分器改过了，这条变异已失效。**必须报出来**，
    // 否则一条永远打不中的变异会伪装成「已覆盖」。
    results.push({ ...m, status: 'stale', note: '锚点在源码里找不到，变异未生效（判分器可能已重构）' })
    continue
  }
  writeFileSync(path, original.replace(m.find, m.replace))
  let killed
  try {
    execFileSync(process.execPath, [SELFTEST], { stdio: 'pipe' })
    killed = false // selftest 仍然通过 → 变异存活
  } catch {
    killed = true // selftest 报错退出 → 变异被杀死
  } finally {
    writeFileSync(path, original) // 无论如何都还原，别把判分器留在坏状态
  }
  results.push({ ...m, status: killed ? 'killed' : 'survived' })
}

const survived = results.filter((r) => r.status === 'survived')
const stale = results.filter((r) => r.status === 'stale')
const killed = results.filter((r) => r.status === 'killed')

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ killed: killed.length, survived: survived.length, stale: stale.length, results }, null, 2))
} else {
  console.log('# 判分器变异验证\n')
  for (const r of results) {
    const mark = r.status === 'killed' ? '✓ 杀死' : r.status === 'stale' ? '⚠ 失效' : '✗ 存活'
    console.log(`  ${mark}  [${r.file}] ${r.label}`)
    if (r.status !== 'killed') console.log(`          ${r.why}`)
    if (r.note) console.log(`          ${r.note}`)
  }
  console.log(`\n  杀死 ${killed.length} / 存活 ${survived.length} / 失效 ${stale.length}`)
  if (survived.length) {
    console.log('\n✗ 有变异存活 —— 这些判分逻辑没有任何断言在看，改坏了自测不会红。')
    console.log('  对策：给 selftest.mjs 补夹具，让每条存活变异都能被逮住。')
  } else if (stale.length) {
    console.log('\n⚠ 有变异锚点失效 —— 判分器改过了，这几条没真跑到，覆盖率是虚的。')
  } else {
    console.log('\n✓ 全部被杀死 —— 自测确实盯着这些判分逻辑。')
  }
}

process.exit(survived.length || stale.length ? 1 : 0)
