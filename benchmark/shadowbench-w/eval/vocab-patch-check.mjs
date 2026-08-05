// 词表补丁的离线验证——**不改 ced.mjs**（实验在跑，改它会当场改 judgeHash）。
//
// Run #23 测出六条规则合计只认得 13/40 种写法。补词表是显然的修法，但补词表**极易造出误报**：
// 「左手边推开门」不是左手动作，「铜铃旁他摇了摇头」不是铃响，「不用黑钥匙」不是使用。
// 所以每加一个词，这里都配一条对应的陷阱，先在离线跑到「真违规全中 + 陷阱全静默」，
// 再在实验结束后一次性替换进 ced.mjs 并全量 rescore。
//
//   node eval/vocab-patch-check.mjs

import { fileURLToPath } from 'node:url'
import { RULES } from './ced.mjs'
import { loadSpec, replay } from './replay.mjs'

const spec = loadSpec()
const { state } = replay(spec, 50)
const USED = { ...state, 'obj:black-key': { ...state['obj:black-key'], used: true } }

const sentences = (t) => t.split(/(?<=[。！？…\n])/).filter((s) => s.trim())

// ── 提议的新模式 ────────────────────────────────────────────────────────
const P = {
  // 时辰词补：中午/正晌/日正当中/艳阳高照/白日/大白天
  NOON: /正午|午时|日中|晌午|烈日当空|中午|正晌|日正当中|艳阳高照|白日|大白天|日头正/,
  // 开门词补：打开/敞开/大开/启动；并补上「动词在前、门在后」的语序。
  // 关键约束：被开的必须是**门**，不能是月台上的任何东西——否则「在月台上打开木匣」会误报。
  OPEN_GATE:
    /(空间门|月台[^。！？]{0,6}门|那道门|石门)[^。！？]{0,14}(开启|开了|洞开|启开|打开|敞开|大开|启动|推开)|(开启|推开|打开|敞开|大开|启动)[^。！？]{0,8}(空间门|月台[^。！？]{0,6}门|那道门|石门)/,
  // 左手动作补：举/端/捧/攥/拎/撑/执/搭/拽/托/夹/扣。
  // 「左手边」是方位词不是手，必须排除。
  LEFT_HAND_ACT:
    /左手(?!边)[^。！？]{0,12}(?<![不未没无莫勿])(持|握|挥|提|抬|按|抓|接过|拔|扬|举|端|捧|攥|拎|撑|执|搭|拽|托|夹|扣)/,
  // 用钥匙：补同义动词，并补「动词在前」的语序。不收单字「用」——「不用/没用/用不上」全是坑。
  //
  // 否定前视一度写成 `(?<![不未没])`，只看动词前**一个字**——而「没**有**使用」的前一个字是「有」，
  // 当场造出误报。改成变长前视，覆盖否定词与动词之间隔几个字的情形。
  KEY_USE:
    /黑?钥匙[^。！？]{0,15}(插入|转动|使用|用了|开了|启动|催动|嵌入|按进|送入|划过|启门)|(?<!(?:不|没|未|无|莫|勿)[^。！？]{0,3})(使用|催动|插入|转动|启动|嵌入)[^。！？]{0,6}黑?钥匙/,
  // 保管链补句式：归/由 + 收着/揣着/拿着/保管/存着/藏着
  custody: (name) =>
    new RegExp(
      `钥匙[^。！？]{0,8}(在|归|由)${name}|` +
        `${name}[^。！？]{0,6}(手(中|里|上)|收着|揣着|拿着|保管|存着|藏着)[^。！？]{0,8}钥匙|` +
        `钥匙[^。！？]{0,8}(归|由)[^。！？]{0,4}${name}`
    ),
  // 铃响补：震/颤/叮当/清响；「摇」只收「铃…摇」紧邻形式，否则「铜铃旁他摇了摇头」会误报。
  //
  // 「铃声」「铃音」**本身就是响过的证据**——不必再要求后面跟发声动词，
  // 否则「铃声骤起」这种最常见的写法反而漏掉（第一版就漏了它）。
  // 否定与回忆两道闸门在外层照旧拦，「从未听过那铃声」不会误判。
  BELL: /铃声|铃音|(铜铃|铃铛)[^。！？]{0,8}(响|鸣|作声|震|颤|叮当|清响)|铜铃(轻)?摇/,
  // 死亡词补：死前/死后/之死/死讯/临死/遇害/丧命/亡故/殉
  DEATH: /(死了|已死|身死|死在|气绝|殒命|毙命|断气|尸|死前|死后|之死|死讯|临死|遇害|丧命|亡故|殉)/,
}

const NEG_BELL = /(不|没|未|无)[^。！？]{0,3}(响|鸣|闻|见|听)|寂然|默然/
const BELL_NOT_NOW = /记得|想起|回想|响过|那年|那夜|第[一二三四五六七八九十]+夜|丙戌|案|卷宗|册|记载|听说|据说|问谁|若|如果|倘/
const DEATH_COMPOUND = /(闩|锁|关|钉|堵|封|掩|咬|盯|死死)死|死守|拼死|怕死|该死|生死|死活|要死|死心/
const CUSTODY_NOT_NOW = /当初|当年|那时|彼时|曾|原(先|本|以为)|旧话|从前|早先|昔/

// 提议实现（与 ced.mjs 的结构一一对应）。导出供影响面评估复用——
// 「补丁要不要连 A3 一起重跑」不该靠猜，要拿已存盘的正文量出来（见 eval/patch-impact.mjs）。
export const PROPOSED = {
  'rule:gate-time': (t) => sentences(t).some((s) => P.OPEN_GATE.test(s) && P.NOON.test(s)),
  'rule:left-hand': (t, st) =>
    !!st['char:bai-yao']?.left_hand_injured && sentences(t).some((s) => s.includes('白遥') && P.LEFT_HAND_ACT.test(s)),
  'rule:key-once': (t, st) => {
    let seen = 0
    for (const s of sentences(t)) if (P.KEY_USE.test(s)) { seen++; if (st['obj:black-key']?.used || seen > 1) return true }
    return false
  },
  'rule:custody': (t, st) => {
    const holder = st['obj:black-key']?.holder
    const legal = new Set([holder].filter(Boolean))
    for (const s of sentences(t)) {
      if (!/钥匙/.test(s) || CUSTODY_NOT_NOW.test(s)) continue
      for (const c of spec.characters) {
        if (legal.has(c.id)) continue
        if (new RegExp(`(不|未|没|非)在${c.name}|钥匙[^。！？]{0,8}(不|未|没|非)在`).test(s)) continue
        if (P.custody(c.name).test(s)) return true
      }
    }
    return false
  },
  'rule:bell-birds': (t) => {
    const ss = sentences(t)
    for (const [i, s] of ss.entries()) {
      if (!P.BELL.test(s) || NEG_BELL.test(s) || BELL_NOT_NOW.test(s)) continue
      if (/禽|鸟|雀|鸦|鹊|鸽/.test(ss.slice(Math.max(0, i - 3), i + 7).join(''))) continue
      return true
    }
    return false
  },
  'fz:zhao-qi-alive': (t) =>
    sentences(t).some((s) => {
      const m = s.match(/赵七(.{0,12})/)
      if (!m) return false
      const a = m[1]
      return P.DEATH.test(a) && !DEATH_COMPOUND.test(a) && !/[说道问答听念]/.test(a)
    }),
}

const current = (id, text, st) => RULES.find((r) => r.id === id).check({ text, state: st, stateAfter: st, spec }).length > 0

// ── 用例：Run #23 的 40 条 + 为每个新增词配的误报陷阱 ────────────────────
const S = {
  'rule:gate-time': [
    ['正午时分，林峥推开月台的空间门。', 1], ['午时三刻，空间门洞开。', 1],
    ['中午，林峥打开了空间门。', 1], ['日正当中，那道门被缓缓推开。', 1],
    ['艳阳高照，月台的门敞开着。', 1], ['白日里，空间门竟然启动了。', 1],
    ['子时将尽，林峥推开空间门。', 0], ['正午时分，林峥在月台上枯坐。', 0],
    ['正午时分，林峥在月台上打开了那只木匣。', 0, '新陷阱：开的不是门'],
    ['正午的日头下，他推开了柴房的破门。', 0, '新陷阱：不是空间门'],
  ],
  'rule:left-hand': [
    ['白遥左手持刀，逼向前来。', 1], ['白遥左手抬起，指向远处。', 1],
    ['白遥左手举着火把，照亮阶前。', 1], ['白遥左手端起茶盏，一饮而尽。', 1],
    ['白遥左手攥住那截绳索，用力一拽。', 1], ['白遥左手捧着那卷档案，递了过来。', 1],
    ['白遥左手撑住石栏，才没有摔倒。', 1], ['白遥左手拎起那只木匣。', 1],
    ['白遥左手垂在身侧，未抬。', 0], ['白遥右手持刀，左手裹着旧布。', 0],
    ['白遥从左手边推开半掩的门。', 0, '新陷阱：左手边是方位'],
    ['白遥左手边举着火把的是阿枝。', 0, '新陷阱：左手边 + 举'],
  ],
  'rule:key-once': [
    ['林峥将黑钥匙插入锁孔，用力转动。', 1, '', 1], ['他使用了黑钥匙。', 1, '', 1],
    ['林峥催动黑钥匙，门上纹路亮起。', 1, '', 1], ['他把黑钥匙嵌入石凹之中。', 1, '', 1],
    ['黑钥匙被按进那道凹槽。', 1, '', 1], ['林峥以黑钥匙启门。', 1, '', 1],
    ['他抽出黑钥匙，重重划过石面。', 1, '', 1],
    ['黑钥匙在他掌心微凉。', 0, '', 1],
    ['林峥将黑钥匙插入锁孔，用力转动。', 0, '首次使用合法'],
    ['他没有使用黑钥匙，只是握在手里。', 0, '新陷阱：否定', 1],
    ['他收起黑钥匙，转身下阶。', 0, '新陷阱：收起不是用', 1],
  ],
  'rule:custody': [
    ['钥匙在赵七手里。', 1], ['赵七手中的钥匙泛着暗芒。', 1],
    ['黑钥匙归赵七保管。', 1], ['赵七收着那枚黑钥匙。', 1],
    ['赵七揣着钥匙，一言不发。', 1], ['钥匙落在赵七那里，一直没取回。', 1],
    ['那枚钥匙由赵七拿着。', 1],
    ['钥匙不在赵七处。', 0], ['当初钥匙在赵七手里，如今已不是。', 0],
    ['钥匙在林峥手里。', 0, '新陷阱：合法持有者'],
  ],
  'rule:bell-birds': [
    ['铜铃响了三声，四下无人。', 1], ['铜铃鸣动，台上一片死寂。', 1],
    ['铃声骤起，穿过整座月台。', 1], ['那口铜铃震颤起来，嗡嗡不绝。', 1],
    ['檐下铜铃叮当作响，无人在意。', 1], ['铜铃摇了两下，声浪压过夜风。', 1],
    ['铜铃响了，远处寒鸦成片惊起。', 0], ['铜铃未响，檐下一片死寂。', 0],
    ['他想起那年铜铃响过一次。', 0],
    ['铜铃旁，他摇了摇头，什么也没说。', 0, '新陷阱：摇头不是摇铃'],
    ['他从未听过那口铜铃的铃声。', 0, '新陷阱：铃声 + 否定'],
    ['卷宗里记载，那夜的铃声惊动了整条街。', 0, '新陷阱：铃声 + 记载/回忆'],
  ],
  'fz:zhao-qi-alive': [
    ['赵七气绝在案前。', 1], ['赵七已死多时。', 1],
    ['赵七死前，把那匣墨塞进了夹层。', 1], ['赵七之死，至今无人提起。', 1],
    ['赵七的死讯传到月台时，天已黑透。', 1], ['赵七遇害的那一夜，雨下得很大。', 1],
    ['赵七死守渡口，一步未退。', 0], ['赵七拼死拦下那一刀。', 0],
    ['这一战关乎赵七生死。', 0], ['赵七怕死，所以先把话说清楚。', 0, '新陷阱：怕死'],
    ['赵七道：老陶死前把钥匙交了出来。', 0, '新陷阱：转述他人之死'],
  ],
}

// 被 import 时只导出 PROPOSED，不跑用例——否则 patch-impact.mjs 一 import 就先刷一屏测试输出
if (process.argv[1] !== fileURLToPath(import.meta.url)) {
  // 作为模块加载：什么都不做
} else {
let cM = 0, cF = 0, pM = 0, pF = 0, total = 0
for (const [id, cases] of Object.entries(S)) {
  const rows = cases.map(([text, want, note = '', used = 0]) => {
    const st = used ? USED : state
    return { text, want: !!want, note, cur: current(id, text, st), pro: PROPOSED[id](text, st) }
  })
  const real = rows.filter((r) => r.want).length, traps = rows.length - real
  const cm = rows.filter((r) => r.want && !r.cur).length, cf = rows.filter((r) => !r.want && r.cur).length
  const pm = rows.filter((r) => r.want && !r.pro).length, pf = rows.filter((r) => !r.want && r.pro).length
  cM += cm; cF += cf; pM += pm; pF += pf; total += real
  console.log(`\n=== ${id} ===`)
  console.log(`  现行：命中 ${real - cm}/${real}，误报 ${cf}/${traps}　→　提议：命中 ${real - pm}/${real}，误报 ${pf}/${traps}`)
  for (const r of rows) {
    const bad = (r.want && !r.pro) || (!r.want && r.pro)
    if (!bad && r.cur === r.pro) continue
    const f = (v) => (r.want ? (v ? '✓' : '✗漏') : v ? '✗误' : '·')
    console.log(`    ${f(r.cur)}→${f(r.pro)}  ${r.text.slice(0, 26).padEnd(28)} ${r.note}`)
  }
}
console.log(`\n${'─'.repeat(70)}`)
console.log(`  现行：真违规命中 ${total - cM}/${total}，误报 ${cF}`)
console.log(`  提议：真违规命中 ${total - pM}/${total}，误报 ${pF}`)
process.exit(pM || pF ? 1 : 0)
}
