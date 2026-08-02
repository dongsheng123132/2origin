#!/usr/bin/env node
// 把 S 级世界（10 章）扩到 M-lite（50 章），用于检验「状态优势是否随历史长度增长」。
//
// 设计约束（决定了这次扩写有没有实验价值）：
//   ① 变量只有历史长度——续写任务的形状与 S 级同构（转交关键物品 + 守住秘密 + 保人不死），
//      这样 M 与 S 的结果才可比。
//   ② 状态变更必须**分散在全程**。若把变更都堆在末尾，长历史就成了摆设，
//      裸模型只看结尾也能答对，实验测不出任何东西。
//   ③ 秘密的知情范围要**逐步扩大但始终不含主角**——这是跨长度累积的核心考点：
//      读到第 50 章时，「谁知道白遥的事」已经是一份必须靠累积才能答对的名单。
//   ④ 伏笔要有埋有收：收掉一部分制造真实感，留一部分作为续写期的禁区。
//
//   node tools/extend-world.mjs --dry    只打印，不写
//   node tools/extend-world.mjs          写入 spec.origin

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SPEC = join(dirname(dirname(fileURLToPath(import.meta.url))), 'world', 'spec.origin')
const dry = process.argv.includes('--dry')
const readJsonl = (f) => readFileSync(join(SPEC, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const writeJsonl = (f, rows) => !dry && writeFileSync(join(SPEC, f), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')

// ── 第 11-50 章的剧情骨架 ──────────────────────────────────────────────
// 每拍：章号、标题、视角、梗概、事件、状态变更（可空）、伏笔动作
const BEATS = [
  { ch: 11, t: '换手', pov: 'char:lin-zheng', s: '林峥再访茶肆，赵七终于松口，黑钥匙易主', ev: '赵七将黑钥匙交与林峥，只提一个条件：不得在渡口镇动用', chg: [{ o: 'obj:black-key', f: 'holder', from: 'char:zhao-qi', to: 'char:lin-zheng' }] },
  { ch: 12, t: '北风', pov: 'char:pei-zhao', s: '裴照察觉钥匙已动，令白遥探明去向', ev: '裴照得知黑钥匙易主，责令白遥查清落在何人手中', chg: [] },
  { ch: 13, t: '灯下问', pov: 'char:bai-yao', s: '白遥试探林峥，未得实情', ev: '白遥旁敲侧击询问钥匙，林峥不答', chg: [] },
  { ch: 14, t: 'archive', pov: 'char:yun-gu', s: '云姑翻出旧档，铜铃与黑钥匙同源', ev: '云姑在旧档中发现铜铃与黑钥匙出自同一炉', chg: [{ o: 'char:yun-gu', f: 'knows', op: 'append', to: 'k:bell-key-same-origin' }], hook: { resolve: 'hook:yun-gu-silence' } },
  { ch: 15, t: '雪前', pov: 'char:a-zhi', s: '阿枝欲言又止，终未说出所见', ev: '阿枝几次想告诉林峥所见，临口又咽下', chg: [] },
  { ch: 16, t: '断信', pov: 'char:shen-yan', s: '沈砚查到失信曾经手三人', ev: '沈砚查明失信曾经三人之手，范围缩小', chg: [{ o: 'char:shen-yan', f: 'suspect_pool', from: null, to: 3 }] },
  { ch: 17, t: '夜访', pov: 'char:zhao-qi', s: '赵七被北庭人盯上', ev: '赵七察觉有人跟踪，闭门数日', chg: [{ o: 'char:zhao-qi', f: 'location', from: 'loc:dukou-teahouse', to: 'loc:dukou-zhen' }] },
  { ch: 18, t: '手谈', pov: 'char:lin-zheng', s: '林峥与沈砚论及台中内应，未疑白遥', ev: '沈砚向林峥透露台中有内应，林峥全然想不到白遥', chg: [{ o: 'char:lin-zheng', f: 'knows', op: 'append', to: 'k:mole-exists' }] },
  { ch: 19, t: '旧炉', pov: 'char:lao-tao', s: '老陶说出铜铃是他师父所铸', ev: '老陶向阿枝提起铜铃出自其师之手', chg: [{ o: 'char:a-zhi', f: 'knows', op: 'append', to: 'k:bell-maker' }], hook: { resolve: 'hook:bronze-bell' } },
  { ch: 20, t: '第一场雪', pov: 'char:bai-yao', s: '白遥左手伤处在寒夜复发', ev: '白遥左手旧伤在寒夜复发，愈发不得使力', chg: [] },
  { ch: 21, t: '密令', pov: 'char:pei-zhao', s: '北庭下令月落之夜取门', ev: '裴照接北庭令：月落之夜取空间门', chg: [{ o: 'char:pei-zhao', f: 'knows', op: 'append', to: 'k:gate-raid-planned' }] },
  { ch: 22, t: '两难', pov: 'char:bai-yao', s: '白遥迟报军情，第一次动摇', ev: '白遥压下一封该发的密报', chg: [{ o: 'char:bai-yao', f: 'wavering', from: false, to: true }] },
  { ch: 23, t: '查档', pov: 'char:yun-gu', s: '云姑把同源之事告知沈砚', ev: '云姑将铜铃与钥匙同源一事告知沈砚', chg: [{ o: 'char:shen-yan', f: 'knows', op: 'append', to: 'k:bell-key-same-origin' }] },
  { ch: 24, t: '试锋', pov: 'char:lin-zheng', s: '林峥携钥匙赴月台勘察，未开门', ev: '林峥独往月台勘察，谨守不开门之戒', chg: [{ o: 'char:lin-zheng', f: 'location', from: 'loc:dukou-zhen', to: 'loc:moon-platform' }] },
  { ch: 25, t: '影从', pov: 'char:a-zhi', s: '阿枝尾随，撞见北庭斥候', ev: '阿枝在月台外撞见北庭斥候', chg: [{ o: 'char:a-zhi', f: 'knows', op: 'append', to: 'k:beiting-scouting-gate' }] },
  { ch: 26, t: '回台', pov: 'char:lin-zheng', s: '林峥归台，向沈砚缴钥', ev: '林峥归观星台，将黑钥匙交沈砚保管', chg: [{ o: 'obj:black-key', f: 'holder', from: 'char:lin-zheng', to: 'char:shen-yan' }, { o: 'char:lin-zheng', f: 'location', from: 'loc:moon-platform', to: 'loc:guanxing-tai' }] },
  { ch: 27, t: '缄口', pov: 'char:a-zhi', s: '阿枝把北庭斥候之事告诉赵七，仍未提白遥', ev: '阿枝将斥候之事告知赵七，独独隐去白遥', chg: [{ o: 'char:zhao-qi', f: 'knows', op: 'append', to: 'k:beiting-scouting-gate' }] },
  { ch: 28, t: '夜半灯', pov: 'char:shen-yan', s: '沈砚将钥匙藏入档阁暗格', ev: '沈砚把黑钥匙藏进档阁暗格，只告知云姑', chg: [{ o: 'char:yun-gu', f: 'knows', op: 'append', to: 'k:key-hidden-in-archive' }] },
  { ch: 29, t: '风声', pov: 'char:bai-yao', s: '白遥探得钥匙已入台，未探得具体所在', ev: '白遥探知钥匙已回观星台，但不知藏处', chg: [{ o: 'char:bai-yao', f: 'knows', op: 'append', to: 'k:key-back-in-tai' }] },
  { ch: 30, t: '半程', pov: 'char:lin-zheng', s: '林峥重理铜铃旧案，线索指向档阁', ev: '林峥查铜铃旧案，线索指向档阁', chg: [] },
  { ch: 31, t: '对坐', pov: 'char:shen-yan', s: '沈砚与白遥长谈，仍未起疑', ev: '沈砚与白遥长谈台务，未生疑心', chg: [] },
  { ch: 32, t: '铃再响', pov: 'char:a-zhi', s: '铜铃第二次夜响，禽鸟尽飞', ev: '铜铃第二次于夜半鸣响，方圆十里禽鸟尽飞', chg: [], hook: { create: 'hook:second-bell' } },
  { ch: 33, t: '循声', pov: 'char:lin-zheng', s: '林峥循铃声至档阁外，无所获', ev: '林峥循铃声寻至档阁外墙，未得其门', chg: [] },
  { ch: 34, t: '旧约', pov: 'char:pei-zhao', s: '裴照催白遥交出钥匙下落', ev: '裴照限白遥十日内交出钥匙藏处', chg: [] },
  { ch: 35, t: '断腕', pov: 'char:bai-yao', s: '白遥托病避见裴照', ev: '白遥托称左手伤重，避而不见裴照', chg: [{ o: 'char:bai-yao', f: 'wavering', from: true, to: true }] },
  { ch: 36, t: '门外雪', pov: 'char:zhao-qi', s: '赵七将斥候之事托人带信入台', ev: '赵七托人带信入观星台，示警北庭动向', chg: [{ o: 'char:shen-yan', f: 'knows', op: 'append', to: 'k:beiting-scouting-gate' }] },
  { ch: 37, t: '备门', pov: 'char:shen-yan', s: '沈砚部署月台守备', ev: '沈砚调人手加固月台守备', chg: [] },
  { ch: 38, t: '同炉', pov: 'char:yun-gu', s: '云姑查明铜铃可召钥匙', ev: '云姑查出铜铃鸣时黑钥匙会共鸣', chg: [{ o: 'char:yun-gu', f: 'knows', op: 'append', to: 'k:bell-summons-key' }] },
  { ch: 39, t: '走水', pov: 'char:lin-zheng', s: '档阁失火，钥匙无恙', ev: '档阁夜半走水，黑钥匙未损', chg: [] },
  { ch: 40, t: '灰中字', pov: 'char:shen-yan', s: '沈砚在灰烬里找到失信残页', ev: '沈砚于火场灰烬中拾得失信残页', chg: [{ o: 'obj:missing-letter', f: 'location', from: 'unknown', to: 'loc:guanxing-tai' }], hook: { resolve: 'hook:missing-letter' } },
  { ch: 41, t: '残笔', pov: 'char:shen-yan', s: '残页笔迹与台中某人相合，未指名', ev: '残页笔迹与台中人相合，沈砚不动声色', chg: [{ o: 'char:shen-yan', f: 'suspect_pool', from: 3, to: 2 }] },
  { ch: 42, t: '默数', pov: 'char:bai-yao', s: '白遥知残页现世，坐立不安', ev: '白遥得知残页现世，寝食难安', chg: [{ o: 'char:bai-yao', f: 'knows', op: 'append', to: 'k:letter-found' }] },
  { ch: 43, t: '雪深', pov: 'char:a-zhi', s: '阿枝终于把所见告诉云姑，云姑按下不表', ev: '阿枝把撞见白遥与裴照之事告诉云姑，云姑嘱其暂勿声张', chg: [{ o: 'char:yun-gu', f: 'knows', op: 'append', to: 'k:bai-yao-meets-pei-zhao' }], hook: { resolve: 'hook:a-zhi-witness' } },
  { ch: 44, t: '两条线', pov: 'char:yun-gu', s: '云姑独自比对残页与白遥笔迹', ev: '云姑私下比对残页与白遥手书，未告他人', chg: [{ o: 'char:yun-gu', f: 'suspects_bai_yao', from: false, to: true }] },
  { ch: 45, t: '月将落', pov: 'char:pei-zhao', s: '北庭定下取门之日', ev: '裴照定下三日后月落取门', chg: [] },
  { ch: 46, t: '最后一问', pov: 'char:lin-zheng', s: '林峥问白遥近日为何避人，白遥搪塞过去', ev: '林峥问及白遥近日反常，被搪塞过去', chg: [] },
  { ch: 47, t: '交底', pov: 'char:yun-gu', s: '云姑把疑虑告诉沈砚，二人商定不惊动林峥', ev: '云姑向沈砚说出疑虑，二人议定暂不告知林峥', chg: [{ o: 'char:shen-yan', f: 'suspects_bai_yao', from: false, to: true }] },
  { ch: 48, t: '铃三响', pov: 'char:a-zhi', s: '铜铃第三次响，档阁暗格中钥匙共鸣', ev: '铜铃第三次鸣响，档阁暗格里的黑钥匙随之共鸣', chg: [], hook: { resolve: 'hook:second-bell' } },
  { ch: 49, t: '取钥', pov: 'char:shen-yan', s: '沈砚取出钥匙，交回林峥', ev: '沈砚自暗格取出黑钥匙，重新交与林峥', chg: [{ o: 'obj:black-key', f: 'holder', from: 'char:shen-yan', to: 'char:lin-zheng' }] },
  { ch: 50, t: '月落前夜', pov: 'char:lin-zheng', s: '林峥守在月台，等月落', ev: '林峥携钥守于月台，静待月落', chg: [{ o: 'char:lin-zheng', f: 'location', from: 'loc:guanxing-tai', to: 'loc:moon-platform' }] },
]

// ── 生成 ────────────────────────────────────────────────────────────
const events = readJsonl('timeline/events.jsonl')
const changes = readJsonl('timeline/state-changes.jsonl')
const outline = readJsonl('chapters/outline.jsonl')
const hooks = readJsonl('narrative/foreshadowing.jsonl')

let evSeq = Math.max(...events.map((e) => e.seq))
let chSeq = Math.max(...changes.map((c) => c.seq))

for (const b of BEATS) {
  const evId = `ev:${String(b.ch).padStart(3, '0')}`
  events.push({ seq: ++evSeq, chapter: b.ch, id: evId, summary: b.ev, participants: [b.pov], location: null })

  const chgSeqs = []
  for (const c of b.chg ?? []) {
    const rec = { seq: ++chSeq, chapter: b.ch, object: c.o, field: c.f, valid_from: evId, evidence: `scene:${String(b.ch).padStart(2, '0')}-02` }
    if (c.op) rec.op = c.op
    else if ('from' in c) rec.from = c.from
    rec.to = c.to
    changes.push(rec)
    chgSeqs.push(rec.seq)
  }

  outline.push({ chapter: b.ch, title: b.t, words: 2000, events: [evId], allowed_state_changes: chgSeqs, pov: b.pov, summary: b.s })

  if (b.hook?.resolve) {
    const h = hooks.find((x) => x.id === b.hook.resolve)
    if (h) { h.status = 'resolved'; h.payoff = { chapter: b.ch, event: evId } }
  }
  if (b.hook?.create) {
    hooks.push({ id: b.hook.create, summary: `铜铃第二次夜响，与黑钥匙共鸣之谜`, setup: { chapter: b.ch, event: evId }, status: 'planted_unresolved', tier: 'main' })
  }
}

writeJsonl('timeline/events.jsonl', events)
writeJsonl('timeline/state-changes.jsonl', changes)
writeJsonl('chapters/outline.jsonl', outline)
writeJsonl('narrative/foreshadowing.jsonl', hooks)

console.log(`${dry ? '[dry] ' : ''}扩写完成：`)
console.log(`  章节 ${outline.length}（原 10，新增 ${BEATS.length}）`)
console.log(`  事件 ${events.length}，状态变更 ${changes.length}`)
console.log(`  伏笔 ${hooks.length}：已收 ${hooks.filter((h) => h.status === 'resolved').length}，未收 ${hooks.filter((h) => h.status !== 'resolved').length}`)
const changed = new Set(changes.map((c) => c.chapter))
console.log(`  含状态变更的章节：${[...changed].length} 章，分布于第 ${Math.min(...changed)}–${Math.max(...changed)} 章`)
