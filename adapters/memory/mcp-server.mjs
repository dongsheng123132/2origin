#!/usr/bin/env node
// 本象记忆 —— MCP Server（Memory 方言）
//
// 解决的是那个天天遇到的问题：**聊天记录被当成项目状态**。
// 聊得越久上下文越接近爆炸，压缩摘要不断失真，新开一个会话前功尽弃。
//
// 这里的做法是把二者分开：
//   聊天历史 = 一次性的操作窗口，可以随时丢
//   项目世界状态 = 持久存在于 .origin 包里，随时可恢复、可追责、可回放
//
// AI 不再「记住」什么，它只做两件事：开工前申请一份投影，收工时提交一个语义事务。
// 事务过不了确定性门禁就落不了盘，所以状态不会因为模型记错而慢慢腐坏。
//
// 零依赖：stdio 上的 JSON-RPC 2.0，自己实现。引一个 SDK 进来会让这个仓库
// 从「一份可独立核对的参考实现」变成「一份需要先装 node_modules 才能读的东西」。
//
//   用法：node adapters/memory/mcp-server.mjs <包路径>
//   或    ORIGIN_PKG=<包路径> node adapters/memory/mcp-server.mjs
//
// 接进 Claude Code：
//   claude mcp add benxiang -- node <绝对路径>/adapters/memory/mcp-server.mjs <包路径>

import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadOrigin } from '../../compiler/origin.mjs'
import { compileContext } from '../../compiler/context-compiler.mjs'
import { normalizeId } from '../../compiler/commit-compiler.mjs'
import { why, historyOf, diagnose, parseRef } from '../../compiler/provenance.mjs'
import { commit, seqOf, initPackage } from '../../compiler/store.mjs'
import { MEMORY_CONSTRAINTS, MEMORY_MANIFEST, MEMORY_TYPES, TX_CONTRACT } from './dialect.mjs'

const PKG = process.argv[2] ?? process.env.ORIGIN_PKG
if (!PKG) {
  process.stderr.write('用法：mcp-server.mjs <包路径>（或设 ORIGIN_PKG）\n')
  process.exit(2)
}

const log = (m) => process.stderr.write(`[benxiang] ${m}\n`)

// ── 遥测（可选，默认关闭）────────────────────────────────────────
// ORIGIN_TELEMETRY=1 时，每次 origin_commit 把**聚合指标**追加到 <pkg>/telemetry.jsonl：
//   时间 / 结果（accepted|rejected）/ 拒绝理由分类 / 变更数 / 对象数。
// **只记聚合计数，不记任何正文、字段值、对象 ID**——收集使用与拒绝形态，
// 不碰内容。这是嵌入 U-King 用户群收集反馈的机制本体，默认关、显式开。
const TELEMETRY = process.env.ORIGIN_TELEMETRY === '1'
const telemetry = (() => {
  let buf = []
  const flush = () => {
    if (!buf.length) return
    try {
      appendFileSync(join(PKG, 'telemetry.jsonl'), buf.map((r) => JSON.stringify(r)).join('\n') + '\n')
      buf = []
    } catch { buf = [] }
  }
  return {
    push(rec) {
      if (!TELEMETRY) return
      buf.push(rec)
      if (buf.length >= 5) flush()
    },
    flush,
  }
})()
process.on('exit', () => telemetry.flush())

// ── 工具定义 ────────────────────────────────────────────────────
// 每个工具的 description 是给模型看的**唯一说明书**，必须写清楚「什么时候该调它」，
// 否则模型要么不用，要么乱用。
const TOOLS = [
  {
    name: 'origin_state',
    description:
      '恢复项目世界状态。**新会话开始时、或不确定当前进展时，先调这个**——它返回的是持久状态的投影（当前有哪些对象、各自什么状态、有哪些不可违反的约束），不是聊天记录。给出 task 可只取与该任务相关的部分，省上下文。',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '当前要做什么。用于挑选相关对象；留空则给全局概览' },
        budget: { type: 'number', description: '字符预算，缺省 6000。超出时优先保状态与约束' },
        pin: { type: 'array', items: { type: 'string' }, description: '必须包含的对象 ID' },
      },
    },
  },
  {
    name: 'origin_commit',
    description:
      '把本轮产生的状态变化提交为语义事务。**做完一件有结论的事就提交一次**（定了一个决策、完成一个待办、发现一个风险），不要攒到最后。校验不通过时不会写入任何内容，并返回具体违规理由——按理由改完再提交即可。',
    inputSchema: {
      type: 'object',
      required: ['transaction'],
      properties: {
        transaction: {
          type: 'object',
          description: TX_CONTRACT,
          required: ['state_changes'],
          properties: {
            transaction_id: { type: 'string' },
            operation: { type: 'string' },
            target: { type: 'string' },
            creates: {
              type: 'array',
              description: '本次要新建的对象。不声明就写不存在的对象会被拒绝——防止 ID 打错造出幽灵对象',
              items: {
                type: 'object', required: ['id'],
                properties: { id: { type: 'string' }, type: { type: 'string', enum: MEMORY_TYPES } },
              },
            },
            state_changes: {
              type: 'array',
              items: {
                type: 'object',
                required: ['object', 'field', 'to'],
                properties: {
                  object: { type: 'string', description: '对象 ID，含前缀' },
                  field: { type: 'string' },
                  from: { description: '你认为的当前值。写错只会被记为偏差，不会拒绝' },
                  to: { description: '新值' },
                  op: { type: 'string', enum: ['set', 'append'] },
                },
              },
            },
            assertions: { type: 'array', items: { type: 'string' }, description: '你声明本次未违反的边界，会被逐条复核' },
          },
        },
        by: { type: 'string', description: '责任者。缺省 mcp-client' },
        expect_seq: { type: 'number', description: '读取状态时的 seq 水位。传了就会检测有没有别人插队' },
      },
    },
  },
  {
    name: 'origin_why',
    description:
      '这个值凭什么是这个值。返回该字段的完整改动链：每次谁改的、什么时候、从什么改成什么、有没有人记错前值。**要汇报一个数字、或对某个当前值有疑问时用它**。',
    inputSchema: {
      type: 'object',
      required: ['ref'],
      properties: { ref: { type: 'string', description: '形如 decision:mvp.status；对象前缀可省略' } },
    },
  },
  {
    name: 'origin_history',
    description: '变更时间线，可按对象、字段、事务、责任者过滤。用于回答「最近都改了什么」「谁动过这块」。',
    inputSchema: {
      type: 'object',
      properties: {
        object: { type: 'string' }, field: { type: 'string' },
        tx: { type: 'string' }, by: { type: 'string' },
        limit: { type: 'number', description: '缺省 20' },
      },
    },
  },
  {
    name: 'origin_diagnose',
    description: '世界状态体检：约束有没有被违反、有没有悬空引用、有没有同一事实存两份、模型记错前值的比例。定期调，或在觉得状态可疑时调。',
    inputSchema: { type: 'object', properties: {} },
  },
]

// ── 工具实现 ────────────────────────────────────────────────────
const HANDLERS = {
  origin_state({ task, budget = 6000, pin = [] }) {
    const origin = loadOrigin(PKG)
    const ctx = compileContext({
      origin, state: origin.state,
      task: { goal: task ?? '恢复项目当前状态' },
      pin, budget,
      hops: task ? 1 : 0,
    })
    // 无 task 时不做相关性挑选，给全局——新会话恢复要的就是全貌
    const text = task ? ctx.text : renderAll(origin)
    return [
      text,
      '',
      `【seq 水位】${seqOf(PKG)}　提交时把它作为 expect_seq 传回，即可发现有人插队。`,
    ].join('\n')
  },

  origin_commit({ transaction, by = 'mcp-client', expect_seq }) {
    // 防御：部分 MCP 客户端把嵌套对象参数序列化成 JSON 字符串（e2e 直接传对象则原样通过）。
    // 两种形态都应受理——对象直接用，字符串 parse 成对象再校验。
    if (typeof transaction === 'string') {
      try { transaction = JSON.parse(transaction) }
      catch { throw new Error(`提交被拒绝：transaction 参数是字符串但不是合法 JSON，无法解析为事务对象`) }
    }
    const r = commit(PKG, transaction, { by, expectedSeq: expect_seq ?? null })
    if (!r.ok) {
      // 聚合遥测：拒绝形态（不含具体内容）
      telemetry.push({
        ts: Date.now(), result: 'rejected',
        codes: [...new Set((r.violations ?? []).map((v) => v.code ?? 'unknown'))],
        n: (r.violations ?? []).length,
      })
      const lines = r.violations.map((v) => `  - [${v.severity ?? 'error'}] ${v.code ?? ''} ${v.msg}`)
      // 抛出去会变成 isError:true，模型看到的是「被拒绝 + 为什么」，可以直接重写再提交。
      throw new Error(`提交被拒绝，未写入任何内容：\n${lines.join('\n')}`)
    }
    // 聚合遥测：接受形态（不含任何字段值）
    telemetry.push({
      ts: Date.now(), result: 'accepted',
      n_changes: r.receipt.changed.length,
      n_objects: loadOrigin(PKG).state ? Object.keys(loadOrigin(PKG).state).length : 0,
    })
    const w = r.receipt.warnings.map((x) => `\n  ⚠ ${x.msg}`).join('')
    return `已落盘 seq ${r.receipt.seq_from}–${r.receipt.seq_to}，责任者 ${r.receipt.by}\n改动：${r.receipt.changed.join('、')}${w}`
  },

  origin_why({ ref }) {
    const origin = loadOrigin(PKG)
    const p = parseRef(ref)
    if (!p) throw new Error(`「${ref}」不是合法引用，应形如 object.field`)
    const object = normalizeId(p.object, origin.ids)
    const r = why({ state: origin.initial, history: origin.history, object, field: p.field })
    if (!r.explained)
      return `${r.ref} 当前值：${JSON.stringify(r.value)}\n该值来自包的初始对象表，未经任何事务——它「凭」的是导入，不是推演。`
    const rows = r.chain.map((c) =>
      `  seq ${c.seq}　${c.at}　${c.by}　${c.tx}\n    ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}` +
      ('claimed_from' in c ? `　（提交者以为前值是 ${JSON.stringify(c.claimed_from)}，记错了）` : ''))
    return `${r.ref} 当前值：${JSON.stringify(r.value)}\n经过 ${r.chain.length} 次改动（最新在前）：\n${rows.join('\n')}`
  },

  origin_history({ object, field, tx, by, limit = 20 }) {
    const origin = loadOrigin(PKG)
    const rows = historyOf(origin.history, {
      object: object ? normalizeId(object, origin.ids) : undefined, field, tx, by, limit,
    })
    if (!rows.length) return '无匹配的状态变更记录。'
    return rows.map((c) => `seq ${c.seq}　${c.at}　${c.by}　${c.object}.${c.field}：${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`).join('\n')
  },

  origin_diagnose() {
    const d = diagnose(loadOrigin(PKG))
    const head = `对象 ${d.objects}｜关系 ${d.relations}｜约束 ${d.constraints.enforceable}/${d.constraints.total} 可机器判定｜变更 ${d.changes}`
    const body = d.findings.length ? d.findings.map((f) => `  [${f.severity}] ${f.code}：${f.msg}`).join('\n') : '  无异常'
    return `${head}\n${body}\n${d.ok ? '✓ 无 error 级问题' : '✗ 存在 error 级问题'}`
  },
}

/** 全局概览：新会话恢复时要的是全貌，不是按任务挑过的子集。 */
function renderAll(origin) {
  const lines = ['【项目世界状态】']
  const byType = {}
  for (const [id, f] of Object.entries(origin.state)) (byType[f._type ?? 'object'] ??= []).push([id, f])
  for (const [type, items] of Object.entries(byType)) {
    lines.push(`\n· ${type}`)
    for (const [id, f] of items) {
      const bits = Object.entries(f)
        .filter(([k, v]) => k !== '_type' && v !== null && v !== undefined && typeof v !== 'object')
        .map(([k, v]) => `${k}=${v}`)
      const arrs = Object.entries(f).filter(([k, v]) => k !== '_type' && Array.isArray(v) && v.length).map(([k, v]) => `${k}=[${v.join(', ')}]`)
      lines.push(`  ${id}　${[...bits, ...arrs].join('；')}`)
    }
  }
  const enforceable = (origin.constraints ?? []).filter((c) => c.check)
  if (enforceable.length) {
    lines.push('\n【约束·违反即拒绝提交】')
    for (const c of enforceable) lines.push(`  - ${c.rule ?? c.id}`)
  }
  return lines.join('\n')
}

// ── JSON-RPC over stdio ────────────────────────────────────────
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

function handle(msg) {
  const { id, method, params } = msg

  switch (method) {
    case 'initialize':
      log(`客户端 ${params?.clientInfo?.name ?? '未知'} 接入，包=${PKG}`)
      return reply(id, {
        // 回声客户端声明的版本：服务端支持面很窄，兼容性优先于表态
        protocolVersion: params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'benxiang-memory', version: '0.1.0' },
        instructions:
          '本项目的世界状态存在本象包里，不在聊天记录里。开工前先 origin_state 取投影；' +
          '每做完一件有结论的事就 origin_commit 提交一次；对某个值有疑问用 origin_why 查它凭什么。',
      })

    case 'notifications/initialized':
      return // 通知无需响应

    case 'ping':
      return reply(id, {})

    case 'tools/list':
      return reply(id, { tools: TOOLS })

    case 'tools/call': {
      const fn = HANDLERS[params?.name]
      if (!fn) return fail(id, -32602, `未知工具 ${params?.name}`)
      try {
        return reply(id, { content: [{ type: 'text', text: String(fn(params.arguments ?? {})) }] })
      } catch (e) {
        // 门禁拒绝不是服务器故障：作为工具错误返回，模型据此重写再提交
        return reply(id, { content: [{ type: 'text', text: e.message }], isError: true })
      }
    }

    default:
      if (id !== undefined) fail(id, -32601, `未实现的方法 ${method}`)
  }
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    try { handle(JSON.parse(line)) }
    catch (e) { log(`解析失败：${e.message}`) }
  }
})
process.stdin.on('end', () => process.exit(0))

export { TOOLS, HANDLERS, MEMORY_CONSTRAINTS, MEMORY_MANIFEST, initPackage }
