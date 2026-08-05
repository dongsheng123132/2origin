#!/usr/bin/env node
// W3-V 判分器自测：用已知崩坏的分镜表反测规则会不会响，用干净的反测零误报。
//
//   node eval/shot-selftest.mjs
//
// 沿用 selftest.mjs 的纪律——**判分器不空转必须先证明**。
// 一个从不报错的判分器和一个见谁都报的判分器，在真实数据上都会给出好看的表，
// 而 Run #1 的教训是：一个拒绝一切的系统在错误率上永远完美。
//
// 误报陷阱（否定与转述）单独设了四个用例。ced.mjs 当初就栽在这里：
// 「钥匙不在赵七处」被判成钥匙归赵七——分镜表里「空间门紧闭，未曾开启」是同型陷阱。

import { scoreW3V, loadShotTask } from './shot-diff.mjs'

const task = loadShotTask()

/** 一份**合法**的基准分镜表：5 章 × 7 镜 + 终局交接，接触度全部达标 */
function baseShots() {
  const shots = []
  for (const ch of [51, 52, 53, 54, 55]) {
    for (let k = 1; k <= 7; k++) {
      const s = {
        id: `${ch}-${String(k).padStart(2, '0')}`,
        chapter: ch,
        cast: ['char:lin-zheng'],
        props: {},
        appearance: {},
        location: 'loc:moon-platform',
        visual: '月台之上，林峥按刀而立，夜风卷动旗角。',
        camera: '中景 侧面',
      }
      if (k === 2) {
        s.cast.push('char:bai-yao')
        s.appearance['char:bai-yao'] = { left_hand_injured: true }
        s.visual = '白遥立于阶下，左手缠着旧布，垂在身侧不动。'
      }
      if (k === 4) {
        s.props['obj:black-key'] = { holder: 'char:lin-zheng', used: false, intact: true }
        s.visual = '林峥摊开掌心，黑钥匙在火光下泛出暗芒。'
      }
      shots.push(s)
    }
  }
  shots.push({
    id: '55-08',
    chapter: 55,
    cast: ['char:lin-zheng', 'char:shen-yan'],
    props: { 'obj:black-key': { holder: 'char:shen-yan', used: false, intact: true } },
    appearance: {},
    location: 'loc:guanxing-tai',
    visual: '林峥将黑钥匙递回，沈砚双手接过，收入袖中。',
    camera: '近景 过肩',
  })
  return shots
}

const clone = () => structuredClone(baseShots())
const at = (shots, id) => shots.find((s) => s.id === id)

// ── 用例 ────────────────────────────────────────────────────────────────
// mutate 返回改造后的 shots；expect 拿判分结果作断言，返回 null 表示通过、字符串表示失败原因。
const CASES = [
  {
    name: '干净分镜表 → 零误报',
    mutate: (s) => s,
    expect: (r) =>
      r.errors !== 0 ? `应 0 错误，实为 ${r.errors}：${r.findings.map((f) => f.why).join('｜')}`
      : !r.engagementOk ? `接触度应达标，实为 ${r.engagement.shortfalls.join('，')}` : null,
  },

  // ── V1 道具持有 ──
  {
    name: 'V1 道具瞬移：交回沈砚后又回到林峥手上',
    mutate: (s) => {
      s.push({ id: '55-09', chapter: 55, cast: ['char:lin-zheng'], props: { 'obj:black-key': { holder: 'char:lin-zheng', used: false, intact: true } }, appearance: {}, location: 'loc:moon-platform', visual: '林峥独立台上，掌中黑钥匙微凉。', camera: '近景' })
      return s
    },
    expect: (r) => (r.findings.some((f) => f.kind === 'V1' && f.why.includes('不可逆')) ? null : '未抓到单调性违反（转交不可逆）'),
  },
  {
    name: 'V1 终局持有者错：最后仍在林峥手上',
    mutate: (s) => { at(s, '55-08').props['obj:black-key'].holder = 'char:lin-zheng'; return s },
    expect: (r) => (r.findings.some((f) => f.why.includes('终局持有者')) ? null : '未抓到终局持有者错误'),
  },
  {
    name: 'V1 持有者越界：钥匙出现在白遥手上',
    mutate: (s) => { at(s, '53-04').props['obj:black-key'].holder = 'char:bai-yao'; return s },
    expect: (r) => (r.findings.some((f) => f.why.includes('不在允许集合')) ? null : '未抓到越界持有者'),
  },
  {
    name: 'V1 钥匙被使用：used=true（fz:gate-closed）',
    mutate: (s) => { at(s, '54-04').props['obj:black-key'].used = true; return s },
    expect: (r) => (r.findings.some((f) => f.why.includes('used')) ? null : '未抓到 used 违反'),
  },

  // ── V2 外观属性持续性（「一致性崩坏」的可测代理）──
  {
    name: 'V2 属性掉落：白遥在场却未带 left_hand_injured',
    mutate: (s) => { delete at(s, '52-02').appearance['char:bai-yao']; return s },
    expect: (r) =>
      r.findings.some((f) => f.kind === 'V2' && f.drop === 'missing') ? null : '未抓到属性缺失',
  },
  {
    name: 'V2 属性翻转：left_hand_injured 写成 false',
    mutate: (s) => { at(s, '53-02').appearance['char:bai-yao'].left_hand_injured = false; return s },
    expect: (r) =>
      r.findings.some((f) => f.kind === 'V2' && f.drop === 'flipped') ? null : '未抓到属性翻转',
  },
  {
    name: 'V2 掉落率：5 镜掉 2 → 40%',
    mutate: (s) => {
      delete at(s, '52-02').appearance['char:bai-yao']
      at(s, '53-02').appearance['char:bai-yao'].left_hand_injured = false
      return s
    },
    expect: (r) => (Math.abs(r.attributeDropRate - 0.4) < 1e-9 ? null : `掉落率应为 0.4，实为 ${r.attributeDropRate}`),
  },

  // ── V3 世界规则的视觉后果 ──
  {
    name: 'V3 铃响无鸟：rule:bell-birds 静默发生',
    mutate: (s) => { at(s, '51-06').visual = '铜铃在檐下震响，声浪压过夜风。'; return s },
    expect: (r) => (r.findings.some((f) => f.why.includes('禽鸟')) ? null : '未抓到铃响无鸟'),
  },
  {
    name: 'V3 铃响 + 鸟飞拆成相邻两镜 → 不应报（正常剪辑语法）',
    mutate: (s) => {
      at(s, '51-06').visual = '铜铃在檐下震响，声浪压过夜风。'
      at(s, '51-07').visual = '远处林梢，寒鸦成片惊起，冲天而散。'
      return s
    },
    expect: (r) => (r.findings.some((f) => f.why.includes('禽鸟')) ? '误报：鸟飞已在紧邻下一镜' : null),
  },
  {
    name: 'V3 误报陷阱：「铜铃未响」不得触发鸟飞要求',
    mutate: (s) => { at(s, '51-06').visual = '铜铃未响，檐下一片死寂。'; return s },
    expect: (r) =>
      r.findings.some((f) => f.why.includes('禽鸟')) ? '误报：否定句被当成铃响'
      : r.engagement.bellShots !== 0 ? `铃响镜数应为 0，实为 ${r.engagement.bellShots}` : null,
  },
  {
    name: 'V3 反向陷阱：「不停地响」是程度副词，不是否定',
    mutate: (s) => { at(s, '51-06').visual = '铜铃不停地响，檐角一片喧嚣。'; return s },
    expect: (r) =>
      r.engagement.bellShots !== 1 ? `「不停」被误当否定，铃响镜数应为 1，实为 ${r.engagement.bellShots}`
      : r.findings.some((f) => f.why.includes('禽鸟')) ? null : '铃响成立却未要求鸟飞',
  },
  {
    name: 'V3 正例也须过否定：「却不见飞鸟惊起」不算满足',
    mutate: (s) => { at(s, '51-06').visual = '铜铃震响，却不见飞鸟惊起。'; return s },
    expect: (r) => (r.findings.some((f) => f.why.includes('禽鸟')) ? null : '否定的鸟飞被当成满足了规则'),
  },
  {
    name: 'V3 空间门开启（fz:gate-closed）',
    mutate: (s) => { at(s, '54-05').visual = '石门洞开，门后透出一线青光。'; return s },
    expect: (r) => (r.findings.some((f) => f.why.includes('空间门开启')) ? null : '未抓到空间门开启'),
  },
  {
    name: 'V3 误报陷阱：「空间门紧闭，未曾开启」',
    mutate: (s) => { at(s, '54-05').visual = '空间门紧闭，始终未曾开启。'; return s },
    expect: (r) => (r.findings.some((f) => f.why.includes('空间门开启')) ? '误报：否定句被当成开门' : null),
  },
  {
    name: 'V3 渡口镇持令牌未交械（rule:disarm）',
    mutate: (s) => {
      at(s, '52-05').location = 'loc:dukou-zhen'
      at(s, '52-05').props['obj:beiting-token'] = { holder: 'char:pei-zhao' }
      at(s, '52-05').visual = '裴照按着腰间长刀，踏进渡口镇的石桥。'
      return s
    },
    expect: (r) => (r.findings.some((f) => f.why.includes('交械') || f.why.includes('兵器')) ? null : '未抓到未交械'),
  },
  {
    name: 'V3 误报陷阱：渡口镇已交械',
    mutate: (s) => {
      at(s, '52-05').location = 'loc:dukou-zhen'
      at(s, '52-05').props['obj:beiting-token'] = { holder: 'char:pei-zhao' }
      at(s, '52-05').visual = '裴照解下长刀交械，空手踏进渡口镇。'
      return s
    },
    expect: (r) => (r.findings.some((f) => f.why.includes('兵器')) ? '误报：已交械仍被判违规' : null),
  },

  // ── 接触度：这条最要紧，回避必须被看见 ──
  {
    name: '接触不足：3 镜全对，但零错误不等于正确',
    mutate: () => [
      { id: '51-01', chapter: 51, cast: ['char:lin-zheng'], props: {}, appearance: {}, location: 'loc:moon-platform', visual: '林峥立于台上。', camera: '远景' },
      { id: '53-01', chapter: 53, cast: ['char:lin-zheng'], props: {}, appearance: {}, location: 'loc:moon-platform', visual: '夜色渐深。', camera: '空镜' },
      { id: '55-01', chapter: 55, cast: ['char:shen-yan'], props: { 'obj:black-key': { holder: 'char:shen-yan', used: false, intact: true } }, appearance: {}, location: 'loc:guanxing-tai', visual: '沈砚收起黑钥匙。', camera: '近景' },
    ],
    expect: (r) =>
      r.errors !== 0 ? `这份分镜表没有真违规，应 0 错误，实为 ${r.errors}：${r.findings.map((f) => f.why).join('｜')}`
      : r.engagementOk ? '接触度应判不达标——少画镜头刷零错误必须被看见'
      : null,
  },

  // ── 归一化层：接口不该刁难模型 ──
  {
    name: '归一化：props 直接给持有者字符串、ID 掉前缀，均应收下',
    mutate: (s) => {
      at(s, '51-04').props['obj:black-key'] = 'lin-zheng'
      at(s, '52-04').props = { 'black-key': { holder: 'lin-zheng', used: false, intact: true } }
      at(s, '52-02').cast = ['lin-zheng', 'bai-yao']
      return s
    },
    expect: (r) => (r.errors === 0 ? null : `归一化后不应有错误，实为 ${r.errors}：${r.findings.map((f) => f.why).join('｜')}`),
  },

  // ── V4 单列，不进主分 ──
  {
    name: 'V4 画面泄漏：林峥对白遥做出识破的表演指示',
    mutate: (s) => { at(s, '53-02').visual = '林峥转头盯住白遥，眼中已有了然之色。'; return s },
    expect: (r) =>
      !r.leakFindings.length ? '未抓到知识泄漏'
      : r.errors !== 0 ? `V4 不得并入主分，主分应仍为 0，实为 ${r.errors}` : null,
  },
]

// ── 跑 ──
let failed = 0
console.log('# W3-V 判分器自测\n')
for (const c of CASES) {
  const shots = c.mutate(clone())
  const r = scoreW3V({ arm: 'selftest', shots }, task)
  const problem = c.expect(r)
  if (problem) {
    failed++
    console.log(`  ✗ ${c.name}\n      ${problem}`)
  } else {
    console.log(`  ✓ ${c.name}`)
  }
}

console.log(`\n${CASES.length - failed}/${CASES.length} 通过`)
if (failed) {
  console.log('\n判分器自测未全绿——在修好之前，这套考题跑出来的任何数字都不作数。')
  process.exit(1)
}
