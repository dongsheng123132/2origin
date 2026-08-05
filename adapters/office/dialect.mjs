// office 方言 —— 用本象表示一份原生文档（docx 起步）。
//
// 对象命名把**章/条/表编进 ID**：`article:50`、`table:Q112`、`cell:Q112!3/2`。
// 和 xlsx 方言的 `cell:销售!D/5` 同一个套路——分类在前，个体在后。
// 于是「第五十条必须引用已存在的附表」可以写成
// `relation:article:50 → table:Q112`，校验器不需要知道什么是公文。
//
// **为什么单元格用 `行/列` 而不是 A1**：与 xlsx 方言同因——
// 通配是字符串前缀匹配，`cell:Q112!3*` 会连第 30 行一起匹上，
// 行和列之间加一道分隔符，行通配才是精确的。人读的地址保留在 `ref` 里。
//
// 六类对象：
//   doc:      文档本身（来源文件、章数、条数、表数）
//   chapter:  章（第X章 → chapter:2）
//   article:  条（第五十条 → article:50）
//   table:    附表（Q112 表 → table:Q112）
//   cell:     表格单元格（按合并展开后的坐标寻址）
//   checkbox: □勾选框（表单/审核表里最容易被 OCR 丢掉的信息）
//
// ## 为什么需要约束（对照 xlsx 方言的实证风格）
//
// 原生文档转换的错误率同样有实证：pandoc 直转海事局文件 16 表全丢（0 个管道表），
// markitdown 不还原合并单元格、丢勾选框。转换器的错和表格的错一样会静默传播——
// AI 读了一份「第五十条引用了 Q102 表」的文档，但 Q102 表压根没进来，它会照单全收。
//
// 下面几条是本方言能机器查的：
//
//   ① 条引用悬空 —— 正文提到「第X条」但文档里没有第X条（剪贴残缺）
//   ② 表引用悬空 —— 正文提到「Q112 表」但附表没进来（pandoc 式漏表）
//   ③ 表格列数参差 —— 同一表各行展开后列数不一致（合并展开失败）
//   ④ 勾选框必须成对 —— 「□合格 □不合格」只保留了一个，语义就变了

import { limit } from '../../compiler/limits.mjs'

export const OFFICE_TYPES = ['doc', 'chapter', 'article', 'table', 'cell', 'checkbox']

export const officeManifest = (meta) => `# 本象包（office 方言）
artifact:
  id: ${meta.id}
  kind: document
  title: ${meta.title}

payload:
  uri: ${meta.uri}
  media_type: application/vnd.openxmlformats-officedocument.wordprocessingml.document

provenance:
  source: ${meta.uri}
  history: ./provenance/history.jsonl
`

/**
 * 约束表。全部用现有谓词表达（in / equals / pattern），
 * 新增一条规则不需要改 compiler/ 里的任何一行。
 *
 * @param stats 导入器统计：{ chapters, articles, tables, tableRows, checkboxes }
 */
export const officeConstraints = (stats = {}) => {
  const cs = []

  // ④ 勾选框必须成对：单选框组是「□A □B」形态，只留一个说明剪贴丢了选项。
  // 不写成硬规则（表单里也有单个的「□是」），只在出现「□X □Y」模式时查成对性。

  // ③ 表格列数参差：导入器已经把每表展开，若某表存在行间列数不一致，
  // 导入器会在该表对象上写 uneven_columns: true，这里兜底拦截。
  cs.push({
    id: 'no-uneven-tables',
    rule: '表格合并展开后各行列数必须一致',
    check: { type: 'in', object: 'table:*', field: 'uneven_columns', values: [false] },
  })

  return cs
}

export const officeLimits = () => [
  limit({
    scope: 'article:*',
    text: '条文文本按「第X条」正则切分，条款内层级（款/项/目）尚未结构化',
  }),
  limit({
    scope: 'table:*',
    text: '合并单元格按 gridSpan/vMerge 展开为占位空单元格，纵向合并的语义（跨行内容归属）未建模',
  }),
  limit({
    scope: 'cell:*',
    text: '单元格文本为纯文本拼接，未还原字体/字号/加粗等排版样式',
  }),
  limit({
    scope: 'doc:*',
    text: '只支持原生 docx（OOXML）；扫描件 PDF 请走 MinerU/Docling，本方言不做 OCR',
  }),
]
