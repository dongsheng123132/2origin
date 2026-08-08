#!/usr/bin/env node
// MCP 端到端实跑 —— 不是单元测试，是一份可复现的**证据**。
//
//   node adapters/memory/e2e.mjs
//
// 它真的把 mcp-server.mjs 当子进程拉起来，走 stdio 上的 JSON-RPC 打一整轮：
// 建包 → 握手 → 列工具 → 取投影 → 提交合法事务 → 提交违规事务（应被拒绝且零字节写入）
// → 查「这个值凭什么」→ 体检。每一步的请求与响应原样打印，任何人可以自己跑一遍对照。
//
// 断言写在最后：全过才退 0。所以它同时是回归测试和演示脚本。

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { seqOf } from '../../compiler/store.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = join(tmpdir(), `benxiang-e2e-${process.pid}.origin`)

let pass = 0, fail = 0
const check = (cond, name, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? '\n      ' + detail : ''}`) }
}

// ── 起服务 ──────────────────────────────────────────────────────
rmSync(PKG, { recursive: true, force: true })
execFileSync(process.execPath, [join(HERE, 'init.mjs'), PKG, 'benxiang', '本象协议'], { stdio: ['ignore', 'pipe', 'inherit'] })

const srv = spawn(process.execPath, [join(HERE, 'mcp-server.mjs'), PKG], { stdio: ['pipe', 'pipe', 'inherit'] })
const pending = new Map()
let buf = ''
srv.stdout.setEncoding('utf8')
srv.stdout.on('data', (c) => {
  buf += c
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    const r = pending.get(msg.id)
    if (r) { pending.delete(msg.id); r(msg) }
  }
})

let seq = 0
const rpc = (method, params) =>
  new Promise((res) => {
    const id = ++seq
    pending.set(id, res)
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })

/** 打印一次真实往返——证据要能被第三方对照，就不能只给结论。 */
async function call(name, args, { show = true } = {}) {
  const r = await rpc('tools/call', { name, arguments: args })
  const text = r.result?.content?.[0]?.text ?? JSON.stringify(r.error)
  if (show) {
    console.log(`\n\x1b[36m→ tools/call ${name}\x1b[0m ${JSON.stringify(args)}`)
    console.log(`\x1b[90m← ${r.result?.isError ? 'isError:true' : 'ok'}\x1b[0m\n${text.split('\n').map((l) => '    ' + l).join('\n')}`)
  }
  return { text, isError: !!r.result?.isError }
}

// ── 一整轮 ──────────────────────────────────────────────────────
console.log('# MCP 端到端实跑（本象记忆方言）\n')
console.log(`包：${PKG}\n`)

console.log('[1] 握手')
const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e-driver', version: '0' } })
console.log(JSON.stringify(init.result, null, 2).split('\n').map((l) => '    ' + l).join('\n'))
check(init.result?.serverInfo?.name === 'benxiang-memory', '服务端完成 initialize 握手')
check(init.result?.protocolVersion === '2024-11-05', '  └ 协议版本按客户端声明回声')
srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

console.log('\n[2] 列工具')
const tools = await rpc('tools/list', {})
console.log('    ' + tools.result.tools.map((t) => t.name).join('、'))
check(tools.result.tools.length === 5, '暴露 5 个工具')
check(tools.result.tools.every((t) => t.inputSchema?.type === 'object'), '  └ 每个工具都带合法 inputSchema')

console.log('\n[3] 新会话恢复：世界现在是空的')
const empty = await call('origin_state', {})
check(empty.text.includes('module:benxiang'), '取到初始投影（只有锚对象）')

console.log('\n[4] 提交三条真实决策')
const s0 = seqOf(PKG)
const okTx = await call('origin_commit', {
  by: 'claude@session',
  expect_seq: s0,
  transaction: {
    transaction_id: 'tx-e2e-001',
    operation: 'record_decisions',
    target: 'module:benxiang',
    creates: [
      { id: 'decision:english-name', type: 'decision' },
      { id: 'decision:claim-scope', type: 'decision' },
      { id: 'decision:append-only', type: 'decision' },
    ],
    state_changes: [
      { object: 'decision:english-name', field: 'status', to: 'decided' },
      { object: 'decision:english-name', field: 'value', to: 'Benxiang' },
      { object: 'decision:english-name', field: 'rationale', to: '避开加密货币 OGN 的 Origin Protocol 撞名；本=origin，象典出「立象以尽意」' },
      { object: 'decision:claim-scope', field: 'status', to: 'decided' },
      { object: 'decision:claim-scope', field: 'value', to: '只主张状态追踪' },
      { object: 'decision:claim-scope', field: 'rationale', to: 'W1 正文一致性与 RAG 无显著差异（p=0.9905/0.3361），Token 更贵，两条早先主张已撤回' },
      { object: 'decision:append-only', field: 'status', to: 'decided' },
      { object: 'decision:append-only', field: 'value', to: '只追加不覆写' },
      { object: 'decision:append-only', field: 'rationale', to: '一旦把当前值写回 objects.jsonl，历史就降级成说明文档，对不上账时无从追责' },
    ],
  },
})
check(!okTx.isError && okTx.text.includes('已落盘'), '合法事务落盘')
check(seqOf(PKG) === s0 + 12, '  └ seq 水位推进 12 条（9 个字段 + 3 个类型）', `实际 ${seqOf(PKG)}`)

console.log('\n[5] 打错 ID：去改一个不存在的对象，且没声明要新建')
const ghost = await call('origin_commit', {
  by: 'typo-agent',
  transaction: {
    transaction_id: 'tx-e2e-002', operation: 'update', target: 'decision:english-nam',
    state_changes: [{ object: 'decision:english-nam', field: 'value', from: 'Benxiang', to: 'Benxiang2' }],
  },
})
check(ghost.isError && ghost.text.includes('未知对象'), '幽灵对象被拦住（少打一个字母的 ID 当场暴露）')
check(!ghost.text.includes('已落盘'), '  └ 没有静默造出 decision:english-nam')

console.log('\n[6] 提交一条违规事务：决策没写理由')
const before = seqOf(PKG)
const badTx = await call('origin_commit', {
  by: 'careless-agent',
  transaction: {
    transaction_id: 'tx-e2e-003', operation: 'record_decision', target: 'module:benxiang',
    creates: [{ id: 'decision:mvp', type: 'decision' }],
    state_changes: [
      { object: 'decision:mvp', field: 'status', to: 'decided' },
      { object: 'decision:mvp', field: 'value', to: '先做 MCP' },
    ],
  },
})
check(badTx.isError, '被门禁拒绝')
check(badTx.text.includes('每个决策必须写明理由'), '  └ 给出的是可据以重写的具体理由')
check(seqOf(PKG) === before, '  └ 零字节写入（seq 水位没动）', `实际 ${seqOf(PKG)}`)

console.log('\n[7] 同一个 agent 补上理由后重提')
const fixTx = await call('origin_commit', {
  by: 'careless-agent',
  transaction: {
    transaction_id: 'tx-e2e-004', operation: 'record_decision', target: 'module:benxiang',
    creates: [{ id: 'decision:mvp', type: 'decision' }],
    state_changes: [
      { object: 'decision:mvp', field: 'status', to: 'decided' },
      { object: 'decision:mvp', field: 'value', to: '先做 MCP' },
      { object: 'decision:mvp', field: 'rationale', to: '三件实事里唯一不被阻塞的一件，且是另外两件的载体' },
    ],
  },
})
check(!fixTx.isError, '补齐后通过')

console.log('\n[8] 状态被改写后，再问一次「凭什么」')
await call('origin_commit', {
  by: 'other-agent',
  transaction: {
    transaction_id: 'tx-e2e-005', operation: 'supersede', target: 'decision:mvp',
    state_changes: [{ object: 'decision:mvp', field: 'value', from: '先做 CAD 导入器', to: '先做 MCP，CAD 待看到源文件后再定' }],
  },
}, { show: false })
const w = await call('origin_why', { ref: 'decision:mvp.value' })
check(w.text.includes('careless-agent') && w.text.includes('other-agent'), '两次改动的责任者都在，第一次没有被覆盖掉')
check(w.text.includes('记错了'), '  └ 第二个 agent 谎报的前值被如实标出')

console.log('\n[9] 体检')
const d = await call('origin_diagnose', {})
check(d.text.includes('✓ 无 error 级问题'), '世界状态自洽')

console.log('\n[10] 新会话恢复：这次世界有东西了')
const restored = await call('origin_state', {})
check(restored.text.includes('Benxiang') && restored.text.includes('先做 MCP'), '一次调用即恢复全部项目状态')
check(restored.text.includes('【约束·机器校验，违反即拒绝】'), '  └ 投影里同时带上了不可违反的边界')

// 回归保护：约束是**不可降级的固定开销**，不许被对象挤掉。
// 旧写法（无 task 时退回 renderAll 全量倾倒，约束排在全部对象之后）一旦被上游按预算截尾，
// benchmark/context-lod 实测 1500/3000/6000/12000 四档预算下 6 条约束全军覆没——
// 恰恰是会话恢复这条最需要规则的路径上，模型一次都没见过规则。
const tight = await call('origin_state', { budget: 400 })
check(tight.text.includes('【约束·机器校验，违反即拒绝】'), '  └ 预算极紧时先保约束，再拿剩下的买对象')

srv.stdin.end()
rmSync(PKG, { recursive: true, force: true })
console.log(`\n${fail ? '✗' : '✓'} ${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
