// DXF 解析器 —— 把图纸读成图元表。零依赖，只读，不写 DXF。
//
// DXF 是「组码 + 值」交替的行式格式：奇数行是组码（整数），偶数行是值。
//
//   0        ← 组码 0 = 实体类型开始
//   LINE
//   8        ← 组码 8 = 图层名
//   墙体
//   10 / 20  ← 起点 x / y
//   11 / 21  ← 终点 x / y
//
// 需要处理的三件麻烦事，都是真文件里躲不掉的：
//
// ① **R12 没有 handle。** 组码 5（实体句柄）是 R13 才普及的。R12 导出的图纸里
//    图元根本没有 ID——而稳定 ID 是本象的地基。所以这里如实报告 hasHandles，
//    由导入器决定退到内容寻址，并把这个降级写进包里，不假装它有 ID。
//
// ② **R12 的多段线是 POLYLINE + 一串 VERTEX + SEQEND**，三个实体拼一个图形；
//    R13+ 才有单实体的 LWPOLYLINE。两种都得认。
//
// ③ **同一个组码会重复出现**（LWPOLYLINE 的每个顶点都是 10/20），
//    所以值要按组码收成数组，不能后来的覆盖先前的。

/** 把 DXF 文本切成 [组码, 值] 序列。组码非数字即视为文件损坏——宁可报错也不猜。 */
export function toPairs(text) {
  const lines = text.split(/\r?\n/)
  const pairs = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const raw = lines[i].trim()
    if (raw === '') continue
    const code = Number(raw)
    if (!Number.isInteger(code)) throw new Error(`第 ${i + 1} 行组码不是整数：「${raw}」——不是合法 DXF`)
    pairs.push([code, lines[i + 1]])
  }
  return pairs
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : undefined }

/** 一个实体：{ type, layer, handle, codes: Map<code, value[]> }。 */
function makeEntity(type) {
  return { type, layer: '0', handle: null, codes: new Map(), vertices: [] }
}

function put(ent, code, value) {
  if (code === 8) ent.layer = value
  else if (code === 5) ent.handle = value
  if (!ent.codes.has(code)) ent.codes.set(code, [])
  ent.codes.get(code).push(value)
}

const first = (ent, code) => ent.codes.get(code)?.[0]
const nums = (ent, code) => (ent.codes.get(code) ?? []).map(num).filter((x) => x !== undefined)

/**
 * 解析整个 DXF。
 * @returns { version, hasHandles, layers: [{name, color}], entities: [...] }
 */
export function parseDxf(text) {
  const pairs = toPairs(text)
  const layers = []
  const entities = []
  let version = null
  let section = null
  let ent = null
  let pendingPolyline = null   // R12：POLYLINE 开着，后续 VERTEX 都归它
  let tableName = null
  let layerEnt = null

  const flushEntity = () => {
    if (!ent) return
    if (ent.type === 'VERTEX' && pendingPolyline) {
      const [x, y] = [num(first(ent, 10)), num(first(ent, 20))]
      if (x !== undefined && y !== undefined) pendingPolyline.vertices.push([x, y])
    } else if (ent.type === 'SEQEND') {
      pendingPolyline = null
    } else if (ent.type === 'POLYLINE') {
      pendingPolyline = ent
      entities.push(ent)
    } else {
      entities.push(ent)
    }
    ent = null
  }

  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i]

    if (code === 0) {
      flushEntity()
      if (value === 'SECTION') { section = pairs[i + 1]?.[0] === 2 ? pairs[i + 1][1] : null; continue }
      if (value === 'ENDSEC') { section = null; pendingPolyline = null; continue }
      if (value === 'EOF') break

      if (section === 'TABLES') {
        if (value === 'TABLE') { tableName = pairs[i + 1]?.[0] === 2 ? pairs[i + 1][1] : null; continue }
        if (value === 'ENDTAB') { tableName = null; continue }
        if (value === 'LAYER' && tableName === 'LAYER') { layerEnt = { name: null, color: null }; layers.push(layerEnt); continue }
        layerEnt = null
        continue
      }
      if (section === 'ENTITIES') { ent = makeEntity(value); continue }
      continue
    }

    if (section === 'HEADER' && code === 1 && pairs[i - 1]?.[1] === '$ACADVER') version = value
    if (section === 'TABLES' && layerEnt) {
      if (code === 2) layerEnt.name = value
      else if (code === 62) layerEnt.color = num(value)
      continue
    }
    if (ent) put(ent, code, value)
  }
  flushEntity()

  // LWPOLYLINE 的顶点是重复的 10/20，收完再配对
  for (const e of entities) {
    if (e.type === 'LWPOLYLINE') {
      const xs = nums(e, 10), ys = nums(e, 20)
      e.vertices = xs.map((x, k) => [x, ys[k]]).filter((p) => p[1] !== undefined)
    }
    e.closed = ((num(first(e, 70)) ?? 0) & 1) === 1
  }

  return {
    version,
    hasHandles: entities.some((e) => e.handle),
    layers: layers.filter((l) => l.name),
    entities: entities.filter((e) => e.type !== 'VERTEX' && e.type !== 'SEQEND'),
  }
}

/** 图元的几何摘要——面积/长度/包围盒这些是能被约束判定的量，原始坐标不是。 */
export function geometryOf(e) {
  const g = { }
  const pts = e.vertices?.length ? e.vertices : null

  if (e.type === 'LINE') {
    const [x1, y1, x2, y2] = [num(first(e, 10)), num(first(e, 20)), num(first(e, 11)), num(first(e, 21))]
    if ([x1, y1, x2, y2].every((v) => v !== undefined)) {
      g.length = round(Math.hypot(x2 - x1, y2 - y1))
      g.bbox = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)].map(round)
    }
  } else if (e.type === 'CIRCLE' || e.type === 'ARC') {
    const [cx, cy, r] = [num(first(e, 10)), num(first(e, 20)), num(first(e, 40))]
    if ([cx, cy, r].every((v) => v !== undefined)) {
      g.radius = round(r)
      g.bbox = [cx - r, cy - r, cx + r, cy + r].map(round)
      if (e.type === 'CIRCLE') g.area = round(Math.PI * r * r)
    }
  } else if (e.type === 'TEXT' || e.type === 'MTEXT') {
    const [x, y] = [num(first(e, 10)), num(first(e, 20))]
    g.at = [round(x), round(y)]
    g.height = round(num(first(e, 40)))
  } else if (pts) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
    g.bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(round)
    g.vertices = pts.length
    let len = 0
    for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])
    if (e.closed && pts.length > 2) {
      len += Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1])
      let a = 0
      for (let k = 0; k < pts.length; k++) {
        const [x1, y1] = pts[k], [x2, y2] = pts[(k + 1) % pts.length]
        a += x1 * y2 - x2 * y1
      }
      g.area = round(Math.abs(a) / 2)
    }
    g.length = round(len)
  }
  if (g.bbox) { g.width = round(g.bbox[2] - g.bbox[0]); g.height_mm = round(g.bbox[3] - g.bbox[1]) }
  return g
}

/** 文字内容（TEXT 用组码 1；MTEXT 可能被 3 分段承载）。 */
export function textOf(e) {
  const parts = [...(e.codes.get(3) ?? []), ...(e.codes.get(1) ?? [])]
  return parts.join('').trim() || null
}

const round = (v) => (v === undefined ? undefined : Math.round(v * 100) / 100)
