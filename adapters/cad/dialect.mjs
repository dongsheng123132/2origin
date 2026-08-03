// CAD 方言 —— 用本象表示一张图纸。
//
// 对象命名把**图层编进 ID**：`ent:门窗/a1b2c3`、`text:标注/9f8e7d`。
// 这不是凑合——图层在 CAD 里本来就是语义分类（谁都不会把窗画在墙体层），
// 于是「门窗层的图元数量必须等于标注层的编号数量」可以直接用通配约束表达，
// 不必给校验器加任何领域知识。
//
// 四类对象：
//   dwg:    图纸本身（版次、标题、来源文件）
//   layer:  图层
//   ent:    几何图元（线、多段线、圆、弧）
//   text:   文字（编号、说明）
//
// 下面这些规则全部是**制图规范里本来就有的**，不是为了演示编出来的：
// 图元不许留在 0 层、构件编号不许重复、图上画的数量要和编号对得上、字高不能小到看不清。
// 这些今天靠人拿放大镜核对，错了往往到施工现场才发现。

export const CAD_TYPES = ['dwg', 'layer', 'ent', 'text']

/**
 * @param opts.annotationLayer 编号所在的图层（默认「标注」）
 * @param opts.countedLayer    需要与编号一一对应的构件图层（默认「门窗」）
 * @param opts.minTextHeight   最小字高，按图幅给（默认 200，适用于毫米制建筑图）
 */
export const cadConstraints = ({ annotationLayer = '标注', countedLayer = '门窗', minTextHeight = 200 } = {}) => [
  {
    id: 'no-layer-zero',
    rule: '图元不得留在 0 层（制图规范；0 层图元无法被关层管理，出图时关不掉）',
    check: { type: 'count', object: 'ent:0/*', equals: 0 },
  },
  {
    id: 'no-text-layer-zero',
    rule: '文字不得留在 0 层',
    check: { type: 'count', object: 'text:0/*', equals: 0 },
  },
  {
    id: 'unique-label',
    rule: `${annotationLayer}层的编号不得重复`,
    check: { type: 'unique', object: `text:${annotationLayer}/*`, field: 'content' },
  },
  {
    // 「图上画了 4 樘窗，门窗表写 5 樘」是最典型的图纸不一致，
    // 今天全靠人一个个数。它的通用形状是：同一件事有两处表述，两处必须对得上。
    id: 'label-count-matches',
    rule: `${countedLayer}层的构件数量必须等于${annotationLayer}层的编号数量（每樘有且仅有一个编号）`,
    check: { type: 'count', object: `ent:${countedLayer}/*`, equals_count_of: `text:${annotationLayer}/*` },
  },
  {
    id: 'min-text-height',
    rule: `字高不得小于 ${minTextHeight}（小于图幅 1/300 等于没标）`,
    check: { type: 'range', object: 'text:*', field: 'height', min: minTextHeight },
  },
]

export const CAD_MANIFEST = (id, title, source) => `# 本象包（CAD 方言）
artifact:
  id: ${id}
  kind: drawing
  title: ${title}

payload:
  uri: ${source}
  media_type: image/vnd.dxf

provenance:
  source: ${source}
  history: ./provenance/history.jsonl
`
