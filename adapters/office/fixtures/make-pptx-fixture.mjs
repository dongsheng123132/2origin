#!/usr/bin/env node
// 生成最小合法 pptx 夹具（零依赖，供 pptx.mjs 自测与 office CLI 演示）。
//
//   node adapters/office/fixtures/make-pptx-fixture.mjs [输出路径]
//
// 产物：两页演示文稿——
//   第 1 页：标题（ph type=title）+ 副标题 + 正文两条
//   第 2 页：标题 + 一张 2×3 表格（含 gridSpan 合并单元格）
// 同时写 fixtures/synthetic.pptx（缺省路径）。

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zip } from '../../xlsx/zip.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}

// ── 一个文本形状的 XML ──
function textShape(id, name, phType, runs) {
  const body = runs.map(([txt, lvl]) => `
      <a:p>
        <a:pPr lvl="${lvl}"/>
        <a:r><a:t>${txt}</a:t></a:r>
      </a:p>`).join('\n')
  const ph = phType ? `<a:ph type="${phType}"/>` : ''
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr>
    <p:spPr/>
    <p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody>
  </p:sp>`
}

// ── 一个表格形状的 XML（2×3，第二行第一格 gridSpan=2）──
function tableShape(id) {
  return `<p:graphicFrame>
    <p:nvGraphicFramePr><p:cNvPr id="${id}" name="表 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
    <p:xfrm><a:off x="100" y="100"/><a:ext cx="4000" cy="2000"/></p:xfrm>
    <a:graphic><a:graphicData uri="${NS.a}">
      <a:tbl>
        <a:tblPr firstRow="1" bandRow="1"/>
        <a:tblGrid><a:gridCol w="1300"/><a:gridCol w="1300"/><a:gridCol w="1300"/></a:tblGrid>
        <a:tr h="600">
          <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>项目</a:t></a:r></a:p></a:txBody></a:tc>
          <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>数量</a:t></a:r></a:p></a:txBody></a:tc>
          <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>备注</a:t></a:r></a:p></a:txBody></a:tc>
        </a:tr>
        <a:tr h="600">
          <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>黑钥匙</a:t></a:r></a:p></a:txBody>
            <a:tcPr><a:gridSpan val="2"/></a:tcPr></a:tc>
          <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>1</a:t></a:r></a:p></a:txBody></a:tc>
        </a:tr>
      </a:tbl>
    </a:graphicData></a:graphic>
  </p:graphicFrame>`
}

// ── 幻灯片 XML ──
function slideXml(n, shapes) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr/>
    ${shapes.join('\n    ')}
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`
}

// ── 最小合法 pptx 包 ──
export function buildPptx() {
  const slide1 = slideXml(1, [
    textShape(2, '标题 1', 'title', [['月落渡口·工作汇报', 0]]),
    textShape(3, '副标题 2', 'subTitle', [['第三季度续写工程', 0]]),
    textShape(4, '正文占位符 3', 'body', [['黑钥匙已到林峥手中', 0], ['白遥仍未暴露', 1]]),
  ])
  const slide2 = slideXml(2, [
    textShape(2, '标题 1', 'title', [['关键物品清单', 0]]),
    tableShape(3),
  ])
  return zip(new Map([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`],
    ['ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
    <p:sldId id="257" r:id="rId2"/>
  </p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000"/>
</p:presentation>`],
    ['ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`],
    ['ppt/slides/slide1.xml', slide1],
    ['ppt/slides/slide2.xml', slide2],
  ]))
}

// 直接运行时写 fixture；作为库被 selftest 导入时不执行
const isMain = process.argv[1] && (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('make-pptx-fixture.mjs'))
if (isMain) {
  const out = process.argv[2] ?? join(HERE, 'synthetic.pptx')
  writeFileSync(out, buildPptx())
  console.error(`已写入 ${out}（最小合法 pptx，2 页）`)
}
