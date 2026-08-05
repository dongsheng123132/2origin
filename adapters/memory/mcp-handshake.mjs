#!/usr/bin/env node
// Shadow Memory · 真实 MCP 协议握手验证
//
// 用裸 stdio JSON-RPC 走一遍 MCP 标准握手（与 Claude Desktop / Cursor /
// Claude Code 客户端同协议）：initialize → notifications/initialized →
// tools/list → tools/call（origin_state / origin_commit / origin_why）→ 退出。
// 零依赖，不引 SDK——与 mcp-server.mjs 同一哲学。
//
//   node adapters/memory/mcp-handshake.mjs <包路径>
//
// 通过 = 任何 MCP 客户端都能接；「新会话秒恢复」从协议层被证明。

import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initPackage } from '../../compiler/store.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = join(HERE, 'mcp-server.mjs')

let pass = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? '　' + extra : ''}`) }
  else { fail++; console.log(`  ✗ ${name}　${extra}`) }
}

async function main() {
  const pkgArg = process.argv[2]
  const PKG = pkgArg ?? join(mkdtempSync(join(tmpdir(), 'mcp-hs-')), 'proj.origin')
  if (!pkgArg) {
    // 建一个带内容的测试包
    initPackage(PKG, {
      manifest: 'artifact:\n  id: hs-test\n  kind: memory\n',
      objects: [
        { id: 'decision:mvp', _type: 'decision', status: 'open', reason: '测试决策', by: 'setup' },
        { id: 'task:setup', _type: 'task', status: 'doing', owner: 'hermes' },
      ],
    })
  }

  console.log('Shadow Memory MCP 握手验证：')
  console.log(`  服务器：${SERVER}`)
  console.log(`  包：${PKG}\n`)

  const child = spawn(process.execPath, [SERVER, PKG], { stdio: ['pipe', 'pipe', 'pipe'] })
  let buf = ''
  let nextId = 1
  const pending = new Map()
  const done = new Promise((resolve) => { child.on('close', resolve) })

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      const msg = JSON.parse(line)
      const waiter = pending.get(msg.id)
      if (waiter) { pending.delete(msg.id); waiter(msg) }
    }
  })

  const call = (method, params = {}, id = nextId++) => new Promise((resolve) => {
    pending.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })

  try {
    // ① 握手
    const init = await call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'mcp-handshake-test', version: '1.0.0' },
    })
    check('initialize 返回协议版本', init.result?.protocolVersion === '2024-11-05', init.result?.protocolVersion)
    check('initialize 声明 tools 能力', !!init.result?.capabilities?.tools)
    check('initialize 返回服务器信息', init.result?.serverInfo?.name === 'benxiang-memory')
    check('initialize 带 instructions', typeof init.result?.instructions === 'string' && init.result.instructions.length > 20)

    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

    // ② 工具清单
    const list = await call('tools/list')
    const tools = list.result?.tools ?? []
    check('tools/list 返回 5 个工具', tools.length === 5, tools.map((t) => t.name).join(','))
    check('含 origin_state（秒恢复入口）', tools.some((t) => t.name === 'origin_state'))
    check('含 origin_commit（事务提交）', tools.some((t) => t.name === 'origin_commit'))
    check('工具带描述（模型说明书）', tools.every((t) => (t.description ?? '').length > 20))

    // ③ origin_state：新会话恢复
    const st = await call('tools/call', { name: 'origin_state', arguments: {} })
    const stText = st.result?.content?.[0]?.text ?? ''
    check('origin_state 返回世界状态投影', stText.includes('【项目世界状态】') || stText.includes('世界状态'))
    check('投影带 seq 水位', stText.includes('seq 水位'))

    // ④ origin_commit：提交一个合法事务
    const commit = await call('tools/call', {
      name: 'origin_commit',
      arguments: {
        transaction: {
          transaction_id: 'hs-tx-1',
          state_changes: [{ object: 'task:setup', field: 'status', from: 'doing', to: 'done' }],
        },
        by: 'handshake-test',
      },
    })
    check('origin_commit 成功落盘', (commit.result?.content?.[0]?.text ?? '').includes('已落盘 seq'))
    check('commit 无 isError', !commit.isError && !commit.error)

    // ⑤ origin_commit：违规事务应被拒绝（isError:true, 零写入）
    const bad = await call('tools/call', {
      name: 'origin_commit',
      arguments: {
        transaction: {
          transaction_id: 'hs-tx-bad',
          creates: [],
          state_changes: [{ object: 'ghost:object', field: 'x', to: 1 }],
        },
      },
    })
    check('未知对象被拒绝（isError）', bad.result?.isError === true, JSON.stringify(bad).slice(0, 120))
    check('拒绝理由含「未知对象」', (bad.result?.content?.[0]?.text ?? '').includes('未知对象'))

    // ⑥ origin_why：证据链
    const why = await call('tools/call', { name: 'origin_why', arguments: { ref: 'task:setup.status' } })
    check('origin_why 返回改动链', (why.result?.content?.[0]?.text ?? '').includes('→'))

    // ⑦ ping
    const pong = await call('ping')
    check('ping 有响应', !!pong.result)

    child.stdin.end()
    console.log(`\n${pass} 通过 / ${fail} 失败`)
    process.exit(fail ? 1 : 0)
  } catch (e) {
    console.error('握手失败：', e.message)
    child.kill()
    process.exit(1)
  }
}

main()
