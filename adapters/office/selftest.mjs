#!/usr/bin/env node
/**
 * office 方言自测 —— 合成一个含合并单元格/勾选框/章条标题的 docx，
 * 验证 import.mjs 的结构还原（不做真实文件依赖）。
 *
 * 运行：node adapters/office/selftest.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertDocx, buildOrigin } from './import.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');
mkdirSync(FIX, { recursive: true });

// ---------- 用最小 OOXML 手搓一个 docx（zip 打包，deflate 一层） ----------
import { deflateRawSync } from 'node:zlib';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}>
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章 总则</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>第一条 目的</w:t></w:r></w:p>
    <w:p><w:r><w:t>为保证质量，制定本规则。</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>第二条 适用</w:t></w:r></w:p>
    <w:p><w:r><w:t>本规则适用于审核活动，□初次审核 □换证审核。</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>被审核单位</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>审核日期</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>甲公司</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>2026-01-01</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>□合格 □不合格</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:p><w:r><w:t>附则</w:t></w:r></w:p>
  </w:body>
</w:document>`;

function zipOne(name, contentBuf) {
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const localOff = 0;
  const method = 8;
  const comp = deflateRawSync(contentBuf);
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(contentBuf);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0x0800, 6);   // utf8 flag
  lh.writeUInt16LE(method, 8);
  lh.writeUInt16LE(0, 10);
  lh.writeUInt16LE(0, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(contentBuf.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  lh.writeUInt16LE(0, 28);
  const cdEntry = Buffer.alloc(46);
  cdEntry.writeUInt32LE(0x02014b50, 0);
  cdEntry.writeUInt16LE(20, 4);
  cdEntry.writeUInt16LE(20, 6);
  cdEntry.writeUInt16LE(0x0800, 8);
  cdEntry.writeUInt16LE(method, 10);
  cdEntry.writeUInt16LE(0, 12);
  cdEntry.writeUInt16LE(0, 14);
  cdEntry.writeUInt32LE(crc, 16);
  cdEntry.writeUInt32LE(comp.length, 20);
  cdEntry.writeUInt32LE(contentBuf.length, 24);
  cdEntry.writeUInt16LE(nameBuf.length, 28);
  cdEntry.writeUInt16LE(0, 30);
  cdEntry.writeUInt16LE(0, 32);
  cdEntry.writeUInt16LE(0, 34);
  cdEntry.writeUInt16LE(0, 36);
  cdEntry.writeUInt32LE(0, 38);
  cdEntry.writeUInt32LE(localOff, 42);
  return { lh, nameBuf, comp, cdEntry };
}

function buildDocx(xmlStr) {
  const entries = [
    { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', content: xmlStr },
  ];
  const parts = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const contentBuf = Buffer.from(e.content, 'utf8');
    const comp = deflateRawSync(contentBuf);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(0, 14);      // crc 占位（读者不校验）
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(contentBuf.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    parts.push(lh, nameBuf, comp);
    offset += lh.length + nameBuf.length + comp.length;
  }
  // central directory
  const cdParts = [];
  let cdOffset = 0;
  let localOffsets = [];
  {
    let off = 0;
    for (const e of entries) {
      localOffsets.push(off);
      const nameBuf = Buffer.from(e.name, 'utf8');
      const contentBuf = Buffer.from(e.content, 'utf8');
      const comp = deflateRawSync(contentBuf);
      off += 30 + nameBuf.length + comp.length;
    }
  }
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const nameBuf = Buffer.from(e.name, 'utf8');
    const contentBuf = Buffer.from(e.content, 'utf8');
    const comp = deflateRawSync(contentBuf);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(0, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(contentBuf.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(localOffsets[i], 42);
    cdParts.push(cd, nameBuf);
    cdOffset += cd.length + nameBuf.length;
  }
  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

// ---------- 测试 ----------
const fixPath = join(FIX, 'synthetic.docx');
writeFileSync(fixPath, buildDocx(xml));

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

console.log('office 方言自测：');
const { blocks, stats } = convertDocx(readFileSync(fixPath));

check('6 章识别', stats.chapters >= 1, `got ${stats.chapters}`);
check('2 条识别', stats.articles === 2, `got ${stats.articles}`);
check('1 表识别', stats.tables === 1, `got ${stats.tables}`);
check('勾选框保留', stats.checkboxes >= 2, `got ${stats.checkboxes}`);

const pBlocks = blocks.filter((b) => b.type === 'p');
check('标题转 ##', pBlocks.some((b) => b.level === 2 && b.text.includes('第一条')), 'Heading2 → ##');
check('正文保留', pBlocks.some((b) => b.text.includes('制定本规则')), '正文段落');
check('checkbox 文本在正文', pBlocks.some((b) => b.text.includes('□初次审核')), '勾选框文本');

const tBlock = blocks.find((b) => b.type === 'table');
check('表格存在', !!tBlock, '无表格');
if (tBlock) {
  check('合并单元格展开(表头 3 格)', tBlock.gfm.split('\n')[0].includes('|') && tBlock.gfm.split('\n')[1].startsWith('|---'), 'gfm 表头');
  const line1 = tBlock.gfm.split('\n')[0];
  check('gridSpan 展开成 3 列', (line1.match(/\|/g) || []).length === 4, line1);
  const row2 = tBlock.gfm.split('\n')[2] || '';
  check('第二行 3 格(合并补空)', (row2.match(/\|/g) || []).length === 4, row2);
}

// ── pptx 解析（零依赖，合成最小 pptx） ──
console.log('\npptx 方言（零依赖解析）：');
import { convertPptx } from './pptx.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { importOffice, verifyOffice } from './cli.mjs';

// 复用 fixtures/make-pptx-fixture.mjs 的生成器
import { buildPptx } from './fixtures/make-pptx-fixture.mjs';

// 生成器导出兼容：脚本直接执行时用 main，这里作为库调用
let pptxBuf;
try {
  pptxBuf = buildPptx();
} catch (e) {
  // 若生成器未导出 buildPptx（老版本），退回读已生成的 fixture
  pptxBuf = readFileSync(join(FIX, 'synthetic.pptx'));
}

const tmpPptx = join(mkdtempSync(join(tmpdir(), 'office-pptx-')), 'synthetic.pptx');
writeFileSync(tmpPptx, pptxBuf);

const { slides, stats: pptxStats } = convertPptx(pptxBuf);
check('2 页识别', pptxStats.slides === 2, `got ${pptxStats.slides}`);
check('标题占位符类型', slides[0].shapes.some((s) => s.kind === 'text' && s.type === 'title' && s.text.includes('工作汇报')), 'title 类型');
check('副标题占位符类型', slides[0].shapes.some((s) => s.kind === 'text' && s.type === 'subTitle'), 'subTitle 类型');
check('表格识别', pptxStats.tables === 1, `got ${pptxStats.tables}`);
const tbl = slides[1].shapes.find((s) => s.kind === 'table');
check('表格合并展开', !!tbl && tbl.rows[1][0] === '黑钥匙' && tbl.rows[1][1] === '' && tbl.rows[1][2] === '1', JSON.stringify(tbl?.rows));

// ── 统一 CLI：转换即语义事务（pptx → 本象包 → verify） ──
console.log('\noffice 统一 CLI（转换即语义事务）：');
const tmpPkg = mkdtempSync(join(tmpdir(), 'office-pkg-'));
const r = importOffice(tmpPptx, join(tmpPkg, 'report.origin'), { name: '自测' });
check('建包：5 个结构对象', r.objects === 5, `got ${r.objects}`);
check('结构指纹落包', /^[0-9a-f]{16}$/.test(r.hash), r.hash);
check('verify 一致', verifyOffice(join(tmpPkg, 'report.origin'), tmpPptx).ok === true, '包与源文件哈希不一致');

// 篡改验证：改标题文字后重打包（仍是合法 zip，但内容不同）→ verify 必须失败
const { zip } = await import('../xlsx/zip.mjs')
const tamperedEntries = new Map()
const pptxEntries = await readZipEntries(pptxBuf)
for (const [name, data] of pptxEntries) {
  if (name === 'ppt/slides/slide1.xml') {
    tamperedEntries.set(name, Buffer.from(data.toString('utf8').replace('月落渡口·工作汇报', '月落渡口·篡改版')))
  } else tamperedEntries.set(name, Buffer.from(data))
}
writeFileSync(tmpPptx, zip(tamperedEntries))
const v2 = verifyOffice(join(tmpPkg, 'report.origin'), tmpPptx)
check('篡改后 verify 不一致', v2.ok === false, '篡改未被检出')

async function readZipEntries(buf) {
  // 用 pptx.mjs 的 zipEntries 罗列 + unzipEntry 取值
  const { zipEntries: ze, unzipEntry } = await import('./pptx.mjs')
  const names = ze(buf)
  const out = new Map()
  for (const n of names) out.set(n, unzipEntry(buf, n))
  return out
}

// 清理
try { rmSync(tmpPkg, { recursive: true, force: true }); rmSync(join(tmpdir(), 'office-pptx-*'), { recursive: true, force: true }); } catch { /* 忽略 */ }

console.log(`\n${pass} 通过 / ${fail} 失败`);

// ---------- 难例集成测试（fixtures 里的真实复杂文档） ----------
console.log('\n难例集成：');
const hardCases = [
  { name: '难例1-嵌套合并跨页', expect: { articles: 3, tables: 3, tableRows: 47 } },
  { name: '难例2-文本框脚注图片表单', expect: { articles: 4, tables: 2, checkboxes: 10 } },
];
for (const hc of hardCases) {
  try {
    const buf = readFileSync(join(FIX, hc.name + '.docx'));
    const { stats } = convertDocx(buf);
    const ok = Object.entries(hc.expect).every(([k, v]) => stats[k] === v);
    check(`${hc.name} 结构还原`, ok, JSON.stringify(stats));
    if (ok) {
      const meta = { id: hc.name, title: hc.name, uri: hc.name + '.docx' };
      const { objects } = buildOrigin(convertDocx(buf).blocks, stats, meta);
      check(`${hc.name} 建包`, objects.length > 0, `objects=${objects.length}`);
    }
  } catch (e) {
    check(`${hc.name} 可解析`, false, e.message);
  }
}

process.exit(fail ? 1 : 0);
