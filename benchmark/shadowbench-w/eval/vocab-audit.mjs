// 确定性规则的词表覆盖审计——只读导入 RULES，不改 ced.mjs（实验在跑，改它会当场改 judgeHash）。
//
// 方法与 Run #21 抓 fz:zhao-qi-alive 同型：对每条规则构造「同一违规的不同写法」，
// 看规则认不认得。漏报与「事件没发生」在分数上完全同形，只能靠这种主动探测暴露。
//
//   node eval/vocab-audit.mjs

import { RULES } from './ced.mjs'
import { loadSpec, replay } from './replay.mjs'

const spec = loadSpec()
const { state } = replay(spec, 50)
const stateAfter = state

const run = (id, text, over = null) => {
  const r = RULES.find((x) => x.id === id)
  const st = over ? { ...state, ...over } : state
  return r.check({ text, state: st, stateAfter: st, spec }).length > 0
}

// rule:key-once 的语义是「只能用一次」——**第一次使用是合法的**（`if (used || seen > 1)`）。
// 所以要探它的词表，必须让状态里 used 已为 true，或让同一段出现两次使用。
// 第一版审计给的全是单次使用，跑出 0/6，差点被我当成「规则从不响」写进日志。
const USED = { 'obj:black-key': { ...state['obj:black-key'], used: true } }

// [写法, 是否真违规, 备注, 是否用 used=true 状态]
// 导出供 selftest.mjs 固化——补完词表若无回归夹具，下一次「顺手改个正则」就会悄悄退回去。
export const SUITES = {
  'rule:gate-time': [
    ['正午时分，林峥推开月台的空间门。', true, '基准写法（现有词表能抓）'],
    ['午时三刻，空间门洞开。', true, '基准写法'],
    ['中午，林峥打开了空间门。', true, '「中午」+「打开」'],
    ['日正当中，那道空间门被缓缓推开。', true, '「日正当中」'],
    ['艳阳高照，月台的门敞开着。', true, '「艳阳高照」+「敞开」'],
    ['白日里，空间门竟然启动了。', true, '「白日」+「启动」'],
    ['子时将尽，林峥推开空间门。', false, '合规：子时属月落之后'],
    ['正午时分，林峥在月台上枯坐。', false, '合规：没开门'],
    ['正午时分，林峥在月台上打开了那只木匣。', false, '陷阱：开的不是门（旧式在此误报）'],
    ['正午的日头下，他推开了柴房的破门。', false, '陷阱：不是空间门'],
  ],
  'rule:left-hand': [
    ['白遥左手持刀，逼向前来。', true, '基准写法'],
    ['白遥左手抬起，指向远处。', true, '基准写法'],
    ['白遥左手举着火把，照亮阶前。', true, '「举」'],
    ['白遥左手端起茶盏，一饮而尽。', true, '「端」'],
    ['白遥左手攥住那截绳索，用力一拽。', true, '「攥」'],
    ['白遥左手捧着那卷archive，递了过来。', true, '「捧」'],
    ['白遥左手撑住石栏，才没有摔倒。', true, '「撑」'],
    ['白遥左手拎起那只木匣。', true, '「拎」'],
    ['白遥左手垂在身侧，未抬。', false, '误报陷阱：否定'],
    ['白遥右手持刀，左手裹着旧布。', false, '合规：右手动作'],
    ['白遥从左手边推开半掩的门。', false, '陷阱：左手边是方位词'],
    ['白遥左手边举着火把的是阿枝。', false, '陷阱：左手边 + 举'],
  ],
  // 全部在 used=true 的状态下测——此时任何一次使用都是违规
  'rule:key-once': [
    ['林峥将黑钥匙插入锁孔，用力转动。', true, '基准写法', USED],
    ['他使用了黑钥匙。', true, '基准写法', USED],
    ['林峥催动黑钥匙，门上纹路亮起。', true, '「催动」', USED],
    ['他把黑钥匙嵌入石凹之中。', true, '「嵌入」', USED],
    ['黑钥匙被按进那道凹槽。', true, '「按进」', USED],
    ['林峥以黑钥匙启门。', true, '「启门」', USED],
    ['他抽出黑钥匙，重重划过石面。', true, '「划过」', USED],
    ['黑钥匙在他掌心微凉。', false, '合规：只是拿着', USED],
    ['林峥将黑钥匙插入锁孔，用力转动。', false, '合规：首次使用（used=false）'],
    ['他没有使用黑钥匙，只是握在手里。', false, '陷阱：否定（定长前视挡不住「没有」）', USED],
    ['他收起黑钥匙，转身下阶。', false, '陷阱：收起不是使用', USED],
  ],
  'rule:custody': [
    ['钥匙在赵七手里。', true, '基准写法'],
    ['赵七手中的钥匙泛着暗芒。', true, '基准写法'],
    ['黑钥匙归赵七保管。', true, '「归…保管」'],
    ['赵七收着那枚黑钥匙。', true, '「收着」'],
    ['赵七揣着钥匙，一言不发。', true, '「揣着」'],
    ['钥匙落在赵七那里，一直没取回。', true, '「落在…那里」'],
    ['那枚钥匙由赵七拿着。', true, '「由…拿着」'],
    ['钥匙不在赵七处。', false, '误报陷阱：否定归属'],
    ['当初钥匙在赵七手里，如今已不是。', false, '误报陷阱：回指旧事'],
    ['钥匙在林峥手里。', false, '陷阱：合法持有者'],
  ],
  'rule:bell-birds': [
    ['铜铃响了三声，四下无人。', true, '基准写法'],
    ['铜铃鸣动，台上一片死寂。', true, '基准写法'],
    ['铃声骤起，穿过整座月台。', true, '「铃声」不带「铜」'],
    ['那口铜铃震颤起来，嗡嗡不绝。', true, '「震颤」'],
    ['檐下铜铃叮当作响，无人在意。', true, '「叮当」'],
    ['铜铃摇了两下，声浪压过夜风。', true, '「摇」'],
    ['铜铃响了，远处寒鸦成片惊起。', false, '合规：有禽鸟'],
    ['铜铃未响，檐下一片死寂。', false, '误报陷阱：否定'],
    ['他想起那年铜铃响过一次。', false, '误报陷阱：回忆'],
    ['铜铃旁，他摇了摇头，什么也没说。', false, '陷阱：摇头不是摇铃'],
    ['他从未听过那口铜铃的铃声。', false, '陷阱：铃声 + 否定'],
    ['卷宗里记载，那夜的铃声惊动了整条街。', false, '陷阱：铃声 + 记载'],
  ],
  'fz:zhao-qi-alive': [
    ['赵七气绝在案前。', true, '基准写法'],
    ['赵七已死多时。', true, '基准写法'],
    ['赵七死前，把那匣墨塞进了夹层。', true, 'Run #21 实测漏报的写法'],
    ['赵七之死，至今无人提起。', true, '「之死」'],
    ['赵七的死讯传到月台时，天已黑透。', true, '「死讯」'],
    ['赵七遇害的那一夜，雨下得很大。', true, '「遇害」'],
    ['赵七死守渡口，一步未退。', false, '误报陷阱：死守'],
    ['赵七拼死拦下那一刀。', false, '误报陷阱：拼死'],
    ['这一战关乎赵七生死。', false, '误报陷阱：生死是名词'],
    ['赵七怕死，所以先把话说清楚。', false, '陷阱：怕死'],
    ['赵七道：老陶死前把钥匙交了出来。', false, '陷阱：转述他人之死'],
  ],
}

export const USED_STATE = USED
export const checkCase = run

// 被 import 时只导出夹具，不刷屏
if (process.argv[1] && process.argv[1].endsWith('vocab-audit.mjs')) {
let totalMiss = 0, totalFalse = 0
for (const [id, cases] of Object.entries(SUITES)) {
  const rows = cases.map(([text, want, note, over]) => ({ text, want, note, got: run(id, text, over) }))
  const miss = rows.filter((r) => r.want && !r.got)
  const fp = rows.filter((r) => !r.want && r.got)
  totalMiss += miss.length
  totalFalse += fp.length
  const real = rows.filter((r) => r.want).length
  console.log(`\n=== ${id} ===  真违规 ${real - miss.length}/${real} 命中｜误报陷阱 ${rows.filter((r) => !r.want).length - fp.length}/${rows.filter((r) => !r.want).length} 静默`)
  for (const r of rows) {
    const mark = r.want ? (r.got ? '  ✓' : '  ✗漏报') : r.got ? '  ✗误报' : '  ·'
    if (mark === '  ·') continue // 静默正确的陷阱不刷屏
    console.log(`${mark.padEnd(8)} ${r.text.slice(0, 30).padEnd(32)} ${r.note}`)
  }
}

console.log(`\n${'─'.repeat(70)}`)
console.log(`合计：漏报 ${totalMiss} 条，误报 ${totalFalse} 条`)
}
