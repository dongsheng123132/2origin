#!/usr/bin/env node
// xlsx 方言体检报告 —— diagnose 的原始输出是给机器判的（error 就是 error），
// 这份报告是给人看的：同样的红点，但补上「这格是不是该由人决定」「凭什么是这个数」
// 「哪些明知查不到」三层人话，否则拿到 diagnose.txt 的人只会去问写这段代码的人。
//
//   node adapters/xlsx/report.mjs <包路径> [--key 汇总!B3] [--depth 8]
//
// 不写一次性脚本——这条教训 textbook 方言已经交过一次学费（同一份报告写过三次，
// 每次都在下一个案例上重写）。这里把它做成方言自带的生成器，输入任意一个
// xlsx 方言的 .origin 包都能跑，不绑定任何具体案例的表名/列名。

import { loadOrigin } from '../../compiler/origin.mjs'
import { diagnose } from '../../compiler/provenance.mjs'
import { renderLimits } from '../../compiler/limits.mjs'
import { trace, render as renderTrace, leaves, toId } from './trace.mjs'
import { staleCells } from './project.mjs'

// diagnose() 只把 checkConstraints 的 code 归一成字面量 'constraint'，具体是哪条规则
// 得从 msg 里的对象引用尾巴（`.hardcoded_in_block`、`.error` …）反推——这不是脆弱的字符串猜测，
// 是 constraints.mjs 里 pred() 的报文格式本身就长这样（见 compiler/constraints.mjs 的谓词实现）。
const FIELD_RE = /\.(\w+)(?:\s|$)/

/** 红点表按 severity 分组渲染，A1 地址与对象 ID 双写——人读地址，程序读 ID。 */
function renderFindingsTable(findings, origin) {
  if (!findings.length) return '（无）'
  return findings.map((f, i) => {
    const objId = f.msg.match(/(cell:[^\s.]+|header:[^\s.]+)/)?.[1]
    const cell = objId ? origin.state[objId] : null
    const ref = cell?.sheet && cell?.ref ? `${cell.sheet}!${cell.ref}` : (objId ?? '（非单格问题）')
    const field = f.msg.match(FIELD_RE)?.[1] ?? f.code
    return `| ${i + 1} | ${field} | ${ref} | ${objId ?? '—'} | ${cell?.value ?? '—'} | ${cell?.formula ? `=${cell.formula}` : '—'} | ${f.msg} |`
  }).join('\n')
}

/**
 * 「必须由人来定」清单——不是每条 error 都能靠加规则解决，
 * hardcoded_in_block 这类问题机器只能判「有」，判不了「该不该有」。
 */
function humanCallItems(findings) {
  const byField = {
    hardcoded_in_block: (f) => `${f.msg.split('｜')[1] ?? f.msg} —— 是有意保底的值，还是有人忘了改回公式？机器分不出来，只能报「不一致」。`,
    error: (f) => `${f.msg.split('｜')[1] ?? f.msg} —— 这格错误值是本该有人处理的真实异常，还是分母恰好在这个场景下允许为零？需要人读一下上下文。`,
    bad_ref: (f) => `${f.msg.split('｜')[1] ?? f.msg} —— 是删表/改名后忘了清的死引用，还是故意占位、等那张表补回来？`,
    range_gap: (f) => `${f.msg.split('｜')[1] ?? f.msg} —— 漏掉的这一行是该并入合计，还是本来就该排除（比如冲正/作废行）？`,
    formula_shape: (f) => `${f.msg.split('｜')[1] ?? f.msg} —— 形状不同可能是错行，也可能是这一行本来就该用不同的算法（警告级，不是错误级，正因为机器拿不准）。`,
    text_number: (f) => `${f.msg.split('｜')[1] ?? f.msg} —— 是外部系统导出格式导致的，还是有人手填漏了转数字？`,
  }
  return findings.map((f) => byField[f.msg.match(FIELD_RE)?.[1]]?.(f)).filter(Boolean)
}

/** 结构性重算：哪些格子落在「公式块」内却不是公式——本方言只报数字型硬编码，
 *  文字型（如粘贴文本）故意不报（xlsx-text-paste-undetectable）。这里把两类都数出来，
 *  用来回答「报了什么就等于没报什么」。 */
function blockExemptions(origin) {
  const bySheetCol = new Map()
  for (const o of origin.objects) {
    if (o.type !== 'cell') continue
    const k = `${o.sheet}!${o.col}`
    if (!bySheetCol.has(k)) bySheetCol.set(k, [])
    bySheetCol.get(k).push(o)
  }
  const headerCount = origin.objects.filter((o) => o.type === 'header').length
  let textInBlock = 0
  for (const [, cells] of bySheetCol) {
    const formulaRows = cells.filter((c) => c.kind === 'formula').map((c) => c.row)
    if (!formulaRows.length) continue
    const first = Math.min(...formulaRows)
    const last = Math.max(...cells.filter((c) => c.kind !== 'empty').map((c) => c.row))
    for (const c of cells) {
      if (c.row < first || c.row > last) continue
      if (c.kind === 'text') textInBlock++
    }
  }
  const findings = diagnose(origin).findings
  const warningShapeCells = findings.filter((f) => f.severity === 'warning' && f.msg.match(FIELD_RE)?.[1] === 'formula_shape').length
  return { headerCount, textInBlock, warningShapeCells }
}

function main() {
  const [dir] = process.argv.slice(2)
  if (!dir) { process.stderr.write('用法：report.mjs <包路径> [--key 汇总!B3] [--depth 8]\n'); process.exit(2) }
  const opt = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d }

  const origin = loadOrigin(dir)
  const findings = diagnose(origin).findings
  const errors = findings.filter((f) => f.severity === 'error')
  const warnings = findings.filter((f) => f.severity === 'warning')

  const cellObjs = origin.objects.filter((o) => o.type === 'cell')
  const formulaCells = cellObjs.filter((o) => o.kind === 'formula')
  const numberCols = new Set(cellObjs.filter((o) => o.kind === 'input').map((o) => `${o.sheet}!${o.col}`))
  const depCount = origin.relations.filter((r) => r.predicate === 'depends_on').length
  const truncated = origin.limits.find((l) => l.code === 'xlsx-truncated')

  const keyRef = opt('--key', null)
  const depth = Number(opt('--depth', '8'))
  let traceSection = '未指定 --key，跳过依赖追溯（用法：report.mjs <包路径> --key 汇总!B3）'
  if (keyRef) {
    const id = toId(keyRef)
    if (id && origin.state[id]) {
      const tree = trace(origin, id, { depth })
      const src = leaves(tree)
      traceSection = renderTrace(tree) + `\n这个数最终由 ${src.length} 个人工录入的格子决定：${src.map((n) => n.ref).join('、') || '（无）'}`
    } else {
      traceSection = `包里没有 ${keyRef}（认不出地址或对象不存在）`
    }
  }

  const staleIds = staleCells(origin)
  const staleSection = staleIds.length
    ? staleIds.map((id) => {
        const c = origin.state[id]
        return `  · ${c?.sheet ?? id}!${c?.ref ?? ''}（缓存值 ${JSON.stringify(c?.value)}，公式 =${c?.formula}）——依赖链上有输入格已改动，此格缓存值已知过期，程序读到的仍是旧值`
      }).join('\n')
    : '本包 provenance/history.jsonl 里没有 state_change 记录，无过期格可报（尚未发生过任何事务）。'

  const exempt = blockExemptions(origin)

  const out = `# xlsx 方言体检报告

包：\`${dir}\`　生成时间：${new Date().toISOString()}

## 1. 一句话结论 + 计分板

- **error ${errors.length} 条 / warning ${warnings.length} 条**
- 覆盖 ${cellObjs.length} 个数据格（另有 ${origin.objects.filter((o) => o.type === 'header').length} 个表头对象，不参与列级规则）
- 公式格 ${formulaCells.length} 个，纯数值输入列 ${numberCols.size} 列
- 依赖关系 ${depCount} 条
- 截断格数：${truncated ? truncated.statement : '0（未触发 --max-cells，本包未截断）'}

${errors.length ? '**存在 error 级问题，不建议把这份表当权威数据源直接引用。**' : '**未发现 error 级问题**（这不等于没有问题——见第 6 节「这台机器抓不到什么」）。'}

## 2. 必须由人来定的事

${humanCallItems(errors.concat(warnings)).map((s) => `- ${s}`).join('\n') || '（本次体检没有需要人工判定的红点）'}

## 3. 红点表

### error 级

| # | 规则 | 单元格 | 对象 ID | 现值 | 公式 | 判据消息 |
|---|---|---|---|---|---|---|
${renderFindingsTable(errors, origin)}

### warning 级

| # | 规则 | 单元格 | 对象 ID | 现值 | 公式 | 判据消息 |
|---|---|---|---|---|---|---|
${renderFindingsTable(warnings, origin)}

## 4. 这个数凭什么是这个数

${traceSection}

## 5. 报了什么就等于没报什么（假警报防线）

- 表头对象：${exempt.headerCount} 个（与列里的数据点分开建对象，不会被列级规则连坐）
- 公式块内的**文本**格：${exempt.textInBlock} 个（本方言只判「块内硬编码数字」，文字型不报——见 limits 里的 \`xlsx-text-paste-undetectable\`；这是主动付的假阳性代价，不是漏判）
- 公式形状被判定为"不一致"从而报 warning 的格数：${exempt.warningShapeCells}（其余"形状不同但在允许集合内"的格子，比如合计行的 SUM 与正文的四则运算，不报）

## 6. 这台机器抓不到什么

${renderLimits(origin.limits)}

## 7. 如果改了会怎样（缓存值过期传播）

${staleSection}

## 8. 复核命令

\`\`\`bash
node compiler/cli.mjs diagnose ${dir}
node adapters/xlsx/trace.mjs ${dir} "${keyRef ?? '<表!列行>'}" --depth ${depth}
node adapters/xlsx/report.mjs ${dir} --key "${keyRef ?? '<表!列行>'}"
\`\`\`

## 9. 口径声明

- 本报告由 \`adapters/xlsx/report.mjs\` 直接读取 \`${dir}\` 生成，未经人工编辑数字；如与本文件内容不符，以重新运行上面命令的结果为准。
- 判定人：机器判据（\`dialect.mjs\` 的 \`xlsxConstraints\`），非人工抽查；第 2 节「必须由人来定」清单本身不是判定，是提醒。
- 三条公式类规则（formula-column-purity / formula-column-consistency / aggregate-covers-data）未在真实财务模型上验证过假阳性率，见 limits 中的 \`xlsx-formula-rules-unverified\`。
`

  process.stdout.write(out)
}

main()
