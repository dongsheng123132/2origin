#!/usr/bin/env node
// 生成一份**带块引用与块属性**的 R12 DXF 夹具。
//
//   node adapters/cad/fixtures/make-blocks-fixture.mjs > B-201.dxf
//
// 为什么要专门造这份：真图纸里门窗、设备几乎全是块引用（INSERT），编号存在块属性里，
// 而 uking-cad 只出基本图元，出不了块。A-101.dxf 那份是外部工具产出的独立样本，
// 这份是按 DXF R12 规范手写的——**它没有经过 AutoCAD 往返验证**，
// 只能证明解析器对得上规范，不能证明对得上真软件的输出。真图纸到手要重新验一次。
//
// 图上有 4 樘窗（同一个块 C-1500），编号 C1 / C2 / C3 / C1——**最后一个是重号**，
// 这是真实图纸里最常见也最贵的错误之一：施工按哪个下料都可能错。

const out = []
const p = (code, value) => out.push(String(code), String(value))

const layer = (name, color) => { p(0, 'LAYER'); p(2, name); p(70, 0); p(62, color); p(6, 'CONTINUOUS') }

// 一樘窗的轮廓：1500 × 200，画在块自己的坐标系里（基点在左下角）
const windowOutline = () => {
  p(0, 'POLYLINE'); p(8, '0'); p(66, 1); p(70, 1)
  for (const [x, y] of [[0, 0], [1500, 0], [1500, 200], [0, 200]]) {
    p(0, 'VERTEX'); p(8, '0'); p(10, x.toFixed(6)); p(20, y.toFixed(6)); p(30, '0.000000')
  }
  p(0, 'SEQEND'); p(8, '0')
}

const insertWindow = (x, y, number) => {
  p(0, 'INSERT'); p(8, '门窗'); p(66, 1)      // 66=1：后面跟属性
  p(2, 'C-1500')
  p(10, x.toFixed(6)); p(20, y.toFixed(6)); p(30, '0.000000')
  p(0, 'ATTRIB'); p(8, '门窗')
  p(10, (x + 600).toFixed(6)); p(20, (y - 400).toFixed(6)); p(30, '0.000000')
  p(40, '250.000000')
  p(1, number)        // 属性值
  p(2, 'NUMBER')      // 属性标签
  p(70, 0)
  p(0, 'SEQEND'); p(8, '门窗')
}

// ── HEADER ──
p(0, 'SECTION'); p(2, 'HEADER')
p(9, '$ACADVER'); p(1, 'AC1009')
p(9, '$INSBASE'); p(10, '0.000000'); p(20, '0.000000'); p(30, '0.000000')
p(9, '$EXTMIN'); p(10, '0.000000'); p(20, '0.000000'); p(30, '0.000000')
p(9, '$EXTMAX'); p(10, '12000.000000'); p(20, '7300.000000'); p(30, '0.000000')
p(0, 'ENDSEC')

// ── TABLES ──
p(0, 'SECTION'); p(2, 'TABLES')
p(0, 'TABLE'); p(2, 'LAYER'); p(70, 3)
layer('0', 7); layer('墙体', 7); layer('门窗', 5)
p(0, 'ENDTAB')
p(0, 'ENDSEC')

// ── BLOCKS ──
p(0, 'SECTION'); p(2, 'BLOCKS')
p(0, 'BLOCK'); p(8, '0'); p(2, 'C-1500'); p(70, 2)   // 70=2：块内含属性定义
p(10, '0.000000'); p(20, '0.000000'); p(30, '0.000000')
p(3, 'C-1500')
windowOutline()
p(0, 'ATTDEF'); p(8, '0')
p(10, '600.000000'); p(20, '-400.000000'); p(30, '0.000000')
p(40, '250.000000'); p(1, 'C0'); p(3, '编号'); p(2, 'NUMBER'); p(70, 0)
p(0, 'ENDBLK'); p(8, '0')
p(0, 'ENDSEC')

// ── ENTITIES ──
p(0, 'SECTION'); p(2, 'ENTITIES')
p(0, 'POLYLINE'); p(8, '墙体'); p(66, 1); p(70, 1)
for (const [x, y] of [[0, 0], [12000, 0], [12000, 7200], [0, 7200]]) {
  p(0, 'VERTEX'); p(8, '墙体'); p(10, x.toFixed(6)); p(20, y.toFixed(6)); p(30, '0.000000')
}
p(0, 'SEQEND'); p(8, '墙体')

insertWindow(800, 7100, 'C1')
insertWindow(2800, 7100, 'C2')
insertWindow(6000, 7100, 'C3')
insertWindow(9000, 7100, 'C1')   // ← 重号，体检应当抓住

p(0, 'ENDSEC')
p(0, 'EOF')

process.stdout.write(out.join('\n') + '\n')
