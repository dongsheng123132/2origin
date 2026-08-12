#!/usr/bin/env node
/**
 * office 方言 import.mjs —— 原生 docx → AI 友好的 markdown / 结构化 JSON
 *
 * 零依赖：手写 zip central-directory 解析 + zlib.inflateRawSync，
 *         再遍历 word/document.xml（OOXML）还原段落/表格/合并单元格。
 *
 * 用法：
 *   node adapters/office/import.mjs <file.docx> [out.md]    写 markdown
 *   node adapters/office/import.mjs <file.docx> --json      打印结构化 JSON
 *   node adapters/office/import.mjs <file.docx> --stats     打印统计
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

// ---------- zip 解析（最小够用：只找指定 entry，deflate 解压） ----------
function unzipEntry(buf, targetName) {
  // End of Central Directory: 从末尾往前找 PK\x05\x06
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocd = i; break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip（找不到 EOCD）');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdCount = buf.readUInt16LE(eocd + 10);
  let off = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('central directory 损坏');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    if (name === targetName) {
      // 读 local file header 拿数据起点
      const dataStart = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
      const data = buf.subarray(dataStart, dataStart + compSize);
      return method === 0 ? data : inflateRawSync(data);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`zip 里没有 ${targetName}`);
}

// ---------- OOXML 遍历 ----------
const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const q = (tag) => `${NS}:${tag}`;

function children(el, tag) {
  const out = [];
  for (const c of el.childNodes) {
    if (c.nodeType === 1 && c.localName === tag && c.namespaceURI === NS) out.push(c);
  }
  return out;
}

function paraText(p) {
  let s = '';
  const walk = (el) => {
    for (const c of el.childNodes) {
      if (c.nodeType !== 1) continue;
      if (c.localName === 't' && c.namespaceURI === NS) s += c.textContent;
      else if (c.localName === 'tab' && c.namespaceURI === NS) s += '\t';
      else if (c.localName === 'br' && c.namespaceURI === NS) s += '\n';
      else walk(c);
    }
  };
  walk(p);
  return s;
}

function headingLevel(p) {
  const pPr = children(p, 'pPr')[0];
  if (!pPr) return 0;
  const style = children(pPr, 'pStyle')[0];
  if (!style) return 0;
  const v = (style.getAttribute('w:val') || style.getAttribute(`${NS}:val`) || '');
  const m = v.match(/^(heading|标题)?\s*(\d)$/i);
  if (m) return Math.min(parseInt(m[2], 10), 4);
  if (/heading|标题/i.test(v)) return 1;
  return 0;
}

function rowCells(tr) {
  const cells = [];
  for (const tc of children(tr, 'tc')) {
    const tcPr = children(tc, 'tcPr')[0];
    let span = 1, mergeCont = false;
    if (tcPr) {
      const gs = children(tcPr, 'gridSpan')[0];
      if (gs) span = parseInt(gs.getAttribute('w:val') || gs.getAttribute(`${NS}:val`) || '1', 10) || 1;
      const vm = children(tcPr, 'vMerge')[0];
      if (vm) mergeCont = (vm.getAttribute('w:val') || vm.getAttribute(`${NS}:val`)) === 'continue';
    }
    let txt = '';
    for (const p of children(tc, 'p')) txt += paraText(p).replace(/\s+/g, ' ').trim() + ' ';
    txt = txt.trim();
    cells.push(mergeCont ? '' : txt);
    for (let i = 1; i < span; i++) cells.push('');
  }
  return cells;
}

function tableToGfm(tbl) {
  const rows = children(tbl, 'tr').map(rowCells);
  if (!rows.length) return '';
  const ncol = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(ncol - r.length).fill('')];
  const esc = (c) => c.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines = [];
  lines.push('| ' + pad(rows[0]).map(esc).join(' | ') + ' |');
  lines.push('|' + '---|'.repeat(ncol));
  for (const r of rows.slice(1)) lines.push('| ' + pad(r).map(esc).join(' | ') + ' |');
  return lines.join('\n');
}

// ---------- 主流程 ----------

// 完整 DOM 版（Node 无内置 DOM，改用手写迷你 DOM）
function buildMiniDom(xml) {
  const tagRe = /<(\/?)([a-zA-Z0-9_:]+)((?:\s[a-zA-Z0-9_:]+="[^"]*")*)(\/?)>/g;
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  let lastIdx = 0;
  let m2;
  while ((m2 = tagRe.exec(xml)) !== null) {
    const [full, close, tag, attrStr, selfClose] = m2;
    // 文本节点（夹在两个标签之间）
    if (m2.index > lastIdx) {
      const txt = xml.slice(lastIdx, m2.index);
      if (txt && stack.length) stack[stack.length - 1].children.push({ tag: '#text', text: txt });
    }
    lastIdx = tagRe.lastIndex;
    if (close) {
      // 闭合标签：弹出栈（容错：找不到就忽略）
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const attrs = {};
    const attrRe = /([a-zA-Z0-9_:]+)="([^"]*)"/g;
    let am;
    while ((am = attrRe.exec(attrStr)) !== null) attrs[am[1]] = am[2];
    const node = { tag, attrs, children: [] };
    if (stack.length) stack[stack.length - 1].children.push(node);
    if (!selfClose && !['w:br', 'w:tab', 'w:t'].includes(tag)) stack.push(node);
    else if (selfClose) node.selfClose = true;
  }
  return root;
}

function nsName(node) {
  // 迷你 DOM 里 tag 形如 'w:p'，我们只要冒号后的部分
  const i = node.tag.indexOf(':');
  return i >= 0 ? node.tag.slice(i + 1) : node.tag;
}

function findByTag(node, localName, out = []) {
  for (const c of node.children) {
    if (nsName(c) === localName) out.push(c);
    findByTag(c, localName, out);
  }
  return out;
}

function childrenByTag(node, localName) {
  return node.children.filter((c) => nsName(c) === localName);
}

function nodeText(node) {
  let s = '';
  for (const c of node.children) {
    if (c.tag === '#text') s += c.text;
    else s += nodeText(c);
  }
  return s;
}

function miniParaText(p) {
  let s = '';
  for (const c of p.children) {
    if (c.tag === '#text') s += c.text;
    else if (nsName(c) === 't') s += c.text || '';
    else if (nsName(c) === 'tab') s += '\t';
    else if (nsName(c) === 'br') s += '\n';
    else s += miniParaText(c);
  }
  return s;
}

function miniHeadingLevel(p) {
  const pPr = childrenByTag(p, 'pPr')[0];
  if (!pPr) return 0;
  const style = childrenByTag(pPr, 'pStyle')[0];
  if (!style) return 0;
  const v = style.attrs['w:val'] || '';
  const m = v.match(/^(heading|标题)?\s*(\d)$/i);
  if (m) return Math.min(parseInt(m[2], 10), 4);
  if (/heading|标题/i.test(v)) return 1;
  return 0;
}

function miniRowCells(tr) {
  const cells = [];
  for (const tc of childrenByTag(tr, 'tc')) {
    const tcPr = childrenByTag(tc, 'tcPr')[0];
    let span = 1, mergeCont = false;
    if (tcPr) {
      const gs = childrenByTag(tcPr, 'gridSpan')[0];
      if (gs) span = parseInt(gs.attrs['w:val'] || '1', 10) || 1;
      const vm = childrenByTag(tcPr, 'vMerge')[0];
      if (vm) mergeCont = vm.attrs['w:val'] === 'continue';
    }
    let txt = '';
    for (const p of childrenByTag(tc, 'p')) txt += miniParaText(p).replace(/\s+/g, ' ').trim() + ' ';
    txt = txt.trim();
    cells.push(mergeCont ? '' : txt);
    for (let i = 1; i < span; i++) cells.push('');
  }
  return cells;
}

function miniTableToGfm(tbl) {
  const rows = childrenByTag(tbl, 'tr').map(miniRowCells);
  if (!rows.length) return '';
  const ncol = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(ncol - r.length).fill('')];
  const esc = (c) => c.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines = [];
  lines.push('| ' + pad(rows[0]).map(esc).join(' | ') + ' |');
  lines.push('|' + '---|'.repeat(ncol));
  for (const r of rows.slice(1)) lines.push('| ' + pad(r).map(esc).join(' | ') + ' |');
  return lines.join('\n');
}

export { unzipEntry, buildMiniDom, childrenByTag, nsName, miniParaText, miniTableToGfm, miniRowCells };

// 汉字数字 → 阿拉伯数字（条文号、章号）
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
export function cnToNum(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (CN_NUM[s]) return CN_NUM[s];          // 一~十 单字
  if (s === '十') return 10;
  if (s.length === 2 && s.startsWith('十')) return 10 + (CN_NUM[s[1]] || 0);
  if (s.length === 2 && s.endsWith('十')) return (CN_NUM[s[0]] || 0) * 10;
  if (s.length === 3) return (CN_NUM[s[0]] || 0) * 10 + (CN_NUM[s[2]] || 0);
  return 0;
}

export function convertDocx(buf) {
  const xmlBuf = unzipEntry(buf, 'word/document.xml');
  const dom = buildMiniDom(xmlBuf.toString('utf8'));
  const docEl = childrenByTag(dom, 'document')[0] || dom;
  const body = childrenByTag(docEl, 'body')[0];
  const blocks = [];   // {type:'p', text, level} | {type:'table', gfm, rows, cols, cells}
  const stats = { chapters: 0, articles: 0, tables: 0, tableRows: 0, checkboxes: 0, refs: [] };
  let tableSeq = 0;
  for (const child of body.children) {
    const tag = nsName(child);
    if (tag === 'p') {
      const text = miniParaText(child).replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const lvl = miniHeadingLevel(child);
      blocks.push({ type: 'p', text, level: lvl });
      if (/^第[一二三四五六七八九十百]+章\s/.test(text)) stats.chapters++;
      if (/^第[一二三四五六七八九十百]+条\s/.test(text)) stats.articles++;
      if (/□|☑/.test(text)) stats.checkboxes += (text.match(/□|☑/g) || []).length;
      // 引用收集：第X条 / QXXX 表（条款标题自身的「第X条」不算引用）
      const titleArt = text.match(/^第([一二三四五六七八九十百\d]+)条\s/);
      const selfNum = titleArt ? cnToNum(titleArt[1]) : 0;
      for (const m of text.matchAll(/第([一二三四五六七八九十百\d]+)条/g)) {
        const n = cnToNum(m[1]);
        if (n && n !== selfNum) stats.refs.push({ kind: 'article', num: n, context: text.slice(0, 30) });
      }
      for (const m of text.matchAll(/Q(\d{2,3})\s*表/g)) {
        stats.refs.push({ kind: 'table', num: m[1], context: text.slice(0, 30) });
      }
    } else if (tag === 'tbl') {
      const rows = childrenByTag(child, 'tr');
      const cells = rows.map(miniRowCells);
      if (cells.length) {
        tableSeq++;
        const ncol = Math.max(...cells.map((r) => r.length));
        const uneven = cells.some((r) => r.length !== ncol);
        stats.tables++;
        stats.tableRows += cells.length;
        for (const r of cells) {
          for (const c of r) {
            if (/□|☑/.test(c)) stats.checkboxes += (c.match(/□|☑/g) || []).length;
          }
        }
        blocks.push({ type: 'table', gfm: miniTableToGfm(child), rows: cells.length, cols: ncol, cells, uneven, seq: tableSeq });
      }
    }
  }
  return { blocks, stats };
}

// 从表格周边上下文推断表号（Q112 表 / 附表1）：向上找最近的表题行
function inferTableTitle(blocks, idx) {
  for (let i = idx - 1; i >= Math.max(0, idx - 6); i--) {
    const b = blocks[i];
    if (b.type === 'table') break;
    if (b.type === 'p') {
      const m = b.text.match(/^Q(\d{2,3})\s*表/);
      if (m) return m[1];
      const m2 = b.text.match(/^附表\s*([一二三四五六七八九十\d]+)/);
      if (m2) return `F${cnToNum(m2[1])}`;
    }
  }
  return null;
}

export function buildOrigin(blocks, stats, meta) {
  const objects = [];
  const relations = [];
  const id = meta.id;
  const dangling = { article: [], table: [] };
  objects.push({ id: `doc:${id}`, type: 'doc', title: meta.title, source: meta.uri, chapters: stats.chapters, articles: stats.articles, tables: stats.tables, table_rows: stats.tableRows, checkboxes: stats.checkboxes, dangling_refs: [] });

  const articleMap = new Map();   // 条号 -> id
  let curChapter = 0;
  let tableNum = 0;
  const tableIds = new Map();     // 表号 -> id（用于引用关系）

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'p') {
      const t = b.text;
      const cm = t.match(/^第([一二三四五六七八九十百\d]+)章\s/);
      if (cm) {
        curChapter = cnToNum(cm[1]);
        objects.push({ id: `chapter:${curChapter}`, type: 'chapter', num: curChapter, title: t, doc: `doc:${id}` });
        relations.push({ subject: `chapter:${curChapter}`, predicate: 'part_of', object: `doc:${id}` });
        continue;
      }
      const am = t.match(/^第([一二三四五六七八九十百\d]+)条\s/);
      if (am) {
        const n = cnToNum(am[1]);
        const articleId = `article:${n}`;
        articleMap.set(n, articleId);
        objects.push({ id: articleId, type: 'article', num: n, chapter: curChapter, text: t, doc: `doc:${id}` });
        relations.push({ subject: articleId, predicate: 'part_of', object: curChapter ? `chapter:${curChapter}` : `doc:${id}` });
        continue;
      }
      // 表号行（Q112 表 / 附表）
      const tm = t.match(/^(Q\d{2,3})\s*表/);
      if (tm) {
        tableNum = tm[1];
      }
    } else if (b.type === 'table') {
      tableNum = inferTableTitle(blocks, i) || `T${b.seq}`;
      const tableId = /^\d+$/.test(tableNum) ? `table:Q${tableNum}` : `table:${tableNum}`;
      tableIds.set(tableNum, tableId);
      objects.push({ id: tableId, type: 'table', num: tableNum, rows: b.rows, cols: b.cols, uneven_columns: b.uneven, doc: `doc:${id}` });
      relations.push({ subject: tableId, predicate: 'part_of', object: `doc:${id}` });
      // 单元格
      b.cells.forEach((row, ri) => {
        row.forEach((cellText, ci) => {
          if (!cellText) return;   // 合并展开的空占位不建对象
          const cellId = /^\d+$/.test(tableNum) ? `cell:Q${tableNum}!${ri + 1}/${ci + 1}` : `cell:${tableNum}!${ri + 1}/${ci + 1}`;
          objects.push({ id: cellId, type: 'cell', table: tableId, row: ri + 1, col: ci + 1, text: cellText });
          relations.push({ subject: cellId, predicate: 'part_of', object: tableId });
          const cb = cellText.match(/□|☑/g);
          if (cb) {
            objects.push({ id: `${cellId}.cb`, type: 'checkbox', in_cell: cellId, count: cb.length });
            relations.push({ subject: `${cellId}.cb`, predicate: 'part_of', object: cellId });
          }
        });
      });
    }
  }

  // 引用关系：正文提到的第X条/QXXX表 → 对象；悬空的记进 doc.dangling_refs
  const seen = new Set();
  for (const ref of stats.refs) {
    if (ref.kind === 'article') {
      const target = articleMap.get(ref.num);
      if (target) relations.push({ subject: `doc:${id}`, predicate: 'references', object: target });
      else if (!seen.has(`a${ref.num}`)) { seen.add(`a${ref.num}`); dangling.article.push(ref.num); }
    } else if (ref.kind === 'table') {
      const target = tableIds.get(ref.num);
      if (target) relations.push({ subject: `doc:${id}`, predicate: 'references', object: target });
      else if (!seen.has(`t${ref.num}`)) { seen.add(`t${ref.num}`); dangling.table.push(ref.num); }
    }
  }
  if (dangling.article.length || dangling.table.length) {
    const d = objects[0];
    d.dangling_refs = [
      ...dangling.article.map((n) => `article:${n}`),
      ...dangling.table.map((n) => `table:Q${n}`),
    ];
  }
  return { objects, relations };
}

function toMarkdown(blocks) {
  const lines = [];
  for (const b of blocks) {
    if (b.type === 'p') {
      const t = b.text;
      const m = t.match(/^第[一二三四五六七八九十百]+章\s/) || t.match(/^(附\s*则|总\s*则)$/);
      const a = t.match(/^第[一二三四五六七八九十百]+条\s/);
      if (a) lines.push('### ' + t, '');
      else if (m) lines.push('## ' + t, '');
      else if (b.level > 0) lines.push('#'.repeat(b.level) + ' ' + t, '');
      else lines.push(t, '');
    } else {
      lines.push(b.gfm, '');
    }
  }
  return lines.join('\n');
}

// ---------- CLI ----------
import { basename } from 'node:path';
async function main() {
  const args = process.argv.slice(2);
  const file = args[0];
  if (!file) {
    console.error('用法: node adapters/office/import.mjs <file.docx> [out.md|--json|--stats|--origin <pkg>]');
    process.exit(2);
  }
  const buf = readFileSync(file);
  const { blocks, stats } = convertDocx(buf);
  const arg2 = args[1];
  if (arg2 === '--origin') {
    const pkgDir = args[2] || file.replace(/\.docx$/i, '.origin');
    const { initPackage } = await import('../../compiler/store.mjs');
    const { officeManifest, officeConstraints, officeLimits } = await import('./dialect.mjs');
    const base = basename(file).replace(/\.docx$/i, '');
    const { objects, relations } = buildOrigin(blocks, stats, { id: base, title: base, uri: file });
    initPackage(pkgDir, {
      manifest: officeManifest({ id: base, title: base, uri: file }),
      objects,
      relations,
      constraints: officeConstraints(stats),
      limits: officeLimits(),
    });
    console.error(`已建本象包 ${pkgDir}（${objects.length} 对象 / ${relations.length} 关系 / ${stats.tables} 表）`);
  } else if (arg2 === '--json') {
    const structured = blocks.map((b) =>
      b.type === 'p' ? { kind: 'paragraph', text: b.text, heading: b.level } : { kind: 'table', gfm: b.gfm, rows: b.rows, cols: b.cols }
    );
    console.log(JSON.stringify({ stats, blocks: structured }, null, 2));
  } else if (arg2 === '--stats') {
    console.log(JSON.stringify(stats, null, 2));
  } else if (arg2) {
    writeFileSync(arg2, toMarkdown(blocks), 'utf8');
    console.error(`已写入 ${arg2}（${stats.chapters} 章 / ${stats.articles} 条 / ${stats.tables} 表 / ${stats.tableRows} 表行）`);
  } else {
    process.stdout.write(toMarkdown(blocks));
  }
}

// 动态导入已内联在 main()（顶层 await 不可用于函数内，用 async 处理）

// 守卫必须同时认「文件名叫 import.mjs」和「在 office 目录下」：cad 与 textbook 方言的
// 入口也叫 import.mjs，只判文件名会让它们一 import 本模块就把 main() 跑起来
// （实测：textbook 方言 import 本模块时，直接打印出整本教材的 markdown）。
if (
  process.argv[1] &&
  (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    (process.argv[1].endsWith('import.mjs') && process.argv[1].replace(/\\/g, '/').includes('/office/')))
) {
  main();
}
