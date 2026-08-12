#!/usr/bin/env node
// v0.1 → v0.2 迁移：把 value 从本象里搬到投影层
//
// ## 为什么要动这一刀
//
// v0.1 的 events[] 里同时装着两种东西：
//   可复核的事实      —— 说了什么（可复听）、画面上有什么（可复看）、时间码
//   某人某刻的判断     —— value: 0.95
//
// 后者不是视频的内在属性。同一个 10 秒片段，对开发者是干货、对小白是噪音；
// 今年是爆点、明年是老梗。**价值是视频与观众之间的关系，不在视频里面。**
//
// 校验器每次都诚实地报「100% 的价值判断是不可复核的断言」。
// 那不是"标注得不够努力"，是**位置放错了**——我们把一个投影写进了本象的字段里。
//
// v0.2 拆三段：
//   events[]      本象：ref / gist / gist_from / evidence / prosody —— 只放能复核的
//   audiences[]   受众与口径：谁在看、按什么标准、什么时候定的
//   appraisals[]  投影：{event × audience} → value，带 basis / by / as_of
//
// 立刻兑现的好处（v0.1 做不到的）：
//   · 同一条素材挂多套估值互不覆盖（抖音受众 vs 开发者受众）
//   · 口径过期时废掉整组 appraisal，本象不动
//   · 拿到真实数据时**新增**一条 basis=measured，旧断言不删 —— A5 要的可对比记录
//   · assertion-ratio 变成"某受众视角下的比例"，而不是一个混在一起的数字
//
// 用法: node migrate.mjs <timeline.json> [--write]

import { readFileSync, writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const file = argv.find(a => !a.startsWith('--'))
const WRITE = argv.includes('--write')
if (!file) { console.error('用法: node migrate.mjs <timeline.json> [--write]'); process.exit(2) }

const tl = JSON.parse(readFileSync(file, 'utf8'))
if (tl.$schema?.includes('v0.2')) { console.log('已经是 v0.2，无需迁移'); process.exit(0) }

// 从旧事件里把口径提出来当受众 id —— 旧数据里每条 criterion 就是一个受众的影子
const criteria = [...new Set(tl.events.map(e => e.criterion).filter(Boolean))]
if (criteria.length > 1) console.log(`⚠ 检测到 ${criteria.length} 种口径，全部各建一个受众`)

const audiences = criteria.map(c => ({
  id: c,
  who: '（迁移自 v0.1 的 criterion，未填写受众画像——请补）',
  criterion: c,
  as_of: tl.events.find(e => e.criterion === c)?.as_of ?? null,
  note: 'v0.1 里没有受众概念，口径是挂在每条 value 上的。这条是自动生成的占位。',
}))

const appraisals = []
const events = tl.events.map(e => {
  const { value, basis, criterion, by, as_of, reason, ...rest } = e
  if (value != null) {
    appraisals.push({
      event: e.id,
      audience: criterion ?? audiences[0]?.id ?? 'unknown',
      value, basis: basis ?? 'asserted', by, as_of, reason,
      // evidence 里跟"值不值钱"有关的部分留在 appraisal，跟"说了什么"有关的留在 event
    })
  }
  return rest
})

// projections 声明自己服务哪个受众
const projections = Object.fromEntries(Object.entries(tl.projections ?? {}).map(([k, p]) => [
  k, { audience: audiences[0]?.id ?? null, ...p },
]))

const out = {
  $schema: 'origin/dialect-video/v0.2',
  note: (tl.note ?? '') + ' ｜ v0.2：value 已从 events 移到 appraisals——它是投影不是本象。',
  source: tl.source,
  sampling: tl.sampling,
  world: tl.world,
  events,
  audiences,
  appraisals,
  projections,
  limits: [
    ...(tl.limits ?? []),
    {
      code: 'M-AUDIENCE-PLACEHOLDER', kind: 'uncovered', scope: 'audiences[*]',
      statement: `受众是从 v0.1 的 criterion 字段自动生成的占位（${audiences.map(a => a.id).join(' / ')}），`
        + '没有真实的受众画像：不知道他们是谁、多大、为什么看、什么会让他们划走。'
        + '所有 appraisal 都挂在这些占位受众上。',
      remedy: '为每个受众补 who 字段；或直接用真实投放数据反推受众分群',
    },
  ],
}

console.log(`events ${tl.events.length} → 事实 ${events.length} 条 + 估值 ${appraisals.length} 条`)
console.log(`受众 ${audiences.length} 个：${audiences.map(a => a.id).join(', ')}`)
const byBasis = {}
for (const a of appraisals) byBasis[a.basis] = (byBasis[a.basis] ?? 0) + 1
console.log(`估值 basis 分布：${Object.entries(byBasis).map(([k, v]) => `${k}=${v}`).join(' ')}`)

if (WRITE) { writeFileSync(file, JSON.stringify(out, null, 2)); console.log(`已写回 ${file}`) }
else console.log('加 --write 写回。')
