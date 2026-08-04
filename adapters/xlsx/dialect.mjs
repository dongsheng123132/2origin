// xlsx 方言 —— 用本象表示一张电子表格。
//
// 对象命名把**工作表与列编进 ID**：`cell:销售!D/5`。
// 和 CAD 方言的 `ent:门窗/a1b2c3` 同一个套路——分类在前，个体在后。
// 于是「D 列每一格都必须是公式」可以直接用通配约束 `cell:销售!D/*` 表达，
// 校验器不需要知道什么是电子表格。
//
// **为什么是 `D/5` 而不是 `D5`**：通配是字符串前缀匹配，`cell:销售!D*` 会连
// `cell:销售!DA1`（第 105 列）一起匹上。列和行之间加一道分隔符，列通配才是精确的。
// 人读的 A1 地址仍然保留在 `ref` 字段里。
//
// 四类对象：
//   book:   工作簿本身（来源文件、表数、格数）
//   sheet:  工作表
//   cell:   单元格
//
// ## 这些规则不是编出来演示的
//
// 电子表格的错误率是有实证的：Panko 综述里，真实投产的表格约 1% 的格子含错，
// 大表几乎必错。而下面这几条恰恰是其中最典型、又最适合机器查的：
//
//   ① 公式列里混进硬编码常量 —— 有人为了「对一下数」把某格公式删了填死值，
//      然后忘了改回来。这一格从此不再随上游更新，肉眼完全看不出来。
//   ② 同列公式不一致 —— 拖拽填充时错了一格，或插入行后公式没跟上。
//   ③ 求和漏行 —— SUM(D2:D11) 但数据已经到了 D12。新增的那行永远不进合计。
//   ④ 错误值残留 —— #REF! / #DIV/0! 就摆在表里，照样被复制进报告。
//   ⑤ 文本型数字 —— 从系统导出的「1,234」是字符串，SUM 直接把它当 0。
//
// 五条全部用现有谓词表达（in / not_equals），没有为它们新增任何谓词。

import { limit } from '../../compiler/limits.mjs'

export const XLSX_TYPES = ['book', 'sheet', 'cell']

/**
 * 约束表。每一条都对应一类真实事故，且都是**数据**——
 * 新增一条规则不需要改 compiler/ 里的任何一行。
 *
 * @param profiles 导入器分析出的列画像：[{ sheet, col, kind, shape }]
 *   kind='formula' 的列会得到「必须全是公式」与「公式形状必须一致」两条；
 *   kind='number'  的列会得到「不得混入文本型数字」一条。
 *
 * **按列实际用法选规则集**，与 CAD 方言的 numbering 探测同理：
 * 对一列纯数据硬套「必须全是公式」会得到满屏假警报，比不查更糟。
 */
export const xlsxConstraints = (profiles = []) => [
  {
    // 错误值：整包扫，不分列。#REF! 出现在哪都是错。
    id: 'no-error-values',
    rule: '单元格不得残留错误值（#REF! / #DIV/0! / #VALUE! …）',
    check: { type: 'in', object: 'cell:*', field: 'error', values: [] },
  },
  {
    id: 'no-dangling-ref',
    rule: '公式不得引用不存在的工作表或越界地址',
    check: { type: 'in', object: 'cell:*', field: 'bad_ref', values: [] },
  },
  {
    // 求和漏行。importer 只在**确实探到相邻数据行**时才写 range_gap 字段，
    // 没探到就整个字段缺失，`in` 谓词遇缺失自动跳过——不会因为表里没有 SUM 而报错。
    id: 'aggregate-covers-data',
    rule: '求和/计数范围不得漏掉紧邻的数据行',
    check: { type: 'in', object: 'cell:*', field: 'range_gap', values: [] },
  },

  // ── 以下按列画像生成，一列一条 ──────────────────────────────
  ...profiles.flatMap((p) => {
    const wild = `cell:${p.sheet}!${p.col}/*`
    if (p.kind === 'formula') return [
      {
        id: `formula-column-purity:${p.sheet}!${p.col}`,
        rule: `${p.sheet} 表 ${p.col} 列的公式区里混入了硬编码常量（有人填死了值，此后不再随上游更新）`,
        // 判的是导入器物化好的 hardcoded_in_block，而不是直接判 kind。
        // 直接判 kind 等于要求**整列**都是公式，会把表头和这一列的输入值一起报进去——
        // 51 份真表实测，那样写的假警报占了绝大多数。范围收窄的逻辑在导入器里（数据），
        // 谓词这边仍然只是一句「这个字段不许为真」。
        check: { type: 'not_equals', object: wild, field: 'hardcoded_in_block', value: true },
      },
      ...(p.shapes?.length ? [{
        id: `formula-column-consistency:${p.sheet}!${p.col}`,
        rule: `${p.sheet} 表 ${p.col} 列的公式形状不一致（多数为 ${p.shapes.join(' 或 ')}）`,
        // **警告级，不是错误级。** 形状不同是**嫌疑**不是**缺陷**：
        // 真表里「本列上一格」与「上上一格」混用往往是删行留下的，确实该看一眼，
        // 但也可能本来就该那样写。确定性检查拿不准的事，不该占用 error 这个信号。
        severity: 'warning',
        // 用 in 而不是 equals，两个理由：
        // ① 非公式格没有 formula_shape 字段，equals 会把「字段不存在」判成「值不对」，
        //    对着空行逐个报错。in 遇字段缺失自动跳过——「没写」与「写错」必须分开。
        // ② 合计行的形状与正文天然不同（=SUM(D2:D5) vs =B6-C6），
        //    允许值是一个集合而非单值，小计格才不会被判成缺陷。
        check: { type: 'in', object: wild, field: 'formula_shape', values: p.shapes },
      }] : []),
    ]
    if (p.kind === 'number') return [{
      id: `text-number:${p.sheet}!${p.col}`,
      rule: `${p.sheet} 表 ${p.col} 列是数值列，不得混入文本型数字（"1,234" 会被 SUM 当作 0）`,
      check: { type: 'not_equals', object: wild, field: 'text_number', value: true },
    }]
    return []
  }),
]

/**
 * 第七要素：这份 xlsx 本象包**保证不了什么**。
 *
 * 这些话此前散落在 README、代码注释、selftest 的 DEFECTS 目录和 stderr 警告里——
 * 也就是说，**只有读源码的人知道**。可这个包的主要消费方是 AI，AI 不读 README。
 * 边界不进包，边界就不存在，下游会拿一个已知有损的东西当本体用。
 *
 * @param opts.truncated  超出 --max-cells 被丢掉的格子数（0 则不声明这一条）
 */
export const xlsxLimits = ({ truncated = 0 } = {}) => [
  limit('xlsx-address-not-stable', 'degraded', 'cell:*',
    '单元格地址不是稳定 ID：在上面插一行，原来的 D5 就变成 D6。xlsx 在「同一个东西改了值」与「东西还在原地但地址变了」之间无法区分。',
    '跨版本对比会把「插了一行」看成「往下每一格都改了」。要真正的版本对比，需要源端提供稳定标识（表格格式本身不提供）。'),

  limit('xlsx-no-recalc', 'degraded', 'cell:*.value',
    '本象不重算公式。事务改了输入格之后，依赖它的公式格存的仍是旧的缓存值——Excel 打开会重算，但程序直接读到的是旧值。',
    '投影时顺 depends_on 反向传播标出全部失效格（已实现，见 project.mjs 的 staleCells）；要真值需接一个公式引擎（如 pycel）。'),

  limit('xlsx-styles-not-carried', 'lossy', 'workbook',
    '样式、图表、透视表、合并单元格、条件格式一概不读入包——那些是给人看的装饰，本象里没有对应表示。',
    '投影回 xlsx 时它们不会出现。需要保留排版的场景不要走「导入→投影」这条路，直接改原文件。'),

  limit('xlsx-semantic-errors', 'undetectable', 'diagnose',
    '两类错误确定性检查抓不到：①整列用错了列（本该乘税率却整列乘了折扣率）——形状一致、无错误值、数值合法；②数量级错误（单价 10.00 填成 1000）——值本身完全合法。',
    '交给懂这门生意的人，或换非确定性手段。准确的表述是「把错误压到语义那一类」，不是「不会再错」。'),

  limit('xlsx-text-paste-undetectable', 'undetectable', 'formula-column-purity',
    '把**文本**粘贴到公式格上查不到——本规则只报数字。这是为压假阳性主动付的代价：真表大量使用分段小表（段标题与公式在同一列交替出现），判 text 会把每个段标题都报成缺陷。',
    '51 份真表实测，这一条让假阳性从 310 降到 20。要同时覆盖文本粘贴，需要先能区分「段标题」与「被粘贴的文本」。'),

  limit('xlsx-formula-rules-unverified', 'unverified', 'formula-column-purity / formula-column-consistency / aggregate-covers-data',
    '三条公式类规则**未在真实财务模型上验过假阳性**。已跑过的 51 份真表全是物流/报价/清单类，不含多层引用与情景假设的财务模型。',
    '找手工搭的预算表/估值模型/现金流预测跑一遍。已排除 Enron 语料（是 BIFF/.xls，公式以 RPN token 存储而非文本）。'),

  ...(truncated > 0 ? [limit('xlsx-truncated', 'lossy', 'cell:*',
    `超出 --max-cells，有 ${truncated} 格未入包，体检结果只覆盖入包的那部分。`,
    '调大 --max-cells 重新导入。悄悄少算等于假装全查了，所以这一条只要发生就必然出现在这里。')] : []),
]

export const XLSX_MANIFEST = (id, title, source) => `# 本象包（xlsx 方言）
artifact:
  id: ${id}
  kind: spreadsheet
  title: ${title}

payload:
  uri: ${source}
  media_type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet

provenance:
  source: ${source}
  history: ./provenance/history.jsonl
`
