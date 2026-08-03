#!/usr/bin/env node
// CAD 方言自测 —— 对着一份**真 DXF** 跑，不是对着我以为的 DXF 跑。
//
//   node adapters/cad/selftest.mjs
//
// fixtures/A-101.dxf 是 uking-cad 出的真图纸（AutoCAD / 浩辰 / 中望都能打开），
// spec 一并留着（A-101.spec.json），任何人可以重新生成、自己核对。
// 它故意带三个**真实图纸里最常见的**缺陷：
//   ① 一个圆被落在 0 层　② 编号 C2 重复　③ 画了 4 樘窗但只标了 3 个编号
// 这三条今天靠人拿放大镜核对，错了往往到施工现场才发现。

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { parseDxf, geometryOf, textOf, toPairs } from './dxf.mjs'
import { dxfToObjects } from './import.mjs'
import { loadOrigin } from '../../compiler/origin.mjs'
import { diagnose } from '../../compiler/provenance.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DXF = join(HERE, 'fixtures', 'A-101.dxf')
let pass = 0, fail = 0
const check = (cond, name, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`) }
}

console.log('# CAD 方言自测（对真 DXF）\n')

// ── 解析 ────────────────────────────────────────────────────────
console.log('[解析] DXF 组码格式')
const dxf = parseDxf(readFileSync(DXF, 'utf8'))
check(dxf.version === 'AC1009', '认出 DXF 版本 R12/AC1009', `实际 ${dxf.version}`)
check(dxf.hasHandles === false, '如实报告「本文件无实体句柄」（R12 的现实，不能假装有 ID）')
check(dxf.layers.length === 5 && dxf.layers.some((l) => l.name === '门窗'), '读出图层表', JSON.stringify(dxf.layers.map((l) => l.name)))

const kinds = {}
for (const e of dxf.entities) kinds[e.type] = (kinds[e.type] ?? 0) + 1
check(!('VERTEX' in kinds) && !('SEQEND' in kinds), 'R12 的 POLYLINE+VERTEX+SEQEND 被合并成一个图形（不是三个实体）')
check(kinds.POLYLINE === 5, '  └ 5 条闭合多段线（1 外轮廓 + 4 樘窗）', JSON.stringify(kinds))

const win = dxf.entities.find((e) => e.layer === '门窗')
const g = geometryOf(win)
check(win.closed === true, '闭合标志（组码 70 的最低位）被正确解读')
check(g.area === 1500 * 200, `窗的面积由顶点算出 = ${1500 * 200}`, `实际 ${g.area}`)
check(g.vertices === 4, '  └ 4 个顶点')

const title = dxf.entities.find((e) => e.type === 'TEXT' && e.layer === '图框')
check(textOf(title) === '办公层平面图 A-101', '文字内容读得出（组码 1）', String(textOf(title)))
check(geometryOf(title).height === 300, '  └ 字高读得出（组码 40）')

// 坏文件要报错，不能猜着往下走
let threw = false
try { toPairs('0\nSECTION\nNOTACODE\nx\n') } catch { threw = true }
check(threw, '组码不是整数时当场报错，不猜')

// ── 映射 ────────────────────────────────────────────────────────
console.log('\n[映射] DXF → 本象对象')
const objects = dxfToObjects(dxf, { name: 'A-101' })
const ids = objects.map((o) => o.id)
check(ids.some((id) => id.startsWith('ent:门窗/')), '图层编进 ID（ent:门窗/…），通配约束因此能按语义分组')
check(objects.filter((o) => o.id.startsWith('ent:门窗/')).length === 4, '  └ 门窗层 4 个图元')
check(objects.every((o) => o.type !== 'ent' || o.id_basis === 'content'), '无句柄时如实标记 id_basis=content（退化方案不隐瞒）')
check(objects.some((o) => o.duplicate_of), '内容完全相同的两个图元不会互相吞掉，第二个带 duplicate_of 标记')

// ── 体检 ────────────────────────────────────────────────────────
console.log('\n[体检] 图纸质量规则')
const PKG = join(tmpdir(), `cad-selftest-${process.pid}.origin`)
rmSync(PKG, { recursive: true, force: true })
execFileSync(process.execPath, [join(HERE, 'import.mjs'), DXF, PKG, '--name', 'A-101'], { stdio: ['ignore', 'pipe', 'pipe'] })

const d = diagnose(loadOrigin(PKG))
const codes = d.findings.filter((f) => f.severity === 'error').map((f) => f.msg)
check(codes.some((m) => m.includes('0 层')), '抓出「图元留在 0 层」')
check(codes.some((m) => m.includes('重复')), '抓出「编号 C2 重复」')
check(codes.some((m) => m.includes('两处对不上')), '抓出「4 樘窗只标了 3 个编号」')
check(codes.length === 3, `恰好 3 条 error，不多报`, `实际 ${codes.length}：${JSON.stringify(codes)}`)
check(!d.ok, '体检整体不通过（退出码将为 1，可直接串进出图前的检查）')
rmSync(PKG, { recursive: true, force: true })

console.log(`\n${fail ? '✗' : '✓'} ${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
