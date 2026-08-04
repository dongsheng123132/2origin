// 裁判文书文本解析 —— 从「一份判决书」里读出依据链的骨架。
//
// ## 为什么解析器只做这么多
//
// 判决书的**引用格式高度规范**（「依照《中华人民共和国刑法》第二百六十四条……之规定」），
// 正则就能可靠抽取；金额、刑期同理。所以 A 类问题（引用存在/有效/可引）审计得了。
//
// **但量刑的中间量根本不在判决书里。** 量刑起点、基准刑、各情节调节比例写在
// 量刑建议书与量刑评议表上，在卷内，不在文书上；判决书只写一句「依法从轻处罚」。
// 这不是解析器的缺陷，是**依据链在今天的文书里本来就是断的**——
// 一份判决为什么判两年而不是三年，从文书上无法复算，也就无从校验。
//
// 所以本解析器接受一个可选的【量刑评议表】段（办案系统内的结构化数据）。
// 没有它时，D 类（数字可复算）约束因字段缺失而自动跳过——谓词的既有行为，
// 导入器会明说「D 类未校验」，而不是假装体检通过。

const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const CN_UNIT = { 十: 10, 百: 100, 千: 1000 }
const CN_BIG = { 万: 1e4, 亿: 1e8 }
const CN_CHARS = '〇零一二三四五六七八九十百千万亿两'

/** 中文数字 → 阿拉伯数字。二百六十四 → 264，八万六千 → 86000，十 → 10。 */
export function cn2num(s) {
  const t = String(s ?? '').trim()
  if (!t) return NaN
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t)
  let total = 0, section = 0, num = 0, seen = false
  for (const ch of t) {
    if (ch in CN_DIGIT) { num = CN_DIGIT[ch]; seen = true }
    else if (ch in CN_UNIT) { section += (seen && num ? num : 1) * CN_UNIT[ch]; num = 0; seen = true }
    else if (ch in CN_BIG) { total += (section + num) * CN_BIG[ch]; section = 0; num = 0; seen = true }
    else return NaN
  }
  return seen ? total + section + num : NaN
}

/**
 * 「二〇二六年七月十五日」→ 2026-07-15。年份逐字读，月日按数值读。
 * 取**最后一个**匹配：判决书首部有被告人出生日期、案发日期、羁押日期，
 * 落款日期永远在最后——而裁判时点要的正是落款那一个。
 */
export function cnDate(s) {
  const all = [...String(s ?? '').matchAll(new RegExp(`([${CN_CHARS}\\d]{2,6})年([${CN_CHARS}\\d]{1,3})月([${CN_CHARS}\\d]{1,3})日`, 'g'))]
  const m = all[all.length - 1]
  if (!m) return null
  const year = /^\d+$/.test(m[1]) ? Number(m[1]) : Number([...m[1]].map((c) => CN_DIGIT[c] ?? '').join(''))
  const mo = cn2num(m[2]), d = cn2num(m[3])
  if (!Number.isFinite(year) || !Number.isFinite(mo) || !Number.isFinite(d)) return null
  return `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** 「有期徒刑二年三个月」→ 27（月）。「拘役四个月」同理。 */
export function termToMonths(s) {
  const t = String(s ?? '')
  const y = t.match(new RegExp(`([${CN_CHARS}\\d]+)年`))
  const mo = t.match(new RegExp(`([${CN_CHARS}\\d]+)个月`))
  const years = y ? cn2num(y[1]) : 0
  const months = mo ? cn2num(mo[1]) : 0
  const n = (Number.isFinite(years) ? years : 0) * 12 + (Number.isFinite(months) ? months : 0)
  return n > 0 ? n : NaN
}

/** 「人民币八万六千元」/「86000元」→ 86000。 */
export function moneyToNum(s) {
  const t = String(s ?? '').replace(/人民币|元|整/g, '').replace(/,/g, '').trim()
  return cn2num(t)
}

// 「依照《中华人民共和国刑法》第二百六十四条、第六十七条第一款……之规定」
// 一次引用可以带多个条文，条文后可带款、项——都要拆开，因为「引对了法但引错了款」也是漏。
const CITE_BLOCK = new RegExp(`《([^》]+)》((?:\\s*第[${CN_CHARS}\\d]+条(?:第[${CN_CHARS}\\d]+款)?(?:第[${CN_CHARS}\\d]+项)?[、，,和]?)+)`, 'g')
const ARTICLE = new RegExp(`第([${CN_CHARS}\\d]+)条(?:第([${CN_CHARS}\\d]+)款)?(?:第([${CN_CHARS}\\d]+)项)?`, 'g')

/** 从一段文字里抽出全部法条引用。@returns [{ title, article, clause, item, raw }] */
export function extractCitations(text) {
  const out = []
  for (const m of String(text ?? '').matchAll(CITE_BLOCK)) {
    const title = m[1].trim()
    for (const a of m[2].matchAll(ARTICLE))
      out.push({
        title,
        article: cn2num(a[1]),
        article_cn: a[1],
        clause: a[2] ? cn2num(a[2]) : null,
        item: a[3] ? cn2num(a[3]) : null,
        raw: `《${title}》${a[0]}`,
      })
  }
  return out
}

// 真实判决书的段落标记有大量变体，各地各庭写法不一。下面每条都对应实际见过的写法：
//   查明：本院经审理查明 / 经审理查明 / 审理查明 / 本院查明
//   证据：上述事实，有下列证据证实 / 以上事实，有经庭审举证质证的下列证据在案佐证 /
//         认定上述事实的证据如下
// 标记缺失时该段为空——**不猜、不回退到「整篇当说理段」**。
// 把整篇当说理段会让数字对照产生大量假阳性，几次误报之后没人会再看体检结果。
const SECTIONS = [
  ['查明', /(?:本院(?:经审理)?|经审理|经审理依法)?(?:经)?审理查明[：:，,]?|本院查明[：:，,]?/],
  ['证据', /(?:上述|以上|认定上述|认定以上)事实[，,][^。]{0,60}(?:证据|佐证|材料)[^。]{0,24}[：:]/],
  ['说理', /本院认为[，,]?/],
  ['主文', /判决如下[：:]?/],
  ['评议', /【量刑评议表】/],
]

/**
 * 找「裁判依据段」的起点。
 *
 * 不能简单匹配 `依照《`：真实文书里写法有「依照」「依据」「根据」「据此，依照」，
 * 而**说理段本身也会出现「根据《……》」**（引指导意见说理）。
 * 所以规则是：取**判决如下之前最后一个**、且 30 字内跟着书名号的那个引导词——
 * 裁判依据段永远紧贴判决主文，这一条比任何关键词表都稳。
 */
function findBasisStart(head) {
  let best = -1
  for (const m of head.matchAll(/依照|依据|根据|据此/g))
    if (head.slice(m.index, m.index + 30).includes('《')) best = m.index
  return best
}

/** 按判决书的段落标记切段。 */
export function splitSections(text) {
  const src = String(text ?? '')
  const hits = []
  for (const [name, re] of SECTIONS) {
    const m = src.match(re)
    if (m) hits.push({ name, start: m.index, after: m.index + m[0].length })
  }
  // 裁判依据段：起点由「紧贴主文」推出，不靠关键词表
  const 主文 = hits.find((h) => h.name === '主文')
  if (主文) {
    const at = findBasisStart(src.slice(0, 主文.start))
    // 落在说理段之前的引导词不算——那多半是首部叙述里的「根据起诉书」之类
    const 说理 = hits.find((h) => h.name === '说理')
    if (at >= 0 && (!说理 || at > 说理.start)) hits.push({ name: '依据', start: at, after: at })
  }
  hits.sort((a, b) => a.start - b.start)
  const out = { 首部: src.slice(0, hits[0]?.start ?? src.length) }
  for (let i = 0; i < hits.length; i++)
    out[hits[i].name] = src.slice(hits[i].after, hits[i + 1]?.start ?? src.length).trim()
  // 依据段的引导词本身要留着——「依照」后面紧跟的就是第一处引用
  if (out.依据 !== undefined) {
    const h = hits.find((x) => x.name === '依据')
    out.依据 = src.slice(h.start, hits[hits.indexOf(h) + 1]?.start ?? src.length).trim()
  }
  return out
}

/**
 * 解析【量刑评议表】。这是办案系统内的结构化数据，不属判决书正文。
 * 行格式（制表符或多空格分列均可）：
 *   量刑起点：有期徒刑六个月
 *   基准刑：有期徒刑二十四个月
 *   情节：自首  -35%  证据 E-03、E-04  依据 刑法第六十七条第一款
 *   拟宣告刑：有期徒刑十个月
 */
export function parseWorksheet(text) {
  if (!text) return null
  const ws = { factors: [] }
  for (const raw of String(text).split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let m
    if ((m = line.match(/^量刑起点[：:]\s*(.+)$/))) ws.起点 = termToMonths(m[1])
    else if ((m = line.match(/^基准刑[：:]\s*(.+)$/))) ws.基准刑 = termToMonths(m[1])
    else if ((m = line.match(/^拟宣告刑[：:]\s*(.+)$/))) ws.拟宣告刑 = termToMonths(m[1])
    else if ((m = line.match(/^法定刑幅度[：:]\s*(.+)$/))) ws.法定刑幅度 = m[1].trim()
    else if ((m = line.match(/^情节[：:]\s*(\S+)\s+([+-]?[\d.]+)%(.*)$/))) {
      const rest = m[3] ?? ''
      const ev = rest.match(/证据\s*([^\s依]+)/)
      const law = rest.match(/依据\s*(.+?)\s*$/)
      ws.factors.push({
        name: m[1],
        ratio: Number(m[2]) / 100,
        // 「证据 —」与整个字段缺失是两回事：前者是明确写了「无」，后者是忘了填。
        // 都判为缺证据，但保留原样便于人复核。
        basis: ev && !/^[—\-–]$/.test(ev[1]) ? ev[1].split(/[、,，]/).map((s) => `evidence:${s.trim()}`).filter(Boolean) : null,
        law_text: law && !/^[—\-–]$/.test(law[1]) ? law[1].trim() : null,
      })
    }
  }
  return ws
}

/** 抽出一段文字里所有「人民币X元」形态的金额。 */
export function extractAmounts(text) {
  const out = []
  for (const m of String(text ?? '').matchAll(new RegExp(`(?:人民币)?([${CN_CHARS}\\d,]+)元`, 'g'))) {
    const v = moneyToNum(m[1])
    if (Number.isFinite(v)) out.push({ value: v, raw: m[0], index: m.index })
  }
  return out
}

/** 抽出一段文字里所有「有期徒刑X年X个月 / 拘役X个月」形态的刑期。 */
export function extractTerms(text) {
  const out = []
  for (const m of String(text ?? '').matchAll(new RegExp(`(?:有期徒刑|拘役|管制)\\s*([${CN_CHARS}\\d]+年)?([${CN_CHARS}\\d]+个月)?`, 'g'))) {
    if (!m[1] && !m[2]) continue
    const v = termToMonths(m[0])
    if (Number.isFinite(v)) out.push({ value: v, raw: m[0].trim(), index: m.index })
  }
  return out
}

/** 案号：（2026）沪0101刑初123号 → { 案号, 类型 }。类型取「刑初」「民初」「行初」的首字。 */
export function parseCaseNo(text) {
  const m = String(text ?? '').match(/[（(]\s*(\d{4})\s*[)）]\s*([^\s]{0,12}?)(刑|民|行)(初|终|再|申)\s*(\d+)\s*号/)
  if (!m) return null
  return {
    案号: m[0].replace(/\s+/g, ''),
    年份: Number(m[1]),
    类型: { 刑: '刑事', 民: '民事', 行: '行政' }[m[3]],
    审级: m[4],
  }
}
