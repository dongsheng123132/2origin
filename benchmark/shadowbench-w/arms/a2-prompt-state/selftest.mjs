#!/usr/bin/env node
import assert from 'node:assert/strict'
import { run } from './index.mjs'

const spec = {
  rules: [{ statement: '空间门不得开启' }],
  hooks: [{ id: 'hook:test', status: 'planted_unresolved' }],
}
const task = {
  goal: '把钥匙交给沈砚',
  forbidden_zones: [{ rule: '赵七不得死亡' }],
}
const state0 = {
  'obj:black-key': { holder: 'char:lin-zheng', used: false },
  'char:zhao-qi': { alive: true },
}

let calls = 0
const model = {
  stub: true,
  async complete({ prompt, chapter }) {
    calls++
    assert.match(prompt, /【当前世界状态】/)
    assert.doesNotMatch(prompt, /expected_state_after/)
    const state = structuredClone(state0)
    if (chapter === 52) state['obj:black-key'].holder = 'char:shen-yan'
    const parsed = {
      text: `第${chapter}章正文`,
      state,
      hooks: { 'hook:test': { status: 'planted_unresolved' } },
    }
    return {
      raw: JSON.stringify(parsed),
      parsed,
      usage: { inputTokens: 10, outputTokens: 20, ms: 1 },
    }
  },
}

const result = await run({
  spec,
  task,
  state0,
  chapters: [51, 52],
  model,
  budget: 100,
  corpusTail: '旧正文',
})

assert.equal(calls, 2, 'A2 每章只能调用一次，不得校验后重试')
assert.equal(result.usage.calls, 2)
assert.equal(result.state['obj:black-key'].holder, 'char:shen-yan')
assert.equal(result.hooks['hook:test'].status, 'planted_unresolved')
assert.equal(result.promptOnly.stateSnapshots, 2)
assert.deepEqual(result.promptOnly.parseFailures, [])
assert.deepEqual(result.evidence, {}, 'A2 不得生成证据链')
assert.equal(result.gate, null, 'A2 不得挂接校验门禁')

console.log('✓ A2 prompt-only 自测通过（无校验、无证据、每章单次调用）')
