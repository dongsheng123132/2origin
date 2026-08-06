#!/usr/bin/env node
// 生成两份**带实体句柄（组码 5）**的 R13 DXF 夹具 —— 同一张平面图的两个版本。
//
//   node adapters/cad/fixtures/make-r13-fixture.mjs > C-101.dxf   （第一版）
//   node adapters/cad/fixtures/make-r13-fixture.mjs --v2 > C-101-v2.dxf  （第二版：改图后）
//
// 为什么要造这份：R12 的 DXF 没有句柄（组码 5），图元 ID 只能退化为几何内容哈希，
// 「移动一根梁」会被看成「删一根、加一根」——版本对比的前提崩塌。
// R13（AC1012）起句柄普及：每个图元有稳定 ID，改坐标仍是同一个对象。
// 这份夹具带句柄，专门验证「句柄驱动的版本对比」链路：
//   v1 → v2 的改动包括：
//     ① 一根梁从 (5000,0) 移到 (6000,0)          —— 句柄不变，应报「移动」
//     ② 一根梁改长（1000 → 1500）                —— 句柄不变，应报「属性变化」
//     ③ 新增一樘窗（v2 才有）                     —— 应报「新增」
//     ④ 一根梁被删除                              —— 应报「删除」
//
// 内容布局（毫米制建筑平面）：
//   梁 3 根（B-01/B-02/B-03，矩形 POLYLINE），窗 2 樘（C-01/C-02，块 INSERT）
// 图层：墙体 / 结构 / 门窗

const out = []
const p = (code, value) => out.push(String(code), String(value))

const layer = (name, color) => { p(0, 'LAYER'); p(2, name); p(70, 0); p(62, color); p(6, 'CONTINUOUS') }

// 一根矩形梁：左下角 (x,y)，长 len，宽 w
const beam = (handle, layerName, x, y, len, w) => {
  p(0, 'POLYLINE'); p(5, handle); p(8, layerName); p(66, 1); p(70, 1)
  for (const [cx, cy] of [[x, y], [x + len, y], [x + len, y + w], [x, y + w]]) {
    p(0, 'VERTEX'); p(5, handle + '-v' + cx); p(8, layerName); p(10, cx.toFixed(6)); p(20, cy.toFixed(6)); p(30, '0.000000')
  }
  p(0, 'SEQEND'); p(5, handle + '-s'); p(8, layerName)
}

// 一樘窗（块 INSERT + 属性编号）
const win = (handle, x, y, number) => {
  p(0, 'INSERT'); p(5, handle); p(8, '门窗'); p(66, 1)
  p(2, 'C-1500')
  p(10, x.toFixed(6)); p(20, y.toFixed(6)); p(30, '0.000000')
  p(0, 'ATTRIB'); p(5, handle + '-a'); p(8, '门窗')
  p(10, (x + 600).toFixed(6)); p(20, (y - 400).toFixed(6)); p(30, '0.000000')
  p(40, '250.000000')
  p(1, number)
  p(2, 'NUMBER')
  p(70, 0)
  p(0, 'SEQEND'); p(5, handle + '-seq'); p(8, '门窗')
}

const windowOutline = () => {
  p(0, 'POLYLINE'); p(8, '0'); p(66, 1); p(70, 1)
  for (const [x, y] of [[0, 0], [1500, 0], [1500, 200], [0, 200]]) {
    p(0, 'VERTEX'); p(8, '0'); p(10, x.toFixed(6)); p(20, y.toFixed(6)); p(30, '0.000000')
  }
  p(0, 'SEQEND'); p(8, '0')
}

// ── HEADER ──
p(0, 'SECTION'); p(2, 'HEADER')
p(9, '$ACADVER'); p(1, 'AC1015')   // R13 系：AutoCAD 2000，有句柄
p(9, '$INSBASE'); p(10, '0.000000'); p(20, '0.000000'); p(30, '0.000000')
p(9, '$EXTMIN'); p(10, '0.000000'); p(20, '0.000000'); p(30, '0.000000')
p(9, '$EXTMAX'); p(10, '12000.000000'); p(20, '7300.000000'); p(30, '0.000000')
p(0, 'ENDSEC')

// ── TABLES ──
p(0, 'SECTION'); p(2, 'TABLES')
p(0, 'TABLE'); p(2, 'LAYER'); p(70, 3)
layer('0', 7); layer('墙体', 7); layer('结构', 3); layer('门窗', 5)
p(0, 'ENDTAB')
p(0, 'ENDSEC')

// ── BLOCKS ──
p(0, 'SECTION'); p(2, 'BLOCKS')
p(0, 'BLOCK'); p(5, '1F'); p(8, '0'); p(2, 'C-1500'); p(70, 2)
p(10, '0.000000'); p(20, '0.000000'); p(30, '0.000000')
p(3, 'C-1500')
windowOutline()
p(0, 'ATTDEF'); p(5, '1A'); p(8, '0')
p(10, '600.000000'); p(20, '-400.000000'); p(30, '0.000000')
p(40, '250.000000'); p(1, 'C0'); p(3, '编号'); p(2, 'NUMBER'); p(70, 0)
p(0, 'ENDBLK'); p(8, '0')
p(0, 'ENDSEC')

// ── ENTITIES ──
p(0, 'SECTION'); p(2, 'ENTITIES')
// 外墙轮廓
p(0, 'POLYLINE'); p(5, 'WALL1'); p(8, '墙体'); p(66, 1); p(70, 1)
for (const [x, y] of [[0, 0], [12000, 0], [12000, 7200], [0, 7200]]) {
  p(0, 'VERTEX'); p(5, 'WALL1-' + x); p(8, '墙体'); p(10, x.toFixed(6)); p(20, y.toFixed(6)); p(30, '0.000000')
}
p(0, 'SEQEND'); p(5, 'WALL1-s'); p(8, '墙体')

// 三根梁（v2 里 B-02 移动、B-03 加长）
const v2 = process.argv.includes('--v2')
beam('B01', '结构', 1000, 0, 1000, 300)          // 不变
if (v2) {
  beam('B02', '结构', 6000, 0, 1000, 300)        // ← 移动：v1 在 5000
  beam('B03', '结构', 8000, 0, 1500, 300)        // ← 加长：v1 长 1000
} else {
  beam('B02', '结构', 5000, 0, 1000, 300)
  beam('B03', '结构', 8000, 0, 1000, 300)
  beam('B04', '结构', 10000, 0, 1000, 300)       // ← v2 删除这根
}

// 两樘窗（不变）
win('W01', 800, 7100, 'C-01')
win('W02', 2800, 7100, 'C-02')

p(0, 'ENDSEC')
p(0, 'EOF')

process.stdout.write(out.join('\n') + '\n')
