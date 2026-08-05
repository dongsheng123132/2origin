# office 方言 —— 原生文档的本象

> 一份红头文件交给 AI，它看到的是被 OCR 或文本框切割后的碎片。
> 可这份 docx 里明明写着「第一章、第五十条、Q112 表、合并单元格」——
> 原生电子文档的结构是**无损**的，行业却把它当成扫描件来猜。
> 这份方言把 docx 导入本象包，让章、条、表都变成可锚定、可验证的对象。

```bash
node adapters/office/import.mjs 文件.docx /tmp/规则.md
node adapters/office/import.mjs 文件.docx --json   # 结构化输出（章/条/表 分节）
node adapters/office/import.mjs 文件.docx --origin /tmp/规则.origin   # 进本象包（见下方「用」）
```

## 用

```bash
# 转 markdown（AI 可读，章→##、条→###、表→GFM 管道表）
node adapters/office/import.mjs 文件.docx 输出.md

# 建本象包（doc/chapter/article/table/cell/checkbox 对象 + part_of/references 关系）
node adapters/office/import.mjs 文件.docx --origin /tmp/规则.origin
node compiler/cli.mjs diagnose /tmp/规则.origin     # 转换可验证：约束 1/1 可机器判定
node compiler/cli.mjs why /tmp/规则.origin doc:xx.dangling_refs   # 悬空引用（正文提到但包里没有）

# 结构化输出
node adapters/office/import.mjs 文件.docx --json | --stats
```

## 统一 CLI（docx / xlsx / pptx 一条龙）

`cli.mjs` 是更高一层的入口，把三种格式都收进「转换即语义事务」：

```bash
node adapters/office/cli.mjs import 文件.docx /tmp/规则.origin --name 规则
node adapters/office/cli.mjs inspect 文件.docx        # 只看结构，不建包
node adapters/office/cli.mjs verify /tmp/规则.origin 文件.docx   # 验证包哈希与源文件一致
```

## 先例边界（2026-08-05 实查，star 为当日值）
- 转换这事别人做过：mammoth.js（6274★，docx→HTML/md，表格边框忽略、文本框拆段）、pandoc（45716★，但实测 16 表全丢进引用块）、markitdown（171671★，微软，表格合并/勾选框不还原）。
- 别人没做的是：**表格结构保真**（gridSpan/vMerge 展开、□勾选框、表号-说明行保留）+ **章条结构化**（第X条 → 可锚定标题）+ **转换结果可验证**（W3 那套：转换是事务，不是一次性输出）。
- 本方言不做：版面分析、OCR、公式 LaTeX —— 那是 MinerU（76864★）/ Docling（64284★）的地盘，PDF 扫描件请用它们。本方言只吃**原生电子文档**（docx 起步，xlsx 已独立成方言）。

## 对象模型（规划）

```text
doc:<名>              文档
chapter:<n>           章（第X章 → chapter:2）
article:<n>           条（第五十条 → article:50）
table:<表号>          附表（Q112 表 → table:Q112）
cell:<表号>!<行>/<列> 单元格（合并单元格展开后按展开坐标寻址）
```

和 xlsx 方言同一个套路：分类编进 ID。于是「第五十条引用了 Q102 表」可以写成
`relation:article:50→table:Q102`，校验器不需要知道什么是公文。

## 当前实现

- `import.mjs`：零依赖 docx→markdown（zip 解析 + XML 遍历，表格合并展开、勾选框保留、章条转标题），输出 GFM 管道表。
- `pptx.mjs`：零依赖 pptx 解析（占位符类型 title/subTitle/body、表格 + gridSpan 合并展开），输出结构化对象。
- `cli.mjs`：统一 CLI `origin-office` —— docx/pptx → 本象包（转换即语义事务）：
  - `import <file> <pkg>`：每处结构一个对象（par:*/tbl:*/sld*:shape/table），SHA-256 结构指纹作为事实对象入库
  - `inspect <file>`：只看结构不建包
  - `verify <pkg> <file>`：重算源文件哈希与包内指纹比对——「转换可验证」的落实（篡改即检出）
- `fixtures/make-pptx-fixture.mjs`：最小合法 pptx 生成器（合成夹具，零依赖）。
- 自测：`node adapters/office/selftest.mjs`（docx 合成 fixture + pptx 合成 fixture + 统一 CLI 建包/验证/篡改检出，20 项）。
- 真实案例：`fixtures/` 下的船员培训质量管理规则（海事局 2019 年公开文件），
  15 表 213 行全部还原，62KB 输出；`origin-office import` 产出 409 个结构对象（6 章/77 条/16 表/59 勾选）。
