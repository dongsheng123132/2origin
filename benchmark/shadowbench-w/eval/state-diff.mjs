#!/usr/bin/env node
// W3 判分：状态回写正确性——本基准的独有考题。
// 把各臂「自报的世界状态」与 ground truth 答案集做字段级比对。
//
//   node state-diff.mjs <arm-output.json>
//   node state-diff.mjs <arm-output.json> --json
//
// arm-output.json 形如：
//   { "arm": "a0-naive", "state": {...}, "hooks": {...}, "evidence": {...} }

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
// 兜底任务：调用方没显式传 task 时用。**环境变量这条路是坏的**——见 scoreW3 的注释。
const TASK = JSON.parse(readFileSync(join(HERE, '..', 'world', 'spec.origin', 'tasks', process.env.SBW_TASK ?? 'continuation.json'), 'utf8'))

/** "char:lin-zheng.knows.not_contains" → { id, field, op } */
function parseKey(key) {
  const [id, field, op] = key.split('.')
  return { id, field, op: op ?? 'equals' }
}

function lookup(reported, id, field) {
  if (id.startsWith('hook:')) return reported.hooks?.[id]?.[field] ?? reported.hooks?.[id]
  return reported.state?.[id]?.[field]
}

/**
 * 第六起事故（2026-08-03）：答案集必须由调用方显式传入，不能靠环境变量。
 *
 * 原先 TASK 在模块顶层按 `process.env.SBW_TASK` 加载，而 run.mjs 用 `--task` 参数切换级别、
 * 从不设置该环境变量——更要命的是**即便设了也没用**：ES module 的 import 是提升的，
 * state-diff.mjs 的顶层代码在 run.mjs 的第一行执行之前就跑完了，那时 env 还没写。
 * 一条永远不会生效的切换路径，看代码却像是支持切换的。
 *
 * 后果：M-lite 首跑（Run #13）用 S 级的答案集判了 M 级的答卷。M 级要求把黑钥匙交回沈砚，
 * S 级要求交给林峥；A3 答沈砚——**正确答案**——被判成错，还被写进 log 当成「A3 的护城河
 * 在长基线上消失了」。判分器拿着错的答案集，把对的答案判成错的，没有任何环节会报错。
 */
export function scoreW3(reported, task = TASK) {
  const expected = task.expected_state_after.must_hold
  const rows = []

  for (const [key, want] of Object.entries(expected)) {
    if (key === 'note') continue
    const { id, field, op } = parseKey(key)
    const got = lookup(reported, id, field)
    let pass, detail

    if (got === undefined) {
      pass = false
      detail = '未上报该字段'
    } else if (op === 'not_contains') {
      pass = !(Array.isArray(got) ? got.includes(want) : String(got).includes(want))
      detail = pass ? `不含 ${want}` : `违反：含有 ${want}`
    } else {
      pass = JSON.stringify(got) === JSON.stringify(want)
      detail = pass ? '一致' : `期望 ${JSON.stringify(want)}，实为 ${JSON.stringify(got)}`
    }
    rows.push({ key, pass, detail })
  }

  const passed = rows.filter((r) => r.pass).length
  const missing = rows.filter((r) => r.detail === '未上报该字段').length

  // 证据可追溯率：状态字段能否指回来源场景（仅对上报了 evidence 的臂计算）
  const evidenceKeys = Object.keys(reported.evidence ?? {})
  const traceable = evidenceKeys.filter((k) => /^scene:\d{2}-\d{2}$|^ch\d+/.test(reported.evidence[k] ?? '')).length

  return {
    arm: reported.arm,
    rows,
    stateAccuracy: rows.length ? passed / rows.length : 0,
    checked: rows.length,
    passed,
    missing,
    evidenceTraceability: evidenceKeys.length ? traceable / evidenceKeys.length : null,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  if (!file) {
    console.log('用法: node state-diff.mjs <arm-output.json> [--json]')
    process.exit(1)
  }
  const result = scoreW3(JSON.parse(readFileSync(file, 'utf8')))
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`# W3 状态回写正确性 · ${result.arm}\n`)
    for (const r of result.rows) console.log(`  ${r.pass ? '✓' : '✗'} ${r.key.padEnd(42)} ${r.detail}`)
    console.log(`\n  状态准确率 ${(result.stateAccuracy * 100).toFixed(1)}%  (${result.passed}/${result.checked}，未上报 ${result.missing})`)
    if (result.evidenceTraceability !== null)
      console.log(`  证据可追溯率 ${(result.evidenceTraceability * 100).toFixed(1)}%`)
  }
}
