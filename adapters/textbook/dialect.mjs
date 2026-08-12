// textbook 方言 —— 用本象表示一本「项目任务式」职教教材。
//
// ## 为什么 office 方言不够用
//
// office 方言的对象是 `chapter:2` / `article:50` —— 那是红头文件和法规的骨架。
// 拿它吃一本 35MB 的教材，实测结果是 `{"chapters":0,"articles":0,"refs":[]}`：
// 96 个表认出来了，章、条、引用一个都没有。因为教材根本不长那样：
// 它的骨架是**项目 → 任务 → 栏目**，它的引用是**图1-6 / 表2-3**，不是「第五十条」。
//
// ## 这个方言真正要管的东西
//
// 图号连不连号、图注重不重名，正则扫一遍就有答案——这类**能从正文直接读出来的状态**，
// 本象自己的实验说得很清楚：裸模型和检索都够用，本象不占便宜（README「那堵 75% 的墙」）。
//
// 本象唯一被实验钉死的优势维度是**跨全书累积、且从不在任何一段文字里被陈述的状态**
// （W3：95.8% vs 裸模型 52.1% / 向量 RAG 58.3%，p = 0.0024）。教材工程里这种东西是：
//
//   · 责编说过的每一条意见，有没有落实到那几百处受影响的段落——**书上任何一页都没写**
//   · 49 张重绘图的线型 / 字高 / 图层名是否一致——**书上任何一页都没写**
//   · 同一个零件在全书的编号轨迹（活塞杆 = 图1-43 = 图3-17）——**书上任何一页都没写**
//   · 每张图画到哪一步了、客户认没认——**书上任何一页都没写**
//
// 所以本方言的重心不是 `fig:`，是 `decision:` 和 `spec:`。前者是把责编的话变成对象，
// 后者是把「画风」变成对象。图和任务只是它们的**管辖对象**。
//
// ## 八类对象
//
//   book:      书（来源文件、项目数、任务数、图表数、页数估算、悬空引用）
//   proj:      项目（项目一 → proj:1）
//   task:      任务（项目一任务二 → task:1-2）
//   sect:      栏目（task:1-2 的知识链接 → sect:1-2/知识链接）
//   fig:       插图（图1-6 → fig:1-6）
//   tbl:       表格（表2-3 → tbl:2-3）
//   img:       图片资源（word/media/image12.png，带真实像素尺寸）
//   decision:  责编/客户的一条决定（decision:任务导入改情景导入）← 本方言的重心
//   spec:      施工规范（spec:redraw 的线型/字高/图层名）← 本方言的重心
//
// ## 为什么图号 ID 写成 `fig:1-6` 而不是 `fig:图1-6`
//
// 与 office 的 `article:50`、xlsx 的 `cell:销售!D/5` 同一个套路：分类在前，个体在后。
// 通配 `fig:1-*` 就是「项目一的所有图」，`sect:*/知识链接` 就是「全书所有知识链接栏目」。
// 人读的「图1-6」保留在 `ref` 字段里。
//
// ## 责编意见是怎么变成机器约束的
//
// 这是本方言最值钱的一段。出版社的审稿意见是散文，散文没法验收；
// 编译成下面这张表之后，「改完了没有」就从人眼抽查变成 `diagnose` 的红点计数。
//
//   审稿意见原文                                    → 约束 id
//   ① 层级按我社推荐（栏目名不带【】、按层级缩进）    → sect-not-bracketed
//   ② 图表按项目分两级注写（图1-1、表1-1）           → fig-num-two-level / tbl-num-two-level
//   ② 所有图表均需排号、命名                        → fig-name-required / fig-num-unique / fig-name-unique
//   ② 并在正文中提及                                → every-fig-referenced
//   ③ 量具名称参考国标                              → ⚠ 机器判不了，进 limits
//   ④ 宋体小四 2 倍行距首行空两格                    → body-size-uniform / linespacing-uniform
//   ④ 260 页以内                                    → pages-within-limit
//   ④ 文与图、文与表要一一对应                       → no-dangling-fig-ref / no-dangling-tbl-ref
//   ⑤ 任务描述到任务实施的逻辑更清晰                  → ⚠ 机器判不了，进 limits
//   ⑥ 任务名称更具体                                → ⚠ 机器判不了，进 limits
//   ⑦ 绘图步骤不要放在表格里                        → no-fig-in-table
//   （印刷底线，非意见原文）                          → fig-print-ready
//   （跨会话施工的命根子）                            → decision-all-applied
//
// 判不了的三条**必须留在 limits 里**，不许假装判了。上一版体检报告第七节这么做过一次，
// 本方言把它制度化：`diagnose` 全绿不等于书没问题，只等于「机器能查的那部分没问题」。

import { limit } from '../../compiler/limits.mjs'

export const TEXTBOOK_TYPES = ['book', 'proj', 'task', 'sect', 'fig', 'tbl', 'img', 'decision', 'spec']

/** 出版社「项目任务式」标准栏目。缺哪个由 task.sections_missing 记录。 */
export const STANDARD_SECTIONS = ['任务描述', '知识链接', '任务实施', '任务评价', '任务拓展']

export const textbookManifest = (meta) => `# 本象包（textbook 方言）
artifact:
  id: ${meta.id}
  kind: textbook
  title: ${meta.title}

payload:
  uri: ${meta.uri}
  media_type: application/vnd.openxmlformats-officedocument.wordprocessingml.document

provenance:
  source: ${meta.uri}
  history: ./provenance/history.jsonl
`

/**
 * 约束表。全部用 compiler/constraints.mjs 现有谓词表达
 * （equals / in / range / unique / exists / count），**不新增一个谓词**——
 * 这是本象对方言的硬规矩：新增一个领域不该需要动核心。
 *
 * @param opts.minEdge     印刷可接受的图片最短边像素（300dpi 下 800px ≈ 68mm）
 * @param opts.maxPages    出版社给的页数上限
 * @param opts.strictRefs  是否要求「每张图都必须在正文中被提及」（审稿意见②的严格解释）
 */
export const textbookConstraints = ({ minEdge = 800, maxPages = 260, strictRefs = true } = {}) => {
  const cs = []

  // ── ④ 文与图一一对应：正文提到图1-36，全书却没有这条图注 ──
  // office 方言把它叫 dangling_refs，教材这里分图和表两本账，因为责编是分开提的。
  cs.push({
    id: 'no-dangling-fig-ref',
    rule: '正文引用的每个图号都必须有对应图注（审稿意见④ 文与图一一对应）',
    check: { type: 'equals', object: 'book:*', field: 'dangling_fig_refs', value: [] },
  })
  cs.push({
    id: 'no-dangling-tbl-ref',
    rule: '正文引用的每个表号都必须有对应表注（审稿意见④ 文与表一一对应）',
    check: { type: 'equals', object: 'book:*', field: 'dangling_tbl_refs', value: [] },
  })

  // ── ② 图表均需排号、命名 ──
  cs.push({
    id: 'fig-num-unique',
    rule: '图号不得重复',
    check: { type: 'unique', object: 'fig:*', field: 'num' },
  })
  cs.push({
    id: 'fig-name-unique',
    rule: '图名不得重复（同名图注是读者最难自查的错，上一本书里出现 10 组）',
    check: { type: 'unique', object: 'fig:*', field: 'name' },
  })
  cs.push({
    id: 'fig-name-required',
    rule: '每张图都要有图名，不能只有图号',
    check: { type: 'exists', object: 'fig:*', field: 'name' },
  })
  cs.push({
    id: 'tbl-num-unique',
    rule: '表号不得重复',
    check: { type: 'unique', object: 'tbl:*', field: 'num' },
  })

  // ── ② 两级编号：图1-1 而不是 图2-1-9 ──
  // 用 in 谓词判 level 字段（导入器算好写在对象上），不需要正则谓词。
  cs.push({
    id: 'fig-num-two-level',
    rule: '图号必须是「项目-序号」两级（审稿意见② 图1-1、图2-1……）',
    check: { type: 'in', object: 'fig:*', field: 'num_level', values: [2] },
  })
  cs.push({
    id: 'tbl-num-two-level',
    rule: '表号必须是「项目-序号」两级',
    check: { type: 'in', object: 'tbl:*', field: 'num_level', values: [2] },
  })

  // ── ② 并在正文中提及 ──
  // 这条是严格解释：全书 707 张图里有 551 张没图号也没被提及。
  // 责编原话是「正文中出现的所有图片和表格均需排号、命名，并在正文中提及」。
  // 关掉它（strictRefs=false）是一个**商务决定**，不是技术决定——见 README。
  if (strictRefs) {
    cs.push({
      id: 'every-fig-referenced',
      rule: '每张图都必须在正文中被提及（审稿意见② 并在正文中提及）',
      check: { type: 'equals', object: 'fig:*', field: 'referenced', value: true },
    })
  }

  // ── ⑦ 绘图步骤不要放在表格里 ──
  // **两条都要，缺一条就漏一半**：埋在步骤表里的图恰恰一个图注都没有，
  // 只判 fig 会得到 figs_in_table = 0 的假绿（实测：真实数字是 573 张 img 在表里）。
  cs.push({
    id: 'no-fig-in-table',
    rule: '有图注的插图不得埋在表格里（审稿意见⑦）',
    check: { type: 'equals', object: 'fig:*', field: 'in_table', value: false },
  })
  cs.push({
    id: 'no-img-in-table',
    rule: '图片资源不得埋在表格里（审稿意见⑦ 表中文字比正文小、图片也小，效果不好）',
    check: { type: 'in', object: 'img:*', field: 'table_status', values: ['ok', 'n/a'] },
  })

  // ── ② 所有图片均需排号、命名（针对图片资源，不是图注）──
  // 一张图有没有图注，看的是资源侧：全书 707 张图里 548 张没有任何图号，
  // 这才是责编那句「正文中出现的所有图片均需排号、命名」真正指向的东西。
  if (strictRefs) {
    cs.push({
      id: 'every-img-captioned',
      rule: '每张插图都要有图注（审稿意见② 所有图片均需排号、命名）',
      check: { type: 'in', object: 'img:*', field: 'caption_status', values: ['ok', 'n/a'] },
    })
  }

  // ── ① 栏目名按我社层级，不带【】 ──
  cs.push({
    id: 'sect-not-bracketed',
    rule: '栏目名不带【】，按出版社推荐层级排（审稿意见①）',
    check: { type: 'equals', object: 'sect:*', field: 'bracketed', value: false },
  })
  cs.push({
    id: 'task-sections-complete',
    rule: '每个任务的标准栏目齐全（任务描述/知识链接/任务实施/任务评价/任务拓展）',
    check: { type: 'equals', object: 'task:*', field: 'sections_missing', value: [] },
  })

  // ── ④ 宋体小四 2 倍行距 260 页以内 ──
  // 「变体数必须为 1」比「必须等于小四」更稳：换一家出版社时字号变、变体数为 1 这条不变。
  cs.push({
    id: 'body-size-uniform',
    rule: '正文字号统一（审稿意见④ 宋体小四）',
    check: { type: 'equals', object: 'book:*', field: 'body_size_variants', value: 1 },
  })
  cs.push({
    id: 'linespacing-uniform',
    rule: '正文行距统一（审稿意见④ 2 倍行距）',
    check: { type: 'equals', object: 'book:*', field: 'linespacing_variants', value: 1 },
  })
  cs.push({
    id: 'pages-within-limit',
    rule: `全书不超过 ${maxPages} 页（审稿意见④）`,
    check: { type: 'range', object: 'book:*', field: 'pages_est', max: maxPages },
  })

  // ── 印刷底线（不是责编意见，是物理事实）──
  // 300dpi 下 800px ≈ 68mm。低于这个数，印出来一定糊，跟审美无关。
  // 判的是 print_min_edge 而不是 min_edge：行内符号与矢量图该字段为 null，
  // range 谓词对非数值不判。**这条例外是数据表达的，不是约束里写的 if。**
  cs.push({
    id: 'fig-print-ready',
    rule: `插图最短边不低于 ${minEdge}px，否则 300dpi 印刷必糊（行内符号 φ/±/Ra 与矢量图不判）`,
    check: { type: 'range', object: 'img:*', field: 'print_min_edge', min: minEdge },
  })

  // ── 跨会话施工的命根子 ──
  // 责编的每一条意见都是一个对象，状态必须走到 applied/verified。
  // 这条约束是本方言存在的理由：它管的状态，书上任何一页都没写。
  cs.push({
    id: 'decision-all-applied',
    rule: '责编的每一条决定都必须落实（pending 即未完工）',
    check: { type: 'in', object: 'decision:*', field: 'status', values: ['applied', 'verified'] },
  })

  return cs
}

/**
 * 未钉死的部分——**如实标注，不许假装判了**。
 *
 * 上一版体检报告第七节手写过一次这个清单，效果是客户当场回了「没有的，根据内容和实际
 * 进行补充」——他知道机器的边界在哪，才会去补那一块。方言把它制度化：
 * diagnose 全绿 ≠ 书没问题，只 = 机器能查的那部分没问题。
 */
export const textbookLimits = ({ bindingWindow = 4 } = {}) => [
  limit(
    'fig-img-binding-weak',
    `图注与图片的绑定是弱判据：只检查图注前后 ${bindingWindow} 段内有没有图片。` +
      '一张图被挪到别的图注下面，本方言抓不到。',
  ),
  limit(
    'gb-name-unverified',
    '量具/零件各部分名称是否符合现行国标（审稿意见③），机器判不了：' +
      '需人工在工标网核对标准是否现行、在道客巴巴核对条文。',
  ),
  limit(
    'task-logic-unverified',
    '「任务描述到任务实施的逻辑是否清晰」（审稿意见⑤）与「任务名称是否够具体」（⑥）' +
      '是写作判断，不是结构判断，机器不判。',
  ),
  limit(
    'fig-class-manual',
    '插图的 A 类软件截图 / B 类原理图 / C 类工程图归属由人按图注语义判定，非自动分类。' +
      '这个归属直接决定重绘工作量与报价，不能让机器猜。',
  ),
  limit(
    'pages-estimated',
    '页数是按字数与图幅估算、再乘一个 1.35 的排版损耗系数得到的，不是排版后的真实页码。' +
      '**该系数的标定样本只有 1 本书**（内容估算 200 页 / 目录实测约 285 页），' +
      '不该当成常识；再标几本教材就该修正。真实页数以出版社版式排出后为准。',
  ),
]
