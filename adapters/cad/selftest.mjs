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
import { parseDxf, geometryOf, textOf, toPairs, insertOf, insertBBox, blockBBox } from './dxf.mjs'
import { dxfToObjects, sniff } from './import.mjs'
import { loadOrigin } from '../../compiler/origin.mjs'
import { diagnose } from '../../compiler/provenance.mjs'
import { comparePackages } from './diff.mjs'

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

// ── 块引用：真图纸的主体 ────────────────────────────────────────
// 门窗、设备在真图纸里几乎全是块（INSERT），编号存在块属性里而不是散落的文字。
// fixtures/B-201.dxf 按 DXF R12 规范手写（见 make-blocks-fixture.mjs），
// **未经 AutoCAD 往返验证**——只证明解析器对得上规范，不证明对得上真软件输出。
console.log('\n[块引用] BLOCK / INSERT / ATTRIB')

const BDXF = join(HERE, 'fixtures', 'B-201.dxf')
const b = parseDxf(readFileSync(BDXF, 'utf8'))
check(b.blocks.size === 1 && b.blocks.has('C-1500'), '读出 BLOCKS 段里的块定义', [...b.blocks.keys()].join())
check(b.blocks.get('C-1500').entities.length === 1, '  └ 块内 1 个图形（ATTDEF 不算图形）')

const inserts = b.entities.filter((e) => e.type === 'INSERT')
check(inserts.length === 4, 'INSERT 被识别为图元而不是被跳过', `实际 ${inserts.length}`)
check(inserts[0].attrs.NUMBER === 'C1', 'ATTRIB 被归到它所属的 INSERT 上（组码 2=标签、1=值）', JSON.stringify(inserts[0].attrs))
check(inserts.map((e) => e.attrs.NUMBER).join() === 'C1,C2,C3,C1', '  └ 四个实例的属性各归各家，没串位')

const bb = insertBBox(inserts[0], b.blocks)
check(JSON.stringify(bb) === JSON.stringify([800, 7100, 2300, 7300]), '块的包围盒按插入点变换到世界坐标', JSON.stringify(bb))
check(JSON.stringify(blockBBox(b.blocks.get('C-1500'))) === JSON.stringify([0, 0, 1500, 200]), '  └ 块自身坐标系里是 1500×200')
check(insertOf(inserts[3]).at[0] === 9000, '  └ 第四樘的插入点读得出')

const bObjects = dxfToObjects(b, { name: 'B-201' })
check(bObjects.some((o) => o.id === 'block:C-1500' && o.width === 1500), '块定义本身成为对象（换型号时要能查谁用了它）')
const w0 = bObjects.find((o) => o.id.startsWith('ent:门窗/'))
check(w0.attr_NUMBER === 'C1' && w0.block === 'block:C-1500', '属性摊平成 attr_NUMBER，谓词才判得到（嵌套对象判不了）')
check(bObjects.filter((o) => o.id.startsWith('ent:门窗/')).length === 4, '几何完全相同的四樘窗没有互相吞掉（块名与属性进了内容哈希）')

console.log('\n[规则集] 按图纸实际用法选，不硬套')
const BPKG = join(tmpdir(), `cad-blocks-${process.pid}.origin`)
rmSync(BPKG, { recursive: true, force: true })
execFileSync(process.execPath, [join(HERE, 'import.mjs'), BDXF, BPKG, '--name', 'B-201'], { stdio: ['ignore', 'pipe', 'pipe'] })
const bo = loadOrigin(BPKG)
check(bo.state['dwg:B-201'].numbering === 'block', '自动认出这份图纸用块属性编号')

const bd = diagnose(bo)
const bErrors = bd.findings.filter((f) => f.severity === 'error')
check(bErrors.some((f) => f.msg.includes('C1')), '抓出重号 C1（第 1 樘与第 4 樘）')
check(!bErrors.some((f) => f.msg.includes('两处对不上')), '  └ 不套「构件数=标注数」——该图无标注文字，硬套会是假警报')
check(bErrors.length === 1, '恰好 1 条 error', `实际 ${bErrors.length}：${JSON.stringify(bErrors.map((f) => f.msg))}`)
rmSync(BPKG, { recursive: true, force: true })

// ── 认文件：读不了也要说清楚为什么、该怎么办 ──────────────────────
// 真实项目里拿到的多半是 .dwg 或图纸导出的 .pdf。两者都读不了，但**原因不同**，
// 一句笼统的「不支持」会让人去试错误的方向。
// （这里用合成的文件头测判定逻辑——sniff 只看前 6 个字节，不需要真文件。）
console.log('\n[认文件] DWG / PDF 的分流')

const magic = (s) => Buffer.from(s + '\0'.repeat(16), 'latin1').subarray(0, 16)
const dwg2004 = sniff('x.dwg', magic('AC1018'))
check(dwg2004.kind === 'dwg' && !dwg2004.readable, 'DWG 被认出且明说读不了')
check(dwg2004.version.includes('AutoCAD 2004'), '  └ 报出具体版本（魔数是明文，不解压也读得到）')
check(dwg2004.hasHandles === true, '  └ 2004 有实体句柄 → 转 DXF 后 ID 真正稳定')
check(sniff('x.dwg', magic('AC1009')).hasHandles === false, '  └ R12 没有句柄，如实报告')
check(dwg2004.how.includes('另存为'), '  └ 给出可执行的转换办法，不是一句「不支持」')
check(dwg2004.how.includes('泄密'), '  └ 并警告别用在线转换站（施工图是客户资料）')

const pdf = sniff('x.pdf', magic('%PDF-1.4'))
check(pdf.kind === 'pdf' && !pdf.readable, 'PDF 被认出且明说读不了')
check(pdf.why.includes('投影'), '  └ 说清楚 PDF 是投影不是本源——这是协议的核心主张，不是托词')

check(sniff('x.dxf', magic('  0\nSECT')).readable === true, 'DXF 照常放行')

// ── R13 版本对比：句柄驱动的稳定 ID ─────────────────────────────
// R13+（AC1015）每个图元带实体句柄（组码 5）→ ID = ent:<层>/<句柄> 真正稳定。
// 梁移动 / 改长仍是同一对象，对比报「修改」而不是「删+加」——版本对比的前提。
// 夹具 C-101 / C-101-v2：v2 里 B02 移动、B03 加长、B04 删除、两樘窗不变。
console.log('\n[R13 版本对比] 句柄驱动：移动/改属性可识别，不是删+加')

const sniff1015 = sniff('x.dwg', magic('AC1015'))
check(sniff1015.hasHandles === true, 'R13（AC1015）有实体句柄 → 转 DXF 后 ID 真正稳定')
const sniff1012 = sniff('x.dwg', magic('AC1012'))
check(sniff1012.hasHandles === true, 'R13（AC1012）同样有句柄（曾误判为无）')
check(sniff('x.dwg', magic('AC1009')).hasHandles === false, '  └ 仅 R12（AC1009）无句柄')

const C1 = join(HERE, 'fixtures', 'C-101.dxf')
const C2 = join(HERE, 'fixtures', 'C-101-v2.dxf')
const cPkg1 = join(tmpdir(), `cad-r13-v1-${process.pid}.origin`)
const cPkg2 = join(tmpdir(), `cad-r13-v2-${process.pid}.origin`)
rmSync(cPkg1, { recursive: true, force: true })
rmSync(cPkg2, { recursive: true, force: true })
execFileSync(process.execPath, [join(HERE, 'import.mjs'), C1, cPkg1, '--name', 'C-101'], { stdio: ['ignore', 'pipe', 'pipe'] })
execFileSync(process.execPath, [join(HERE, 'import.mjs'), C2, cPkg2, '--name', 'C-101'], { stdio: ['ignore', 'pipe', 'pipe'] })

const o1 = loadOrigin(cPkg1)
const o2 = loadOrigin(cPkg2)
check(o1.objects.some((o) => o.id_basis === 'handle'), 'R13 导入对象标记 id_basis=handle（非退化的 content）')
check(!o1.objects.some((o) => o.id_basis === 'content'), '  └ 没有一个对象退化为内容哈希')

const diff = comparePackages(cPkg1, cPkg2)
const moved = diff.changed.find((c) => c.id.includes('B02'))
const lengthened = diff.changed.find((c) => c.id.includes('B03'))
check(diff.changed.length === 2, '两处修改：B02 移动 + B03 加长', `实际 ${diff.changed.length}: ${diff.changed.map((c) => c.id)}`)
check(!!moved && moved.diffs.some((d) => d.field === 'bbox' && String(d.from).includes('5000') && String(d.to).includes('6000')), '  └ B02 被识别为「移动」（bbox 5000→6000），不是删+加')
check(!!lengthened && lengthened.diffs.some((d) => d.field === 'width' && d.from === 1000 && d.to === 1500), '  └ B03 被识别为「加长」（width 1000→1500）')
check(diff.removed.some((r) => r.id.includes('B04')), 'B04 被识别为「删除」')
check(diff.added.length === 0, '  └ 没有误报「新增」（移动/加长不该被当成新对象）')
check(diff.stable.length === 5, '  └ 5 处不变（外墙、B01、两樘窗）', `实际 ${diff.stable.length}`)
rmSync(cPkg1, { recursive: true, force: true })
rmSync(cPkg2, { recursive: true, force: true })

console.log(`\n${fail ? '✗' : '✓'} ${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
