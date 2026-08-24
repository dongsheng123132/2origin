#!/usr/bin/env node
/**
 * textbook 方言自检。
 *
 * 不吃 docx —— 直接喂 items 序列打 buildStructure，因为**方言的判别力全在结构识别上**，
 * zip 与 OOXML 解析是 office 方言的地盘，那边有自己的自检。
 *
 * 反向用例（标 ✗ 的）比正向用例重要：正向用例只证明「能认出来」，
 * 反向用例证明「不该认的没乱认」。上一轮真实事故全在反向那侧：
 *   · 「图1-1␣␣精密平口钳」按空白切 → 造出 35 个「图名为空」的假红点
 *   · 只判 fig 不判 img → figs_in_table = 0 的假绿，真实是 504 张图埋在表里
 *   · VML 图片没解析尺寸 → 页数估算 156 页，真实 285 页，「260 页以内」假绿
 */
import { buildStructure } from './import.mjs'
import { STANDARD_SECTIONS } from './dialect.mjs'
import { normalizeDocumentXml, planFlatten, scanParagraphs } from './normalize.mjs'

let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`) }
}

const P = (text, opts = {}) => ({ kind: 'p', text, inTable: false, fmt: { sizes: opts.sizes || ['24'], line: opts.line || '480/auto' }, imgs: opts.imgs || [] })
const TBL_START = (seq) => ({ kind: 'tbl_start', seq })
const TBL_END = (seq) => ({ kind: 'tbl_end', seq })

const mkMedia = (files) => new Map(files.map((f) => [f.file, { ext: 'png', bytes: 1000, vector: false, w: f.w ?? 1000, h: f.h ?? 1000, min_edge: Math.min(f.w ?? 1000, f.h ?? 1000), max_edge: Math.max(f.w ?? 1000, f.h ?? 1000), in_table: false, captioned: false, used: 0, inline: false, ...f }]))

const run = (items, media = new Map(), rels = new Map()) =>
  buildStructure({ items, media, rels }, { standardSections: STANDARD_SECTIONS })

console.log('\n[结构识别]')
{
  const st = run([
    P('项目一  走进机械零部件测绘'),
    P('任务一 认识零部件测绘的步骤'),
    P('【任务描述】'),
    P('【知识链接】'),
    P('任务二 游标类量尺的使用'),
    P('【任务描述】'),
    P('项目二  典型机械零件图的二维绘制'),
    P('任务一 “主动轴”零件图的绘制'),
  ])
  ok('项目按汉字数字编号', st.projs.size === 2 && st.projs.get(1).title === '走进机械零部件测绘')
  ok('任务 ID 是「项目-任务」两级', st.tasks.has('1-1') && st.tasks.has('1-2') && st.tasks.has('2-1'))
  ok('任务归属正确的项目', st.tasks.get('2-1').proj === 2)
  ok('栏目挂到当前任务', st.sects.filter((s) => s.task === '1-1').length === 2)
}

console.log('\n[图注解析 —— 上一轮栽过的地方]')
{
  const st = run([
    P('项目一 x'), P('任务一 y'),
    P('图1-1  精密平口钳'),                        // 图号与图名之间两个空格
    P('图1-2 测绘对象       图1-3测绘资料准备'),      // 一段并排两条图注
    P('图1-11压块工程图'),                          // 图号与图名之间无空格
  ])
  ok('两空格分隔的图名不被切掉', st.figs.get('1-1')?.name === '精密平口钳', `实为 ${JSON.stringify(st.figs.get('1-1')?.name)}`)
  ok('并排图注两条都认出', st.figs.has('1-2') && st.figs.has('1-3'))
  ok('并排图注各自的名字正确', st.figs.get('1-2')?.name === '测绘对象' && st.figs.get('1-3')?.name === '测绘资料准备',
    `实为 ${st.figs.get('1-2')?.name} / ${st.figs.get('1-3')?.name}`)
  ok('无空格分隔也认得出图名', st.figs.get('1-11')?.name === '压块工程图')
}

console.log('\n[反向用例 —— 不该认的别乱认]')
{
  const st = run([
    P('项目一 x'), P('任务一 y'),
    P('图1-1 精密平口钳'),
    P('现有一种精密平口钳，如图1-1所示，请你根据测绘步骤进行机构特征分析。'), // ✗ 不是图注，是引用
    P('HYPERLINK \\l "_Toc193755919" 项目二 典型零件 PAGEREF _Toc193755919 \\h 62'), // ✗ 目录行
  ])
  ok('✗ 正文引用不被当成图注', st.figs.size === 1, `认出了 ${st.figs.size} 条图注`)
  ok('✗ 目录行不建项目对象', st.projs.size === 1, `认出了 ${st.projs.size} 个项目`)
  ok('引用被记到图上', st.figs.get('1-1')?.referenced === true)
}
{
  const st = run([P('项目一 x'), P('任务一 y'), P('图1-1 甲'), P('见图1-9 与图2-30。')])
  ok('悬空引用被抓出', JSON.stringify(st.stats.dangling_fig_refs) === '["1-9","2-30"]', JSON.stringify(st.stats.dangling_fig_refs))
  ok('✗ 有图注的图号不进悬空清单', !st.stats.dangling_fig_refs.includes('1-1'))
}

console.log('\n[编号层级 —— 责编意见②]')
{
  const st = run([P('项目四 x'), P('任务一 y'), P('表4-1-1 测量记录'), P('表4-1 尺寸表')])
  ok('三级表号被判为 num_level=3', st.tbls.get('4-1-1')?.level === 3)
  ok('两级表号被判为 num_level=2', st.tbls.get('4-1')?.level === 2)
  ok('三级编号进 malformed 清单', st.stats.malformed_tbl_nums.includes('4-1-1'))
}

console.log('\n[栏目 —— 责编意见①]')
{
  const st = run([
    P('项目一 x'), P('任务一 y'),
    P('【任务描述】'), P('知识链接'), P('【任务实施】'),
  ])
  ok('带【】的栏目被标 bracketed', st.sects.find((s) => s.kind === '任务描述')?.bracketed === true)
  ok('✗ 裸栏目名不被误标 bracketed', st.sects.find((s) => s.kind === '知识链接')?.bracketed === false)
  ok('缺失栏目被列出', st.tasks.get('1-1').sections_missing.includes('任务评价'))
  ok('✗ 已有栏目不进缺失清单', !st.tasks.get('1-1').sections_missing.includes('任务描述'))
}
{
  // 「技能目标」是本书的叫法，出版社要「能力目标」——归一化后不该报缺失
  const st = run([P('项目一 x'), P('任务一 y'), P('技能目标'), P('任务描述'), P('知识链接'), P('任务实施'), P('任务评价'), P('任务拓展')])
  ok('✗ 五个标准栏目齐全时缺失清单为空', st.tasks.get('1-1').sections_missing.length === 0,
    JSON.stringify(st.tasks.get('1-1').sections_missing))
}

console.log('\n[图片资源 —— 责编意见⑦ 与印刷底线]')
{
  const media = mkMedia([{ file: 'media/a.png', w: 300, h: 200 }, { file: 'media/b.png', w: 1200, h: 900 }])
  const rels = new Map([['rId1', 'media/a.png'], ['rId2', 'media/b.png']])
  const st = run([
    P('项目一 x'), P('任务一 y'),
    TBL_START(1),
    P('步骤一', { imgs: [{ rId: 'rId1', cx: 2540000, cy: 1900000 }] }),   // 表格里的图，无图注
    TBL_END(1),
    P('', { imgs: [{ rId: 'rId2', cx: 2540000, cy: 1900000 }] }),
    P('图1-1 齿轮'),
  ], media, rels)
  ok('表格里的图片被标 in_table', st.stats.images_in_table === 1, `实为 ${st.stats.images_in_table}`)
  ok('✗ 表格外的图片不被误标', media.get('media/b.png').in_table === false)
  ok('无图注的图片被数出来', st.stats.images_without_caption === 1, `实为 ${st.stats.images_without_caption}`)
  ok('图注绑定到邻近图片', st.figs.get('1-1')?.img === 'media/b.png', `实为 ${st.figs.get('1-1')?.img}`)
  ok('低分辨率图片被数出来', st.stats.images_below_400 === 1)
}

console.log('\n[行内符号 —— 这个毛病犯过两次，第三次靠这几条拦住]')
{
  // book/0.1 首版对 φ/±/Ra 报「印刷必糊」，产出 108 条假警；
  // textbook 方言首版原样复发，663 条里 202 条是它们。规则：小图 + 长文本宿主 = 行内符号。
  const media = mkMedia([
    { file: 'media/phi.png', w: 25, h: 24 },      // 行内符号：φ
    { file: 'media/small-fig.png', w: 300, h: 200 }, // 小插图：独占一段，该判
  ])
  const rels = new Map([['rId1', 'media/phi.png'], ['rId2', 'media/small-fig.png']])
  const st = run([
    P('项目一 x'), P('任务一 y'),
    P('测量该轴的直径 φ 12 时应使用外径千分尺，读数方法见下图，注意消除视差。', { imgs: [{ rId: 'rId1', cx: 30000, cy: 30000 }] }),
    P('', { imgs: [{ rId: 'rId2', cx: 2540000, cy: 1900000 }] }),
    P('图1-1 千分尺读数'),
  ], media, rels)
  ok('✗ 行内符号不算进「印刷必糊」', st.stats.images_below_400 === 1, `实为 ${st.stats.images_below_400}`)
  ok('行内符号被单独数出来', st.stats.inline_symbols === 1, `实为 ${st.stats.inline_symbols}`)
  ok('✗ 行内符号不算进「缺图注」', st.stats.images_without_caption === 0, `实为 ${st.stats.images_without_caption}`)
  ok('独占一段的小插图仍然该判', media.get('media/small-fig.png').inline === false)
}
{
  // 25px 的图**独占一段也仍是符号**：印出来才 2mm，不可能是插图。
  // 这是 OR 逻辑的第一条（绝对尺寸压倒宿主判断），不是漏判。
  const media = mkMedia([{ file: 'media/tiny.png', w: 25, h: 24 }])
  const rels = new Map([['rId1', 'media/tiny.png']])
  const st = run([P('项目一 x'), P('任务一 y'), P('', { imgs: [{ rId: 'rId1', cx: 30000, cy: 30000 }] })], media, rels)
  ok('25px 图独占一段仍判为行内符号（OR 第一条）', st.stats.inline_symbols === 1 && st.stats.images_below_400 === 0)
}
{
  // OR 第二条：尺寸够大（300px）但嵌在长正文里 → 仍是行内符号；独占一段 → 才是插图
  const media = mkMedia([{ file: 'media/a.png', w: 300, h: 200 }, { file: 'media/b.png', w: 300, h: 200 }])
  const rels = new Map([['rId1', 'media/a.png'], ['rId2', 'media/b.png']])
  const st = run([
    P('项目一 x'), P('任务一 y'),
    P('这一段有很长的正文，图就嵌在行文当中，属于随文符号而不是独立插图。', { imgs: [{ rId: 'rId1' }] }),
    P('', { imgs: [{ rId: 'rId2' }] }),
  ], media, rels)
  ok('大图嵌在长正文里判为行内（OR 第二条）', media.get('media/a.png').role === 'inline', media.get('media/a.png').role)
  ok('✗ 大图独占一段判为插图', media.get('media/b.png').role === 'figure', media.get('media/b.png').role)
}
{
  // 第三类：找不到宿主段落的图**不敢判** —— 把未知当已知去报警是判据最常见的撒谎方式
  const media = mkMedia([{ file: 'media/ghost.png', w: 100, h: 80 }])
  const st = run([P('项目一 x'), P('任务一 y')], media, new Map())
  ok('未被引用的图判为 unplaced 而非插图', media.get('media/ghost.png').role === 'unplaced')
  ok('✗ unplaced 不进「印刷必糊」', st.stats.images_below_400 === 0)
  ok('unplaced 被单独数出来', st.stats.unplaced_images === 1)
}

console.log('\n[排版事实 —— 责编意见④]')
{
  const st = run([
    P('项目一 x'), P('任务一 y'),
    P('这是一段足够长的正文用于统计字号与行距。', { sizes: ['24'], line: '480/auto' }),
    P('这是另一段足够长的正文，行距却是 1.5 倍。', { sizes: ['24'], line: '360/auto' }),
    P('这是第三段足够长的正文，字号变成了五号。', { sizes: ['21'], line: '480/auto' }),
  ])
  ok('行距变体数被数出', st.stats.linespacing_variants === 2, `实为 ${st.stats.linespacing_variants}`)
  ok('字号变体数被数出', st.stats.body_size_variants === 2, `实为 ${st.stats.body_size_variants}`)
  ok('页数估算含排版损耗系数', st.stats.pages_est >= st.stats.pages_content)
}
{
  // 表内文字不参与「正文字号是否统一」——表格里字本来就该小，混进来会造出永远修不好的红点
  const st = run([
    P('项目一 x'), P('任务一 y'),
    P('这是一段足够长的正文用于统计字号与行距。', { sizes: ['24'], line: '480/auto' }),
    TBL_START(1),
    P('这是表格里一段足够长的说明文字，字号是五号。', { sizes: ['21'], line: '300/auto' }),
    TBL_END(1),
  ])
  ok('✗ 表内文字不算进正文字号变体', st.stats.body_size_variants === 1, `实为 ${st.stats.body_size_variants}`)
  ok('表内文字仍算进页数', st.stats.all_chars > st.stats.body_chars)
}

console.log('\n[正文排版统计的靶子 —— 别数不该数的]')
{
  // 图注、组图标注不是正文。混进来的后果：行距永远「不统一」、红点归不了零，
  // 看上去像稿子没改好——其实是判据在数不该数的东西（与 108 条行内符号假警同族）。
  const st = run([
    P('项目一 x'), P('任务一 y'),
    P('这是一段足够长的正文用于统计字号与行距。', { sizes: ['24'], line: '480/auto' }),
    P('图1-1 这是一条足够长的图注文字用来凑够字数', { sizes: ['24'], line: '300/auto' }),
    P('（a）这是一条足够长的组图标注用来凑够字数', { sizes: ['24'], line: '360/auto' }),
  ])
  ok('✗ 图注与组图标注不算进正文行距变体', st.stats.linespacing_variants === 1, `实为 ${st.stats.linespacing_variants}`)
}

console.log('\n[改稿器 normalize —— 改错一处就是改坏一本书]')
const W = (t, pPr = '', rPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t>${t}</w:t></w:r></w:p>`
{
  const xml = '<w:body>' + W('【知识链接】') + W('单击【定位】搜索，显示如图4-25所示图幅，这段话足够长。') + '</w:body>'
  const r = normalizeDocumentXml(xml, { debracket: true })
  ok('栏目名去掉【】', r.xml.includes('<w:t>知识链接</w:t>'))
  ok('✗ 正文里的【定位】不许碰', r.xml.includes('单击【定位】搜索'), '软件按钮名被当成栏目名去了括号')
  ok('栏目名加了黑体', /<w:rPr><w:b\/><w:bCs\/><\/w:rPr><w:t>知识链接/.test(r.xml))
  ok('栏目名去掉首行缩进', r.xml.includes('w:firstLineChars="0"'))
}
{
  // rPr 子元素有 schema 顺序：rFonts 在 b 之前。插反了 Word 多半容忍——但那是在赌客户的 Word。
  const xml = '<w:body>' + W('【任务实施】', '', '<w:rFonts w:ascii="宋体"/>') + '</w:body>'
  const r = normalizeDocumentXml(xml, { debracket: true })
  ok('黑体插在 rFonts 之后（schema 顺序）', /<w:rFonts[^>]*\/><w:b\/><w:bCs\/>/.test(r.xml), r.xml.slice(0, 160))
}
{
  // 三级表号压两级：4-1-1→4-2，而已存在的两级 4-1 不动。
  const texts = ['表4-1 精密平口钳信息表', '表4-1-1 固定钳身技术要求', '表4-1-2 量具清单', '表4-2-1 丝杆技术要求']
  const plan = planFlatten(texts, '表', 4)
  ok('已有的两级号保持不变', plan.get('4-1') === '4-1', `实为 ${plan.get('4-1')}`)
  ok('三级号按文档顺序压成两级', plan.get('4-1-1') === '4-2' && plan.get('4-1-2') === '4-3' && plan.get('4-2-1') === '4-4')
  ok('不空格接表名的表注也认得', planFlatten(['表4-1-4常用铸铁的名称'], '表', 4).get('4-1-4') === '4-1')
  ok('✗ 正文提到的表号不当成表注', planFlatten(['表4-1的技术要求如下所述'], '表', 4).size === 0)
}
{
  const xml = '<w:body>' + W('表4-1-1 固定钳身技术要求') + W('表4-1-2 量具清单') + W('根据表4-1-1的技术要求完成标注；固定钳身的测绘过程见表4-1-2。') + '</w:body>'
  const r = normalizeDocumentXml(xml, { tblFlatten: 4 })
  ok('表注与正文引用一起改', r.xml.includes('<w:t>表4-1 固定钳身技术要求') && r.xml.includes('根据表4-1的技术要求') && r.xml.includes('见表4-2。'), r.xml)
  ok('✗ 不双重替换（4-1-1→4-1 后不再当 4-1 改一次）', (r.xml.match(/表4-1(?!\d)/g) || []).length === 2, r.xml)
}
{
  // 文本框里嵌套的 w:p：非贪婪正则会在内层 </w:p> 提前收尾，把外层段落截断成两半，
  // 于是 pPr 插到错误的位置、框里的字被吞掉。深度扫描保证一段就是一段。
  const nested = '<w:p><w:r><w:t>这是一段足够长的正文，后面挂着一个文本框。</w:t></w:r><w:txbxContent><w:p><w:r><w:t>框里的字</w:t></w:r></w:p></w:txbxContent></w:p>'
  const xml = '<w:body>' + nested + W('【任务评价】') + '</w:body>'
  const r = normalizeDocumentXml(xml, { debracket: true })
  ok('✗ 文本框嵌套不把外层段落切成两段', scanParagraphs(xml).length === 2, `实为 ${scanParagraphs(xml).length}`)
  ok('✗ 框里的字不被吞掉', r.xml.includes('框里的字'))
  ok('嵌套段落之后的栏目名照常改', r.xml.includes('<w:t>任务评价</w:t>'))
}
{
  const xml = '<w:body>' + W('这是一段足够长的正文，行距是 1.5 倍需要归一。', '<w:spacing w:line="360" w:lineRule="auto"/>')
            + W('图1-1 这是一条足够长的图注，行距也是 1.5 倍但不该被改', '<w:spacing w:line="360" w:lineRule="auto"/>') + '</w:body>'
  const r = normalizeDocumentXml(xml, { line: 480 })
  ok('正文行距归一', r.stats.line === 1, `实为 ${r.stats.line}`)
  ok('✗ 图注不被行距归一波及', (r.xml.match(/w:line="360"/g) || []).length === 1)
}
{
  const xml = '<w:body>' + W('这是一段足够长的正文，缩进是杂牌绝对值。', '<w:ind w:firstLine="442"/>')
            + W('这是一段足够长的正文，本来就没有任何缩进设定。') + '</w:body>'
  const r = normalizeDocumentXml(xml, { indent: true })
  ok('杂牌绝对缩进归一为 2 字', r.stats.indent === 1 && r.xml.includes('w:firstLineChars="200"'))
  ok('✗ 无缩进的段落不硬加缩进', (r.xml.match(/w:firstLineChars="200"/g) || []).length === 1)
}

console.log(`\n${fail === 0 ? '全部通过' : '有失败'}：${pass} 通过 / ${fail} 失败\n`)
process.exit(fail === 0 ? 0 : 1)
