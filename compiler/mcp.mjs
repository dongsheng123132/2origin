#!/usr/bin/env node
// 协议级 MCP Server —— 让 AI 直接用本象，而不是先学会 shell。
//
//   claude mcp add -s local benxiang -- node <绝对路径>/compiler/mcp.mjs [--root <允许访问的目录>]
//
// ## 和 adapters/memory/mcp-server.mjs 的分工
//
// 那一个是**记忆方言**的服务器：绑定单个包，工具围绕「项目状态」设计。
// 这一个是**协议**的服务器：对任何 .origin 包工作，并且能把 xlsx / dxf / 判决书
// 现场导入成包、再投影回去。前者是一个应用，后者是运行时。
//
// ## 给 AI 用的接口要按 AI 的失败模式设计
//
// 三条，都是从这个仓库自己的教训来的：
//
// ① **先问边界，再信结果。** origin_limits 的描述里明写「接手陌生包时第一个调用它」——
//    因为一个包最危险的性质不是它有什么，是它**保证不了什么**却没人说。
//    体检报「零 error」可能是「都合规」，也可能是「一条都没查」（法律方言真出过这事）。
//
// ② **拒绝要能被拿去重写，而不是「失败了」。** 提交不过时把违规原文原样返回，
//    模型据此改完再交。所以 tools/call 里门禁拒绝走 isError 而不是 JSON-RPC error——
//    后者在多数客户端里会被当成服务器故障，模型看不到理由。
//
// ③ **写入只有一个入口。** 只有 origin_commit 会写状态，且校验不过一字节不写。
//    给 AI 一堆写接口，等于把「保证一致」这件事外包给模型的自觉。

import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import { loadOrigin } from './origin.mjs'
import { normalizeId } from './commit-compiler.mjs'
import { why, historyOf, diagnose } from './provenance.mjs'
import { commit, seqOf } from './store.mjs'
import { checkLimits, relevantLimits, renderLimits } from './limits.mjs'
import { planProjection, disclosure } from './project.mjs'

const argv = process.argv.slice(2)
const optOf = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
/** 沙箱根。不给就是整个文件系统——本地开发方便，但生产部署应当给。 */
const ROOT = optOf('--root') ? resolve(optOf('--root')) : null

const log = (m) => process.stderr.write(`[benxiang] ${m}\n`)

/** 路径闸门：给了 --root 就不许跑出去。这是商用部署的最低要求。 */
function guard(p) {
  if (!p) throw new Error('缺少 pkg 参数（本象包目录路径）')
  const abs = isAbsolute(p) ? resolve(p) : resolve(process.cwd(), p)
  if (ROOT) {
    const rel = relative(ROOT, abs)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`路径越界：${p} 不在允许的根目录 ${ROOT} 内`)
  }
  return abs
}

const open = (p) => {
  const dir = guard(p)
  if (!existsSync(dir)) throw new Error(`包不存在：${dir}`)
  return loadOrigin(dir)
}

// ── 工具表 ──────────────────────────────────────────────────────
// description 是写给模型看的，不是写给文档生成器看的：说清楚**什么时候该调它**。
const TOOLS = [
  {
    name: 'origin_limits',
    description:
      '这个包**保证不了什么**——已知的退化、未覆盖的范围、确定性检查抓不到的类别、尚未验证的主张。'
      + '\n\n**接手一个陌生包时第一个调用它。** 一个包最危险的性质不是它有什么，'
      + '而是它保证不了什么却没人说：体检报「零 error」可能是「都合规」，也可能是「一条都没查」。'
      + '\n拿到结果后，凡是落在 limits 范围内的结论都不要当作确定事实转述给用户。',
    inputSchema: {
      type: 'object',
      properties: {
        pkg: { type: 'string', description: '本象包目录路径' },
        scope: { type: 'string', description: '只要与该范围相关的边界，如 "cell:*"。lossy 与 degraded 两类无论如何都会返回' },
      },
      required: ['pkg'],
    },
  },
  {
    name: 'origin_status',
    description: '这个包里有什么：对象数、关系数、约束数、变更数、最后一次改动。用来快速判断包的规模与是否被改过。',
    inputSchema: { type: 'object', properties: { pkg: { type: 'string' } }, required: ['pkg'] },
  },
  {
    name: 'origin_why',
    description:
      '这个值凭什么是这个值——某个字段的完整改动链，含每次是谁改的、依据什么。'
      + '\n用户问「这个数怎么来的」「谁改的」「凭什么」时用它。引用格式 `对象ID.字段`，'
      + '对象 ID 前缀可省（black-key.holder 会被归一化为 obj:black-key.holder）。',
    inputSchema: {
      type: 'object',
      properties: { pkg: { type: 'string' }, ref: { type: 'string', description: '如 cell:预算!C/5.value' } },
      required: ['pkg', 'ref'],
    },
  },
  {
    name: 'origin_diagnose',
    description:
      '包体检：约束有没有被违反、引用悬不悬空、有没有双份账本。'
      + '\n\n⚠️ **零 error 不等于没问题**——它只等于「已启用的检查都过了」。'
      + '解读结果前先调 origin_limits 看有哪些检查根本没启用或已知抓不到。',
    inputSchema: { type: 'object', properties: { pkg: { type: 'string' } }, required: ['pkg'] },
  },
  {
    name: 'origin_history',
    description: '变更时间线，可按对象/字段/事务/责任者过滤。用于「最近改了什么」「某人改过哪些」。',
    inputSchema: {
      type: 'object',
      properties: {
        pkg: { type: 'string' }, object: { type: 'string' }, field: { type: 'string' },
        by: { type: 'string' }, limit: { type: 'number', description: '最多返回几条，缺省 20' },
      },
      required: ['pkg'],
    },
  },
  {
    name: 'origin_commit',
    description:
      '**唯一的写入口。** 把状态变化提交为一个语义事务。'
      + '\n\n校验不通过时**一个字节都不会写**，并把违规理由原样返回——按理由改完再提交即可，'
      + '不要绕过它去改文件。传 expect_seq（先用 origin_status 取）可发现有没有别人插队。'
      + '\n新建对象必须在 creates 里显式声明，否则 ID 打错一个字母会静默造出一个永远没人管的幽灵对象。',
    inputSchema: {
      type: 'object',
      properties: {
        pkg: { type: 'string' },
        transaction: {
          type: 'object',
          description: '语义事务：{ transaction_id?, operation?, creates?: [{id,type}], state_changes: [{object,field,op?,from?,to}] }',
        },
        by: { type: 'string', description: '责任者。「谁改的」不许缺省为匿名' },
        expect_seq: { type: 'number', description: '读取状态时的 seq 水位，用于检测插队' },
      },
      required: ['pkg', 'transaction'],
    },
  },
  {
    name: 'origin_project',
    description:
      '把包投影成一份可交付的文件（目前支持 xlsx）。'
      + '\n\n**投影必然有损**：返回值里的 dropped 列出了这次没能带走的信息（诊断结论、证据链、'
      + '以及缓存值已过期的公式格）。把文件交给用户时，请一并转述 dropped——'
      + '一份不声明自己丢了什么的投影，会被当成本体使用。',
    inputSchema: {
      type: 'object',
      properties: {
        pkg: { type: 'string' },
        out: { type: 'string', description: '输出文件路径，如 /tmp/报表.xlsx' },
        format: { type: 'string', enum: ['xlsx'], description: '缺省 xlsx' },
      },
      required: ['pkg', 'out'],
    },
  },
  {
    name: 'origin_import',
    description:
      '把一个源文件导入成本象包：.xlsx（电子表格）/ .dxf（CAD 图纸）/ .txt（裁判文书）。'
      + '\n导入后包里就有了对象、关系、约束与边界声明，随后可以 diagnose / why / commit / project。'
      + '\n认不出格式时会说明它到底是什么、以及该怎么办（例如 .xlsx 其实是 HTML 改的扩展名）。',
    inputSchema: {
      type: 'object',
      properties: {
        src: { type: 'string', description: '源文件路径' },
        pkg: { type: 'string', description: '要生成的包目录路径' },
      },
      required: ['src', 'pkg'],
    },
  },
]

// ── 处理器 ──────────────────────────────────────────────────────
const j = (o) => JSON.stringify(o, null, 2)

const HANDLERS = {
  origin_limits({ pkg, scope }) {
    const o = open(pkg)
    const list = relevantLimits(o.limits ?? [], scope ?? null)
    const malformed = checkLimits(o.limits ?? [])
    return renderLimits(list)
      + (malformed.length ? `\n\n⚠ 边界声明本身有 ${malformed.length} 处不合格：\n` + malformed.map((m) => `  · ${m.msg}`).join('\n') : '')
      + `\n\n（共 ${(o.limits ?? []).length} 条，本次返回 ${list.length} 条）`
  },

  origin_status({ pkg }) {
    const o = open(pkg)
    const d = diagnose(o)
    const changes = o.history.filter((e) => e.event === 'state_change')
    return j({
      pkg: o.dir,
      artifact: o.manifest.artifact?.id ?? null,
      objects: d.objects, relations: d.relations,
      constraints: d.constraints, limits: (o.limits ?? []).length,
      changes: d.changes, seq: seqOf(o.dir),
      last_change: changes[changes.length - 1] ?? null,
      hint: (o.limits ?? []).length ? '这个包声明了边界，解读任何结论前先调 origin_limits。' : '⚠ 这个包未声明任何边界——这不等于它没有边界，只等于没人写下来。',
    })
  },

  origin_why({ pkg, ref }) {
    const o = open(pkg)
    const i = String(ref).lastIndexOf('.')
    if (i <= 0) throw new Error(`「${ref}」不是合法引用，应形如 对象ID.字段`)
    const object = normalizeId(ref.slice(0, i), o.ids)
    if (!o.ids.has(object)) throw new Error(`未知对象 ${ref.slice(0, i)}`)
    return j(why({ state: o.initial, history: o.history, object, field: ref.slice(i + 1) }))
  },

  origin_diagnose({ pkg }) {
    const o = open(pkg)
    const d = diagnose(o)
    return j({
      ...d,
      limits_declared: (o.limits ?? []).length,
      caveat: '零 error 只等于「已启用的检查都过了」。哪些检查没启用、哪些已知抓不到，见 origin_limits。',
    })
  },

  origin_history({ pkg, object, field, by, limit = 20 }) {
    const o = open(pkg)
    return j(historyOf(o.history, {
      object: object ? normalizeId(object, o.ids) : undefined, field, by, limit,
    }))
  },

  origin_commit({ pkg, transaction, by = 'mcp-client', expect_seq }) {
    const dir = guard(pkg)
    const r = commit(dir, transaction, { by, expectedSeq: expect_seq === undefined ? null : Number(expect_seq) })
    if (r.ok) return `✓ 已落盘 seq ${r.receipt.seq_from}–${r.receipt.seq_to}，责任者 ${by}\n改动：${r.receipt.changed.join('、')}`
    // 门禁拒绝：把违规原文原样交回去，模型据此重写。这不是服务器故障。
    throw new Error('提交被拒绝，一个字节都没写。逐条修正后重新提交：\n'
      + r.violations.map((v) => `  - [${v.severity ?? 'error'}] ${v.code ?? ''} ${v.msg}`).join('\n'))
  },

  async origin_project({ pkg, out, format = 'xlsx' }) {
    if (format !== 'xlsx') throw new Error(`暂不支持投影为 ${format}，目前只有 xlsx`)
    const o = open(pkg)
    const dest = guard(out)
    const { projectToXlsx } = await import('../adapters/xlsx/project.mjs')
    const { writeFileSync } = await import('node:fs')
    const { appendHistory } = await import('./store.mjs')
    const { projectionRecord } = await import('./project.mjs')
    const { buffer, plan } = projectToXlsx(o)
    writeFileSync(dest, buffer)
    appendHistory(o.dir, [projectionRecord(plan, { by: 'mcp-client', output: dest })])
    return `已投影 ${plan.selected.length} 个对象 → ${dest}（来源 seq ${plan.at_seq}）\n\n`
      + disclosure(plan)
      + '\n\n把文件交给用户时请一并转述上面这段——一份不声明自己丢了什么的投影会被当成本体使用。'
  },

  async origin_import({ src, pkg }) {
    const file = guard(src)
    const dir = guard(pkg)
    if (!existsSync(file)) throw new Error(`源文件不存在：${file}`)
    const ext = file.toLowerCase().slice(file.lastIndexOf('.'))

    if (ext === '.xlsx') {
      const { parseXlsx } = await import('../adapters/xlsx/xlsx.mjs')
      const { materialize, toObjects, sniff } = await import('../adapters/xlsx/import.mjs')
      const { xlsxConstraints, xlsxLimits, XLSX_MANIFEST } = await import('../adapters/xlsx/dialect.mjs')
      const buf = readFileSync(file)
      const probe = sniff(buf.subarray(0, 512))
      // 认不出时说清楚它到底是什么、以及该怎么办——一句笼统的「不支持」会让人去试错误的方向
      if (!probe.readable) throw new Error(`无法导入：${probe.why}\n\n${probe.how}`)
      const wb = parseXlsx(buf)
      const profiles = materialize(wb)
      const name = file.split(/[\\/]/).pop().replace(/\.xlsx$/i, '')
      const { objects, relations, truncated } = toObjects(wb, { name, source: file, maxCells: 20000 })
      const { initPackage } = await import('./store.mjs')
      initPackage(dir, {
        manifest: XLSX_MANIFEST(name, name, file), objects, relations,
        constraints: xlsxConstraints(profiles), limits: xlsxLimits({ truncated }),
      })
      return `已导入 ${name}：${wb.sheets.length} 表、${objects.filter((o) => o.type === 'cell').length} 格、${relations.length} 条依赖 → ${dir}\n`
        + `下一步建议：origin_limits 看边界，再 origin_diagnose 体检。`
    }

    throw new Error(`暂不支持 ${ext}。当前 MCP 面支持 .xlsx；.dxf 与判决书请用命令行：`
      + `\n  node adapters/cad/import.mjs <图.dxf> <包>\n  node adapters/law/import.mjs <文书.txt> <包>`)
  },
}

// ── JSON-RPC over stdio ────────────────────────────────────────
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

async function handle(msg) {
  const { id, method, params } = msg
  switch (method) {
    case 'initialize':
      log(`客户端 ${params?.clientInfo?.name ?? '未知'} 接入${ROOT ? `，沙箱根=${ROOT}` : '（未设 --root，可访问整个文件系统）'}`)
      return reply(id, {
        protocolVersion: params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'benxiang', version: '0.1.0' },
        instructions:
          '本象协议运行时。把 Excel/CAD/文书导成本象包后，AI 可以查「这个值凭什么」、'
          + '体检、以事务方式修改（校验不过一字节不写）、再投影回可交付文件。\n'
          + '**接手任何陌生包，第一件事是 origin_limits**——它说清楚这个包保证不了什么。'
          + '零 error 不等于没问题，可能只是一条都没查。\n'
          + '写状态只有 origin_commit 一条路；被拒绝时按返回的违规理由改完再交，不要绕过去改文件。',
      })
    case 'notifications/initialized': return
    case 'ping': return reply(id, {})
    case 'tools/list': return reply(id, { tools: TOOLS })
    case 'tools/call': {
      const fn = HANDLERS[params?.name]
      if (!fn) return fail(id, -32602, `未知工具 ${params?.name}`)
      try {
        return reply(id, { content: [{ type: 'text', text: String(await fn(params.arguments ?? {})) }] })
      } catch (e) {
        // 门禁拒绝不是服务器故障：作为工具错误返回，模型据此重写再提交
        return reply(id, { content: [{ type: 'text', text: e.message }], isError: true })
      }
    }
    default:
      if (id !== undefined) fail(id, -32601, `未实现的方法 ${method}`)
  }
}

if (!argv.includes('--no-serve')) {
  // 在途请求计数。**没有它，异步工具会静默丢响应**：
  // stdin 一 EOF 就 process.exit(0)，而 origin_import / origin_project 还在 await 里，
  // 客户端永远等不到那个 id 的回复，且看不到任何错误。
  // 同步工具碰不到这个坑，所以它只在接了异步工具之后才暴露出来——实测就是这么发现的。
  // **串行处理，不是并发。** 两个理由：
  //   ① 顺序即因果。客户端常常紧接着发「导入」「体检」两条；并发处理时体检会先跑完，
  //      对着一个还没建好的包报「包不存在」。实测确实如此。
  //   ② 写入必须串行。store.mjs 有文件锁兜底，但让两个 commit 去抢锁，
  //      不如根本不让它们同时发生——这是在协议层就能消掉的一类竞态。
  // 代价是没有并行度。对这个工作负载（本地文件、毫秒级）不值一提。
  let chain = Promise.resolve()
  let ended = false
  const drain = () => { if (ended) chain.then(() => process.exit(0)) }

  const dispatch = (line) => {
    chain = chain.then(async () => {
      try { await handle(JSON.parse(line)) }
      catch (e) { log(`处理失败：${e.message}`) }
    })
  }

  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buf += chunk
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line) dispatch(line)
    }
  })
  process.stdin.on('end', () => { ended = true; drain() })
}

export { TOOLS, HANDLERS }
