#!/usr/bin/env node
// 收料体检 —— 别人给来一份文书，先看它够不够格做体检。
//
//   node adapters/law/intake.mjs <文书.txt> [--lawdb 条文库.json] [--json]
//   node adapters/law/intake.mjs 收到的/*.txt        # 多份一起看
//
// 为什么要单独一个命令：`diagnose` 回答「这份判决有没有毛病」，
// 但真实收料时第一个问题是**「这份材料我能不能查」**——段落标记认不认得、
// 引用解析得出来吗、量刑中间量有没有。这两件事混在一起报，会出现最坏的结果：
// 解析失败导致零 error，被读成「体检通过」。
//
// 所以收料体检只报**可用度**，一个问题都不判。判断留给 diagnose。

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { splitSections, parseCaseNo, cnDate, extractCitations, parseWorksheet, extractAmounts, extractTerms } from './parse.mjs'
import { loadLawDb, judgeCitation } from './import.mjs'
import { CITABLE_AS_BASIS } from './dialect.mjs'

/**
 * 一份材料里可能装着多份文书——提示词要求对方的 AI 用单独一行 `========` 分隔。
 * 分隔线宽松匹配（4 个以上等号/横线），因为模型总会把 8 个等号写成 6 个或换成破折号。
 */
export function splitBundle(text) {
  return String(text ?? '')
    .split(/^[\s　]*[=＝\-—]{4,}[\s　]*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 80) // 太短的多半是分隔线残渣或"以上"之类的收尾语
}

/** @returns { items: [{key, ok, detail}], score, max, 可做, 不可做, 未命中引用 } */
export function inspectIntake(text, { db } = {}) {
  const sec = splitSections(text)
  const head = parseCaseNo((sec.首部 ?? '') + (sec.查明 ?? ''))
  const judgedAt = cnDate(sec.主文 ?? '') ?? cnDate(text)
  const caseType = head?.类型 ?? '刑事'
  const whitelist = CITABLE_AS_BASIS[caseType] ?? CITABLE_AS_BASIS.刑事

  const evidence = (sec.证据 ?? '').split('\n')
    .filter((l) => /^[\s　]*[0-9０-９一二三四五六七八九十]+\s*[.．、]\s*\S/.test(l))
  const basisCites = extractCitations(sec.依据 ?? '')
  const proseCites = extractCitations(sec.说理 ?? '')
  const 未命中 = []
  let 命中 = 0
  for (const c of [...basisCites, ...proseCites]) {
    const v = db ? judgeCitation(c, { db, at: judgedAt, whitelist, position: '裁判依据' }) : { status: 'not-found' }
    // uncovered 也要收——真实部署的部分库返回的正是它。只收 not-found 的话，
    // 收料体检会在覆盖率为零时报「一条都不缺」，把最该暴露的问题藏起来。
    if (v.status === 'not-found' || v.status === 'uncovered') 未命中.push(c.raw)
    else 命中++
  }
  const ws = parseWorksheet(sec.评议)
  const 说理金额 = extractAmounts(sec.说理 ?? '')
  const 查明金额 = extractAmounts(sec.查明 ?? '')
  const 主文刑期 = extractTerms(sec.主文 ?? '')

  const items = [
    { key: '案号', ok: !!head, detail: head ? `${head.案号}　${head.类型}·${head.审级}审` : '未识别——首部里找不到「（YYYY）…刑/民/行初…号」' },
    { key: '裁判日期', ok: !!judgedAt, detail: judgedAt ? `${judgedAt}（取落款）` : '未识别——落款处需保留「二〇二六年七月十五日」或「2026年7月15日」' },
    { key: '查明段', ok: !!sec.查明, detail: sec.查明 ? `${sec.查明.replace(/\s/g, '').length} 字，识别金额 ${查明金额.length} 处${查明金额[0] ? '：' + 查明金额[0].value : ''}` : '未识别——需保留「经审理查明」这句' },
    { key: '证据段', ok: evidence.length > 0, detail: evidence.length ? `${evidence.length} 项（编号列举）` : '未识别——证据需按「1. 2. 3.」逐项编号列举' },
    { key: '说理段', ok: !!sec.说理, detail: sec.说理 ? `${sec.说理.replace(/\s/g, '').length} 字，识别金额 ${说理金额.length} 处` : '未识别——需保留「本院认为」这句' },
    { key: '裁判依据段', ok: basisCites.length > 0, detail: basisCites.length ? `${basisCites.length} 处引用，条文库命中 ${命中}，未覆盖 ${未命中.length}` : '未识别——需保留「依照《…》第…条…之规定，判决如下」整句' },
    { key: '判决主文', ok: 主文刑期.length > 0 || !!sec.主文, detail: sec.主文 ? `识别刑期 ${主文刑期.length} 处${主文刑期[0] ? '：' + 主文刑期[0].value + ' 月' : ''}` : '未识别——需保留「判决如下：」及其后的主文' },
    { key: '量刑评议表', ok: !!ws && Number.isFinite(ws.基准刑), detail: ws && Number.isFinite(ws.基准刑) ? `基准刑 ${ws.基准刑} 月，${ws.factors.length} 个情节` : '缺失（判决书正文里本来就没有，不是材料的错）' },
  ]

  const 可做 = []
  const 不可做 = []
  // 认得出引用还不够，条文库得真覆盖到才谈得上「能查」。过半未覆盖时这一项降级为不可做——
  // 否则「可做：A 引用体检」+「✓ 无 error」两句连起来读，就是「这份文书的引用都合规」，
  // 而真相是一条都没查。这与 intake 存在的理由是同一条：解析/覆盖的失败不许伪装成体检通过。
  // 分母必须是**参与判定的全部引用**（裁判依据位 + 说理位），与上面那个循环同口径。
  // 拿 basisCites 当分母会算出「6 处里 7 处没覆盖」这种比 1 还大的比例。
  const 引用总数 = basisCites.length + proseCites.length
  const 引用可查 = basisCites.length > 0 && 引用总数 > 0 && 未命中.length / 引用总数 <= 0.5
  ;(引用可查 ? 可做 : 不可做).push(
    basisCites.length && !引用可查
      ? `A 引用体检（识别出 ${引用总数} 处引用，其中 ${未命中.length} 处条文库未覆盖——先补库）`
      : 'A 引用体检（存在 / 有效 / 可否作裁判依据）'
  )
  ;(evidence.length && ws?.factors?.length ? 可做 : 不可做).push('C 证据支撑（情节是否挂证据、是否重复评价）')
  ;(ws && Number.isFinite(ws.基准刑) ? 可做 : 不可做).push('D 数字可复算（区间 / 复算 / 20% 幅度）')
  ;(查明金额.length && 说理金额.length ? 可做 : 不可做).push('D 正文对照（说理段与认定事实的数字是否一致）')

  return { items, score: items.filter((i) => i.ok).length, max: items.length, 可做, 不可做, 未命中引用: 未命中, head, judgedAt }
}

// ── CLI ─────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith('intake.mjs')) {
  const argv = process.argv
  const SPLIT_TO = argv.indexOf('--split') >= 0 ? argv[argv.indexOf('--split') + 1] : null
  const skip = new Set([argv[argv.indexOf('--lawdb') + 1], SPLIT_TO].filter(Boolean))
  const files = argv.slice(2).filter((a) => !a.startsWith('--') && !skip.has(a))
  if (!files.length) {
    process.stderr.write('用法：intake.mjs <文书.txt> [更多…] [--split 输出目录] [--lawdb 条文库.json] [--json]\n' +
      '      一个文件里含多份文书时（用 ======== 分隔），加 --split 拆成单份再逐份体检\n')
    process.exit(2)
  }
  const li = argv.indexOf('--lawdb')
  const db = loadLawDb(li >= 0 ? argv[li + 1] : undefined)
  const JSON_MODE = argv.includes('--json')

  // 对方的 AI 按提示词把多份文书装在一坨里——先拆开，每份单独成一件材料
  const docs = []
  for (const f of files) {
    if (!existsSync(f)) { process.stderr.write(`跳过：${f} 不存在\n`); continue }
    const parts = splitBundle(readFileSync(f, 'utf8'))
    if (parts.length > 1 && !JSON_MODE) process.stderr.write(`${basename(f)}：含 ${parts.length} 份文书，已拆开\n`)
    parts.forEach((text, i) => docs.push({ name: parts.length > 1 ? `${basename(f)}#${i + 1}` : basename(f), text }))
  }
  if (SPLIT_TO) {
    mkdirSync(SPLIT_TO, { recursive: true })
    docs.forEach((d, i) => {
      const p = join(SPLIT_TO, `${String(i + 1).padStart(2, '0')}-${(parseCaseNo(d.text)?.案号 ?? 'unknown').replace(/[（）()]/g, '')}.txt`)
      writeFileSync(p, d.text + '\n', 'utf8')
      process.stdout.write(p + '\n')
    })
    process.stderr.write(`已拆出 ${docs.length} 份到 ${SPLIT_TO}/\n`)
  }

  let worst = 0
  const all = []
  for (const d of docs) {
    const r = inspectIntake(d.text, { db })
    all.push({ file: d.name, ...r })
    if (JSON_MODE) { worst = Math.max(worst, r.items.slice(0, 7).filter((i) => !i.ok).length); continue }

    process.stderr.write(`\n收料体检：${d.name}\n`)
    for (const i of r.items) process.stdout.write(`${i.ok ? '✓' : '✗'}\t${i.key}\t${i.detail}\n`)
    process.stderr.write(`\n可做：${r.可做.length ? r.可做.join('　/　') : '（无）'}\n`)
    if (r.不可做.length) process.stderr.write(`不可做：${r.不可做.join('　/　')}\n`)
    if (r.未命中引用.length) {
      // 覆盖率必须在判定之前就摆出来。库没覆盖到的引用是**没查**，既不是「查过没问题」
      // 也不是「有问题」——不先说清楚，后面那句「✓ 无 error」会被读成「引用都合规」。
      process.stderr.write(`条文库未覆盖（这些引用**未校验**，补进 lawdb.json 才能判有效性）：\n`)
      for (const c of r.未命中引用) process.stderr.write(`  · ${c}\n`)
      // 同口径：分母取「命中 + 未覆盖」，即真正参与判定的全部引用
      const 命中数 = Number(r.items.find((i) => i.key === '裁判依据段')?.detail?.match(/命中 (\d+)/)?.[1] ?? 0)
      const 总引用 = 命中数 + r.未命中引用.length
      if (总引用 > 0 && r.未命中引用.length / 总引用 > 0.5)
        process.stderr.write(`  ⚠ 过半引用未覆盖——本份材料的「引用体检」结论不可采信，先补库\n`)
    }
    process.stderr.write(`可用度 ${r.score}/${r.max}\n`)
    // 前 6 项是判决书正文里本该有的；量刑评议表缺失不算材料不合格
    worst = Math.max(worst, r.items.slice(0, 7).filter((i) => !i.ok).length)
  }
  if (JSON_MODE) process.stdout.write(JSON.stringify({ ok: worst === 0, files: all }, null, 2) + '\n')
  process.exit(worst === 0 ? 0 : 1)
}
