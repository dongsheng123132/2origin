#!/usr/bin/env node
// office 统一 CLI —— docx / xlsx / pptx → 本象包（转换即语义事务）。
//
// 行业四层方案（pandoc / markitdown / MinerU / LlamaParse）全在啃 PDF，
// OCR 物理误差封顶（OmniDocBench 表格 TEDS≈0.78）。原生电子文档
// （docx/xlsx/pptx）的**无损结构**没人认真做——本象的切入点：
//
//   别人做「把纸猜成字」，本象做「把字变成可验证状态的对象」。
//
// 转换不是生成一份文本，而是**建一个本象包**：文档的每一处结构
// （章/条/段落/表格/单元格/幻灯片/形状）都是对象，带内容哈希；
// 此后任何改动以事务追加，于是「这个值凭什么是这个值」永远查得出。
//
// 用法：
//   origin-office import <file.docx|xlsx|pptx> <pkg> [--name 名称]
//   origin-office inspect <file>             只看结构，不建包
//   origin-office verify <pkg> <file>        验证包哈希与源文件一致（可验证性演示）
//
// 零依赖。docx 解析复用 import.mjs，xlsx 复用 adapters/xlsx，pptx 复用 pptx.mjs。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, extname, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { convertDocx } from './import.mjs'
import { convertPptx } from './pptx.mjs'
import { initPackage, seqOf, commit } from '../../compiler/store.mjs'
import { loadOrigin } from '../../compiler/origin.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

// ── 结构抽取：三种格式统一输出 { blocks, stats, objects } ──
// blocks 是给人/AI 看的结构，objects 是进包的对象表（每处结构一个对象）。

function docxObjects(file, buf) {
  const { blocks, stats } = convertDocx(buf)
  const objects = []
  const body = []
  let chapter = 0
  let article = 0
  let table = 0
  blocks.forEach((b, i) => {
    if (b.type === 'p') {
      if (/^第[一二三四五六七八九十百]+章\s/.test(b.text)) chapter++
      if (/^第[一二三四五六七八九十百]+条\s/.test(b.text)) article++
      const id = `par:${String(i).padStart(4, '0')}`
      objects.push({ id, _type: 'paragraph', text: b.text, level: b.level, chapter: chapter || null, article: article || null })
      body.push({ kind: 'paragraph', id, text: b.text, heading: b.level })
    } else {
      table++
      const id = `tbl:${String(table).padStart(2, '0')}`
      objects.push({ id, _type: 'table', gfm: b.gfm, rows: b.rows, cols: Math.round(b.cols) })
      body.push({ kind: 'table', id, rows: b.rows, cols: Math.round(b.cols) })
    }
  })
  return { objects, body, stats }
}

function pptxObjects(file, buf) {
  const { slides, stats } = convertPptx(buf)
  const objects = []
  const body = []
  let n = 0
  for (const s of slides) {
    for (const sh of s.shapes) {
      n++
      if (sh.kind === 'text') {
        const sid = `sld${String(s.no).padStart(2, '0')}-shp${n}`
        objects.push({ id: sid, _type: 'shape', slide: s.no, placeholder: sh.type, text: sh.text })
        body.push({ kind: 'text', slide: s.no, placeholder: sh.type, text: sh.text })
      } else {
        const sid = `sld${String(s.no).padStart(2, '0')}-tbl${n}`
        objects.push({ id: sid, _type: 'table', slide: s.no, rows: sh.rows.length, cols: Math.max(...sh.rows.map((r) => r.length), 0), cells: sh.rows })
        body.push({ kind: 'table', slide: s.no, rows: sh.rows.length, cols: Math.max(...sh.rows.map((r) => r.length), 0) })
      }
    }
  }
  return { objects, body, stats }
}

const extract = (file, buf) => {
  const ext = extname(file).toLowerCase()
  if (ext === '.docx') return docxObjects(file, buf)
  if (ext === '.pptx') return pptxObjects(file, buf)
  if (ext === '.xlsx') throw new Error('xlsx 请用 adapters/xlsx/import.mjs（表格方言有独立的导入器）')
  throw new Error(`不支持的格式 ${ext}（支持 docx / pptx）`)
}

/** 内容哈希：文档结构的指纹。验证时重算比对——「可验证的对象」的凭据。 */
export function contentHash(objects) {
  const h = createHash('sha256')
  for (const o of objects) h.update(JSON.stringify(o))
  return h.digest('hex').slice(0, 16)
}

/** 结构指纹摘要（不依赖对象序，防「同一文档两种遍历顺序」误报）。 */
export function structureFingerprint(objects) {
  const h = createHash('sha256')
  for (const o of [...objects].sort((a, b) => (a.id < b.id ? -1 : 1))) h.update(JSON.stringify(o))
  return h.digest('hex').slice(0, 16)
}

/**
 * 导入文档 → 本象包。转换即语义事务：
 * 初始对象表 = 文档结构（出生证明），内容哈希作为事实对象入库，
 * 此后文档的每次修订以事务追加（见 origin history / why）。
 */
export function importOffice(file, pkgDir, { name = null } = {}) {
  const buf = readFileSync(file)
  const { objects, body, stats } = extract(file, buf)
  const hash = contentHash(objects)
  const fprint = structureFingerprint(objects)

  mkdirSync(join(pkgDir, 'graph'), { recursive: true })
  mkdirSync(join(pkgDir, 'provenance'), { recursive: true })

  const manifest = [
    '# Office 结构化包',
    `artifact:`,
    `  id: ${basename(pkgDir)}`,
    `  kind: office`,
    `  title: ${name ?? basename(file)}`,
    `  source: ${file}`,
    `  structure_hash: ${fprint}`,
    `semantics:`,
    `  paragraph: Document.Paragraph`,
    `  table: Document.Table`,
    `  shape: Presentation.Shape`,
    `provenance:`,
    `  engine: origin-office (adapters/office/cli.mjs)`,
    `  imported_at: ${new Date().toISOString()}`,
  ].join('\n')

  // 事实对象：转换产物的可验证凭据
  const facts = [
    { id: 'fact:structure-hash', _type: 'fact', value: fprint, algo: 'sha256-16', note: '文档结构的指纹。任何修订都会改变它' },
    { id: 'fact:content-hash', _type: 'fact', value: hash, algo: 'sha256-16', note: '按对象序的精确哈希' },
    { id: 'fact:stats', _type: 'fact', stats, note: '结构统计' },
  ]

  initPackage(pkgDir, { manifest, objects: [...objects, ...facts] })
  return { pkgDir, objects: objects.length, facts, stats, hash: fprint, body }
}

/** 验证：重算源文件哈希与包内 fact:structure-hash 比对。 */
export function verifyOffice(pkgDir, file) {
  const buf = readFileSync(file)
  const { objects } = extract(file, buf)
  const now = structureFingerprint(objects)
  const origin = loadOrigin(pkgDir)
  const stored = origin.state['fact:structure-hash']?.value ?? null
  return {
    ok: stored === now,
    stored, now,
    note: stored === now ? '包与源文件一致，结构未被篡改' : '包与源文件不一致——文档被改过，需重新导入',
  }
}

// ── CLI ──
const USAGE = `origin-office —— docx/xlsx/pptx → 本象包（转换即语义事务）
  origin-office import <file> <pkg> [--name 名称]   建包：每处结构一个对象 + 内容哈希
  origin-office inspect <file>                       只看结构，不建包
  origin-office verify <pkg> <file>                  验证包哈希与源文件一致

示例：
  origin-office import 船员培训质量管理规则.docx rule.origin
  origin-office verify rule.origin 船员培训质量管理规则.docx && echo 一致
`

const flags = new Set()
const opts = {}
const args = []
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a === '--name') opts.name = process.argv[++i]
  else if (a.startsWith('-')) flags.add(a)
  else args.push(a)
}
const JSON_MODE = flags.has('--json')
const QUIET = flags.has('-q')
const note = (m) => { if (!QUIET && !JSON_MODE) process.stderr.write(m + '\n') }

function die(code, msg) {
  if (JSON_MODE) process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n')
  else process.stderr.write('错误：' + msg + '\n')
  process.exit(code)
}

function main() {
  const [cmd, ...rest] = args
  if (!cmd || flags.has('-h') || flags.has('--help')) { process.stdout.write(USAGE); process.exit(cmd ? 0 : 2) }

  if (cmd === 'inspect') {
    const file = rest[0]
    if (!file) die(2, '用法：inspect <file>')
    const { body, stats } = extract(file, readFileSync(file))
    if (JSON_MODE) process.stdout.write(JSON.stringify({ stats, body }) + '\n')
    else {
      for (const b of body.slice(0, 30)) {
        if (b.kind === 'paragraph') process.stdout.write(`${b.heading ? '#'.repeat(Math.min(b.heading, 4)) + ' ' : ''}${b.text}\n`)
        else if (b.kind === 'text') process.stdout.write(`[${b.placeholder ?? 'shape'}] ${b.text}\n`)
        else process.stdout.write(`[表 ${b.rows}×${b.cols}]\n`)
      }
      note(`共 ${body.length} 个结构对象：${JSON.stringify(stats)}`)
    }
    return
  }

  if (cmd === 'import') {
    const [file, pkg] = rest
    if (!file || !pkg) die(2, '用法：import <file> <pkg> [--name 名称]')
    const r = importOffice(file, pkg, { name: opts.name })
    if (JSON_MODE) process.stdout.write(JSON.stringify({ ok: true, ...r }) + '\n')
    else {
      note(`✓ 已建包 ${pkg}：${r.objects} 个结构对象（来自 ${file}）`)
      note(`  结构指纹 ${r.hash}　stats ${JSON.stringify(r.stats)}`)
      note('  读：origin status / why / history　写：origin commit')
    }
    return
  }

  if (cmd === 'verify') {
    const [pkg, file] = rest
    if (!pkg || !file) die(2, '用法：verify <pkg> <file>')
    const v = verifyOffice(pkg, file)
    if (JSON_MODE) process.stdout.write(JSON.stringify({ ok: v.ok, ...v }) + '\n')
    else {
      note(`存储 ${v.stored} / 现在 ${v.now}`)
      process.stdout.write((v.ok ? '✓ 一致' : '✗ 不一致') + '　' + v.note + '\n')
      process.exit(v.ok ? 0 : 1)
    }
    return
  }

  die(2, `未知子命令 ${cmd}`)
}

// 直接运行时进 CLI；作为库被 selftest 导入时不执行
const isMain = process.argv[1] && (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('cli.mjs'))
if (isMain) main()
