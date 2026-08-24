// learning-core.mjs — 学堂协议 v0.1：经验的产生、升降级与读取
//
// 为什么现在才写：`learnings` 这个字段从第一天就在 schema 里，也被本境的缩水守卫
// 保护着（B11.3b / B12.1），但**全仓库没有一行代码写过或读过它**，10 份学历累计 0 条。
// 那正是本仓库已经命名过的病：「一份纯装饰的 schema——它让人以为格式被约束着，
// 而现实里没有」。字段在、守卫在、机制不在，等于没有。
//
// 设计只有一条主心骨，来自本仓库已经付过学费的那个对称：
//
//     fact 的 source 必须引用**可复核物**（recheckSource）
//     → 那么 learning 的 recheck 必须是**可重跑的动作**
//
// 由此推出五条规则，每条都对应一次实测教训，不是设计美学：
//
//   R1 没有可重跑检验的经验，最高只能是 candidate。
//      「未验证的话不配叫 fact，叫假设」——经验同理，而且经验比事实更容易自我感动。
//   R2 升级只能由考试给，作者不能给自己发证。
//      写入时 status 只允许 candidate / deprecated；verified 只能由 exam 在 recheck
//      通过后写。这是「决策权与判断依据分离」在学堂层的落地。
//   R3 一次成功不是永久真理：verified 的经验每次考试都要重跑，跑挂了当场降级。
//   R4 考试必须记账：pass / fail / error 逐条落盘，且降级要说明是哪次考试降的。
//   R5 只有 verified 才会被北桥注入上下文；candidate 不进。
//      让未验证的经验进上下文，等于把假设当经验用——比不写更糟。
//   R6 经验要有血缘：`derived_from` 记它是从哪几条经验蒸馏来的（空 = 一手）。
//   R7 一条经验倒了，它的后代**撤回信任**（verified → candidate + taint），不是判它们错。
//
// ── R6/R7 是 v0.2 加的，来自外部文献而不是我们自己的事故 ──────────────
// arXiv:2608.05810（Terminal-Bench 2）实测：自演化技能池过了临界规模，新技能反而
// 降低性能；原因是结构性的——**有缺陷的技能一旦进入决策上下文，就成为后续技能蒸馏
// 的参考材料**，形成跨轮污染链。而且**不可逆**：事后删掉源技能，抹不掉其后代已经
// 继承的错误推理，post-hoc rollback 只恢复一小部分损失。
//
// 盘点我们自己：133 条经验，字段只有 author/confidence/exam/id/lesson/origin/recheck/status，
// `origin` 只记 {task, when}。**没有一个字段记「这条从哪几条来」**——所以污染真发生时，
// 我们连"哪些后代被波及"都算不出来。这不是"还没做"，是"做不了"。
//
// 我们的答案刻意**不是**"能撤销"（那篇论文已经量过撤销没用），而是：
//   ① 让污染范围**可计算**（血缘 + 传递闭包）
//   ② 祖先倒下时，后代**不再以 verified 的名分进上下文**（打 taint，撤回信任）
//   ③ **只有重新考过才能洗掉 taint**——手写清除会被写入闸门压回
// 「撤回信任」比「判它错」弱，也比「什么都不做」强。污染 ≠ 一定错，但污染之后
// 那条经验凭什么还算已验证，说不出来了——说不出来就不该进上下文。
//
// 这个文件只做纯逻辑（判断、升降级、聚合），**不碰磁盘写**：落盘一律走本境
// benjing-put 的乐观锁。学堂自己开一条写路径，就是 task5 那次学历被吃掉的复刻。

import { createHash } from 'node:crypto';

export const SPEC = 'xuetang/0.1';

/** 经验 id：由 lesson 正文决定，跨学历同一条经验得到同一个 id（用于去重与考试记账） */
export function learningId(lesson) {
  return 'L-' + createHash('sha256').update(String(lesson || '').trim()).digest('hex').slice(0, 12);
}

// 可重跑动作的首词白名单。刻意与本境 recheckSource 的 cmdRe 保持同一套词，
// 因为它们回答的是同一个问题：「这句话能不能被别人独立跑一遍」。
// 不做 shell 解释、不允许管道与重定向——考试跑的是命令，不是脚本。
// 这里没有 bash，两个独立理由：
//   ① 判据 X7.3 要求「学堂能跑的，本境必须也认得」，而本境的 cmdRe 里没有 bash；
//   ② 更要命的是 `bash x.sh` 会把上面「跑命令不跑脚本」的保证从后门整个绕过——
//      我拦住了 run 字符串里的管道，却挡不住脚本文件里的管道。
// 想把 conformance 那种 .sh 当考题，就先给它一个 node 入口，别在这里开口子。
export const ALLOWED_CMDS = ['node', 'npm', 'npx', 'git', 'ls', 'cat', 'wc', 'tail', 'head',
                             'grep', 'find', 'curl', 'codex', 'claude', 'hermes', 'python'];

// 本境 recheckSource 认、而学堂**故意不认**的命令，连同理由。
// 两者回答的问题看着一样，其实差一个动词：本境只是**认出**一句话里提到了命令
// （它从不执行），学堂是**反复自动执行**。让 rm 当考题，等于给一个会被定时跑的
// 东西发了删除权。所以差集不是疏漏，是决定——但必须写下来、被判据锁住，
// 否则下一个人补白名单时不知道这里躺过一个决定。
export const EXECUTION_DENIED = {
  rm: '会删除世界。考题只许观察，不许改变被观察的东西',
  touch: '会创造文件，从而改变下一次考试的前提（考试不能给自己造考场）',
};
const SHELLY = /[|><&;`$\n]/;

/**
 * recheck 是否是一个「可重跑的动作」。
 * 返回 {ok, reason, argv}。ok=false 时 reason 要能直接印给人看。
 */
export function checkRecheck(rc) {
  if (!rc || typeof rc !== 'object') return { ok: false, reason: '没有 recheck：这条经验无法被任何人重跑，只能当 candidate' };
  if (rc.kind !== 'command') return { ok: false, reason: `recheck.kind=${JSON.stringify(rc.kind)} 不支持（v0.1 只认 command）` };
  const run = String(rc.run || '').trim();
  if (!run) return { ok: false, reason: 'recheck.run 为空' };
  if (SHELLY.test(run)) return { ok: false, reason: 'recheck.run 含管道/重定向/换行——考试跑命令不跑脚本，别把一句可复核的话变成一段没人读得懂的 shell' };
  const argv = run.split(/\s+/).filter(Boolean);
  if (!ALLOWED_CMDS.includes(argv[0])) {
    return { ok: false, reason: `recheck.run 的首词 ${JSON.stringify(argv[0])} 不在白名单（${ALLOWED_CMDS.slice(0, 6).join('/')}…）` };
  }
  if (rc.expect_exit != null && !Number.isInteger(rc.expect_exit)) {
    return { ok: false, reason: 'recheck.expect_exit 必须是整数' };
  }
  return { ok: true, reason: '', argv };
}

/**
 * 单条经验的形式校验（不跑命令，只看形状）。
 * 注意它**不判断经验对不对**——那是考试的事。这里只判断「它有没有资格被考」。
 */
export function checkLearning(l) {
  const issues = [];
  if (!l || typeof l !== 'object') return { ok: false, issues: ['不是对象'] };
  const lesson = String(l.lesson || '').trim();
  if (!lesson) issues.push('lesson 为空');
  if (lesson && lesson.length < 8) issues.push('lesson 太短，写不下一条能被推翻的主张');
  if (!['candidate', 'verified', 'deprecated'].includes(l.status)) issues.push(`status=${JSON.stringify(l.status)} 不合法`);
  if (l.confidence != null && !(l.confidence >= 0 && l.confidence <= 1)) issues.push('confidence 不在 [0,1]');

  const rc = checkRecheck(l.recheck);
  // R1：没有可重跑检验就不许叫 verified
  if (l.status === 'verified' && !rc.ok) issues.push(`verified 但无可重跑检验：${rc.reason}`);
  // R6：血缘写了就得写对（缺省不判——一手经验不是缺陷）
  const lin = checkLineage(l);
  if (!lin.ok) issues.push(lin.reason);
  // R7：带未清 taint 还自称 verified
  if (l.status === 'verified' && l.taint && !l.taint.cleared_at) issues.push(`verified 但带未清除的 taint（来自 ${l.taint.by}）`);
  return { ok: issues.length === 0, issues, recheck: rc, lineage: lin };
}

/**
 * R2：作者不能给自己发证。
 * 用在写入路径上：把外来的 learnings 规范化——凡是没有考试记录（exam.runs>0 且
 * last_result==='pass'）却自称 verified 的，一律压回 candidate，并记下被压的原因。
 * 返回 {learnings, demoted:[{id,lesson,why}]}
 */
export function normalizeForWrite(learnings) {
  const out = [];
  const demoted = [];
  const ids = new Set((learnings || []).map((l) => l.id || learningId(l.lesson)));
  const g = lineageGraph(learnings || []);
  const inCycle = new Set(g.cycles.flat());

  for (const raw of learnings || []) {
    const l = { ...raw };
    l.id = l.id || learningId(l.lesson);
    const passed = l.exam && l.exam.runs > 0 && l.exam.last_result === 'pass';
    if (l.status === 'verified' && !passed) {
      demoted.push({ id: l.id, lesson: l.lesson, why: '自称 verified 但没有考试通过记录——升级只能由考试给' });
      l.status = 'candidate';
    }
    const c = checkRecheck(l.recheck);
    if (l.status === 'verified' && !c.ok) {
      demoted.push({ id: l.id, lesson: l.lesson, why: `verified 但 recheck 不可跑：${c.reason}` });
      l.status = 'candidate';
    }

    // R6：血缘不能自证。指向盘上不存在的祖先，就等于「我从一条没人见过的经验来」——
    // 与 fact 退役时 superseded 必须指出真实存在的取代者是同一条规矩。
    const lin = checkLineage(l, ids);
    if (!lin.ok && l.status === 'verified') {
      demoted.push({ id: l.id, lesson: l.lesson, why: `verified 但血缘不可核：${lin.reason}` });
      l.status = 'candidate';
    }
    if (inCycle.has(l.id) && l.status === 'verified') {
      demoted.push({ id: l.id, lesson: l.lesson, why: '血缘成环——环里每条都拿另一条当自己的依据，等于集体自证' });
      l.status = 'candidate';
    }

    // R7 的承重半边：**taint 在场时不许是 verified**。
    // 没有这一条，propagateTaint 打的标记就只是个注释——「函数在、判据在、调用方不在」
    // 那个病在本仓库已经复发过五次，这里不给它第六次机会。
    if (l.status === 'verified' && l.taint && !l.taint.cleared_at) {
      demoted.push({ id: l.id, lesson: l.lesson, why: `verified 但带未清除的 taint（来自 ${l.taint.by}）——洗掉它只能靠重新考过` });
      l.status = 'candidate';
    }

    out.push(l);
  }
  return { learnings: out, demoted };
}

// ── R6/R7：血缘与污染传播 ────────────────────────────────────────

const LID = /^L-[0-9a-f]{12}$/;

/**
 * R6：血缘形状与可核性。
 * `derived_from` 缺省视为 `[]` —— **一手经验（直接从 trace 蒸馏）不是缺陷**，
 * 所以缺省不判红；判红的是「写了但写不对」。
 * @param knownIds 给了就检查祖先是否真的在盘上；不给只检查形状
 */
export function checkLineage(l, knownIds = null) {
  const df = l?.derived_from;
  if (df === undefined || df === null) return { ok: true, reason: '', parents: [] };
  if (!Array.isArray(df)) return { ok: false, reason: 'derived_from 必须是数组', parents: [] };
  const bad = df.filter((x) => typeof x !== 'string' || !LID.test(x));
  if (bad.length) return { ok: false, reason: `derived_from 含非法 id：${JSON.stringify(bad.slice(0, 3))}`, parents: [] };
  const self = l.id || learningId(l.lesson);
  if (df.includes(self)) return { ok: false, reason: '经验不能是自己的祖先', parents: [] };
  if (knownIds) {
    const missing = df.filter((x) => !knownIds.has(x));
    if (missing.length) return { ok: false, reason: `derived_from 指向盘上不存在的经验：${missing.slice(0, 3).join(', ')}`, parents: df };
  }
  return { ok: true, reason: '', parents: df };
}

/**
 * 由 learnings 建血缘图。返回正向边（祖先 → 后代）、反向边，以及**环**。
 * 环必须显式返回而不是静默去掉：一个环里每条都拿另一条当依据，那是集体自证，
 * 跟「一份实现自己跑通自己的测试」同型，得让它可见。
 */
export function lineageGraph(learnings = []) {
  const children = new Map();
  const parents = new Map();
  const ids = [];
  for (const l of learnings) {
    const id = l.id || learningId(l.lesson);
    ids.push(id);
    const ps = Array.isArray(l.derived_from) ? l.derived_from.filter((x) => typeof x === 'string') : [];
    parents.set(id, ps);
    for (const p of ps) {
      if (!children.has(p)) children.set(p, new Set());
      children.get(p).add(id);
    }
  }
  // 找环：DFS 三色标记
  const cycles = [];
  const color = new Map();
  const stack = [];
  const walk = (id) => {
    if (color.get(id) === 2) return;
    if (color.get(id) === 1) {
      const i = stack.indexOf(id);
      if (i >= 0) cycles.push(stack.slice(i));
      return;
    }
    color.set(id, 1);
    stack.push(id);
    for (const p of parents.get(id) || []) if (parents.has(p)) walk(p);
    stack.pop();
    color.set(id, 2);
  };
  for (const id of ids) walk(id);
  return { children, parents, cycles, ids };
}

/** 传递闭包：某条经验的全部后代（不含它自己）。 */
export function descendantsOf(id, children) {
  const out = new Set();
  const q = [...(children.get(id) || [])];
  while (q.length) {
    const x = q.shift();
    if (out.has(x)) continue;   // 环安全：见过就不再展开
    out.add(x);
    for (const y of children.get(x) || []) q.push(y);
  }
  return out;
}

/**
 * R7：污染传播。某几条经验倒了（考试挂了 / 被推翻），其**全部后代**的 verified
 * 撤回 candidate，并打 taint。
 *
 * 三件刻意不做的事，每件都对应一个更坏的选项：
 *   · **不删除后代** —— 删了就没人知道曾经有过这条，跟 fact 的「墓碑不是删除」一致
 *   · **不把后代标成 refuted** —— 污染 ≠ 一定错。标错是替考试做了它没做的判断
 *   · **不自动重考** —— 重考要跑命令，那是 exam 的活；这里只改信任状态，纯函数不碰世界
 *
 * @returns {learnings, tainted:[{id, by, distance}]}
 */
export function propagateTaint(learnings = [], sourceIds = [], { when, why = '' } = {}) {
  const g = lineageGraph(learnings);
  const hit = new Map();  // 后代 id → 最先污染它的祖先
  for (const src of sourceIds) {
    for (const d of descendantsOf(src, g.children)) if (!hit.has(d)) hit.set(d, src);
  }
  const tainted = [];
  const out = learnings.map((raw) => {
    const id = raw.id || learningId(raw.lesson);
    if (!hit.has(id)) return raw;
    const l = { ...raw, taint: { by: hit.get(id), at: when, why } };
    if (l.status === 'verified') { l.status = 'candidate'; l.taint.demoted = true; }
    tainted.push({ id, by: hit.get(id), demoted: !!l.taint.demoted });
    return l;
  });
  return { learnings: out, tainted };
}

/**
 * R3：把一次考试结果套用到经验上，返回新的经验对象（纯函数，不写盘）。
 * result ∈ pass | fail | error
 *   pass  → candidate 升 verified；verified 保持
 *   fail  → verified 当场降 candidate（确定性命令跑挂一次就够了，不必攒次数）
 *   error → 不升不降，但计入 errors。跑不起来 ≠ 经验错了，也 ≠ 经验对了
 */
export function applyExam(l, result, { when, detail = '' } = {}) {
  const n = { ...l, exam: { ...(l.exam || {}) } };
  const e = n.exam;
  e.runs = (e.runs || 0) + 1;
  e.last_run = when;
  e.last_result = result;
  e.last_detail = detail.slice(0, 300);
  if (result === 'pass') {
    e.passes = (e.passes || 0) + 1;
    // R7：重新考过是**唯一**能洗掉 taint 的事。手写清除会被 normalizeForWrite 压回，
    // 所以这里是那把钥匙的唯一一份。留 by/at 不删——洗清了不等于没发生过。
    if (n.taint && !n.taint.cleared_at) n.taint = { ...n.taint, cleared_at: when, cleared_by: 'exam' };
    if (n.status === 'candidate') { n.status = 'verified'; e.promoted_at = when; }
  } else if (result === 'fail') {
    e.fails = (e.fails || 0) + 1;
    if (n.status === 'verified') { n.status = 'candidate'; e.demoted_at = when; e.demoted_by = 'exam'; }
  } else {
    e.errors = (e.errors || 0) + 1;
  }
  return n;
}

/**
 * 考题有没有**判别力**——RFC-0008 §6 记下的那个最大的洞的可测量部分。
 *
 * 洞是这样的：`recheck` 与经验的语义绑定靠人判断，挂一个恒绿的命令
 * （`node --version`）就能骗过考试，而账面上它跟一条真考题长得一模一样。
 * 这跟本仓库那条已验证经验是同一件事：
 *     「全绿有两种可能——真修好了，或复现路径失效了。没有反向判据分不出来。」
 *
 * v0.1 不假装解决它，只让它**可见可数**：一条考题只有在**被观察到红过至少一次**
 * 之后，才算证明了自己分得开好坏。判据取自考试账本（fails>0），不取自任何人的断言——
 * 这是从已有数据推导，不是补录。
 *
 * 刻意**不**做的事：不因为"未证明"就拒绝升 verified。那会让协议第一天就卡死
 * （6 条里 4 条没红过），而且"从没红过"本身并不等于"是假考题"。
 * 让它显形，比让它消失更诚实。
 */
export function discriminating(l) {
  return ((l.exam && l.exam.fails) || 0) > 0 ? 'proven' : 'unproven';
}

/** 跨学历聚合：按 id 去重，同一条经验出现在多份学历里时保留考试记录最全的那份 */
export function collect(states) {
  const byId = new Map();
  for (const { rel, s } of states) {
    for (const l of (s.learnings || [])) {
      const id = l.id || learningId(l.lesson);
      const cur = byId.get(id);
      const runs = (l.exam && l.exam.runs) || 0;
      if (!cur || runs > ((cur.l.exam && cur.l.exam.runs) || 0)) byId.set(id, { id, from: rel, l });
      else cur.also = [...(cur.also || []), rel];
    }
  }
  return [...byId.values()];
}
