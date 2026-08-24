// fact-core.mjs — 事实的生命周期：钉证据、复核、退役（学籍 fact/0.1）
//
// 为什么现在才写（盘上实测，不是设想）：
//
//     19 份学历，445 条 facts，**带生命周期字段的 0 条**。
//     schema 里 fact 只有 claim/verified/source/when —— 一条今天被推翻的事实，
//     明天依然 verified:true 躺在那儿等北桥调用。
//     对照组：learnings 有 candidate/verified/deprecated，还有考试来降级。
//     同一份学历里，经验会过期，事实不会。这不是设计，是漏了。
//
// 这是学堂那条对称往下走的第三段：
//     fact 的 source 必须引**可复核物**
//     → learning 的 recheck 必须是**可重跑的命令**
//     → 那么 fact 的**退役**也必须给出可复核的依据，而不是谁说了算
//
// ── 两条被实测推翻的设计，写在这里免得下一个人再走一遍 ──────────────────
//
// ❌ 按时间衰减（FadeMem / 微软那套 exponential decay）。
//    先量后弃：445 条里 338 条能判先后，按 `fact.when` 对比证据文件 mtime，
//    204 条算「过期」。看着信号很强 —— 但 `when` 是**手写的自签时间**（盘上大量
//    16:30:00 这种整点整分），而本仓库的立身之本恰恰是「本机 git 没有 remote，
//    commit date 可任意伪造，仓库里任何时间主张都不可外部核验」（governance/anchor）。
//    拿自签时间当遗忘依据，等于把治理层刚赶出去的那个病，从记忆层原样放回来。
//    **所以遗忘按内容，不按时间。内容指纹不能自签。**
//
// ❌ 按 claim 文本重复来查矛盾。
//    也是先量后弃：445 条里完全重复的 claim **0 组**。照这个做出来的判据永远是绿的，
//    而恒绿考题正是 X8.2 专门骂的那种 —— 它长得跟真判据一模一样，只是分不开好坏。
//    语义矛盾要判得准得上模型，v0.1 不假装解决它（同 RFC-0008 §6 的处理：
//    不假装解决，但让它可见可数 —— 见 auditFacts 的 unpinned 计数）。
//
// ── 为什么是墓碑不是删除 ──────────────────────────────────────────────
// 16 份 `.ots` 锚点冻结的是**当时盘上的证据集合**，`.benjing-backups/` 里的旧名
// 「永远不能改，改一个字节 .ots 就失效」。真按「把记忆放进你能删掉的文件里」去删，
// 删掉的是自己的举证能力。所以退役只改 status，原文一个字节都不动。
//
// 本文件只做纯逻辑（判断、升降级、聚合），**不碰磁盘写**：落盘一律走 benjing-put
// 的乐观锁。学堂开第二条写路径就是 task5 学历被吃掉那次的复刻，这里不重演。

import crypto from 'node:crypto';
import { resolveSourceRefs, recheckSource } from './benjing-core.mjs';
import { observe } from '../benxiang/observe.mjs';

export const SPEC = 'fact/0.1';

/**
 * 事实的稳定 id：同一条事实在任何会话、任何学历里算出同一个 id。
 *
 * 定义搬到这里而不是留在 northbridge/compile.mjs，因为 superseded_by 要指向它，
 * 学籍层不能反过来 import 北桥（那是环，且方向也反了：知依赖存，不是存依赖知）。
 * compile.mjs 现在 re-export 本函数 —— **一个 id 只许有一个定义**，
 * 两份实现就是两个真相，而 superseded_by 指错人比不指更糟。
 */
export function factId(claim) {
  return 'f:' + crypto.createHash('sha256').update(String(claim)).digest('hex').slice(0, 12);
}

/**
 * active     证据仍成立，或从未被钉住（445 条存量事实全在这一档）
 * stale      **只能由复核器给**：钉住的证据物内容变了 / 不在了。
 *            注意它不是「这条事实假了」——是「当初的验证不再覆盖现状」。B3.3 锁死了
 *            「不许因路径不存在就判假」，这条不能动，所以降级的名字必须是未复核而不是假。
 * superseded 被另一条事实取代（必须指出取代者）
 * refuted    被推翻（必须给出可复核的推翻依据）
 */
export const FACT_STATUS = ['active', 'stale', 'superseded', 'refuted'];

/**
 * 作者写入时**允许**自己写的状态。`stale` 不在其中，理由与学堂 R2 逐字对称：
 * 「升级只能由考试给，作者不能给自己发证」→ 降级也只能由复核器给，
 * 作者手写 stale 等于绕过复核直接宣布证据变了，那句话没有任何东西为它背书。
 */
export const AUTHOR_WRITABLE_STATUS = ['active', 'superseded', 'refuted'];

/** 缺省即 active：445 条存量事实没有 status 字段，不能因为协议长出新字段就集体判死。 */
export function statusOf(f) {
  const s = f && f.status;
  return FACT_STATUS.includes(s) ? s : 'active';
}

/** 只有 active 的已验证事实才进上下文。北桥两个时刻都用这一个判据，不各判各的。 */
export function isLive(f) {
  return !!(f && f.verified) && statusOf(f) === 'active';
}

/**
 * 钉证据：把 source 里解得出的每个仓库内文件，按**此刻**的内容指纹记下来。
 *
 * 只钉解引用得到的（status==='found'）。解不开的记进 unresolved 但不当证据——
 * 钉一个不知道指向哪的东西，日后比对必然报假警，那就是「探针对什么都报警等于没装探针」。
 *
 * 看世界只走本象 observe()，不自己 createHash(readFileSync)：
 * 「sha256 在三个文件里各写一遍」是 RFC-0006 §0 记下的结构性病根。
 */
export function pinEvidence(source, root) {
  const { resolved } = resolveSourceRefs(source, root);
  const refs = [], unresolved = [];
  for (const r of resolved) {
    if (r.status !== 'found') { unresolved.push({ ref: r.ref, why: r.status }); continue; }
    const o = observe(r.resolved, root).properties;
    if (o.exists && o.sha256) refs.push({ ref: r.ref, sha256: o.sha256 });
    else unresolved.push({ ref: r.ref, why: o.exists ? 'not_a_file' : 'vanished' });
  }
  return { refs, unresolved };
}

/**
 * 复核一条事实的证据现状。**不改任何东西**，只回答「当初钉住的那些内容，现在还一样吗」。
 *
 *   unpinned  没钉过证据 —— 无法复核。这是存量 445 条的状态，必须**出数**而不是当成通过。
 *             「全绿有两种可能：真没问题，或根本没测」——不报未测量，就是谎报证明强度。
 *   intact    钉住的每一条都逐字节一致
 *   changed   至少一条内容变了 → 当初的验证不再覆盖现状
 *   dangling  至少一条现在解引用不到了（钉的时候还在）
 *
 * 优先级 dangling > changed > intact：东西没了比变了更该先说。
 */
export function checkEvidence(f, root) {
  const refs = (f && f.pin && f.pin.refs) || [];
  if (!refs.length) return { state: 'unpinned', changed: [], gone: [], intact: [] };
  const changed = [], gone = [], intact = [];
  for (const nail of refs) {
    const { resolved } = resolveSourceRefs(nail.ref, root);
    const hit = resolved.find(r => r.status === 'found');
    if (!hit) { gone.push(nail.ref); continue; }
    const now = observe(hit.resolved, root).properties.sha256 || null;
    if (now === nail.sha256) intact.push(nail.ref);
    else changed.push({ ref: nail.ref, was: nail.sha256, now });
  }
  const state = gone.length ? 'dangling' : changed.length ? 'changed' : 'intact';
  return { state, changed, gone, intact };
}

/**
 * 把一次复核结果套用到事实上（纯函数，不写盘）。对称 xuetang/applyExam。
 *
 *   intact   → stale 可复活为 active（内容与钉住时逐字节相同，验证确实仍覆盖）
 *   changed  → active 降 stale
 *   dangling → active 降 stale（**不是判假**：B3.3 说过很多 fact 讲的正是「这东西没了」）
 *   unpinned → 不升不降，只记账。没钉过证据 ≠ 事实错了，也 ≠ 事实对了
 *
 * 复核器**无权碰 superseded / refuted**：那两个是人依据别的东西做的判断，
 * 不是证据物的状态。让自动机去改人的判断，就是「决策权与判断依据分离」反着来。
 */
export function applyRecheck(f, verdict, { when = '', detail = '' } = {}) {
  const n = { ...f, pin: { ...(f.pin || {}) } };
  const e = n.pin;
  e.runs = (e.runs || 0) + 1;
  e.last_run = when;
  e.last_result = verdict;
  e.last_detail = String(detail).slice(0, 300);

  const cur = statusOf(n);
  if (cur === 'superseded' || cur === 'refuted') return n;

  if (verdict === 'changed' || verdict === 'dangling') {
    if (cur === 'active') { n.status = 'stale'; e.demoted_at = when; e.demoted_by = 'recheck'; }
  } else if (verdict === 'intact') {
    if (cur === 'stale') { n.status = 'active'; e.revived_at = when; }
  }
  return n;
}

/**
 * 退役的举证责任。**不低于当初确立这条事实的举证责任** —— 这是本文件唯一的实质主张。
 *
 * 没有它，status 字段就是个可以随手填的标签：谁都能把一条碍事的已验证事实标成
 * refuted 让它从上下文里消失，而不留下任何可复核的依据。那不是遗忘，是删证据。
 *
 * byId 是同一份学历里 id → fact 的索引，用来确认取代者真的在盘上。
 */
export function retirementIssues(f, byId = new Map()) {
  const issues = [];
  const st = statusOf(f);
  if (f && f.status !== undefined && !FACT_STATUS.includes(f.status)) {
    issues.push(`status=${JSON.stringify(f.status)} 不合法（只许 ${FACT_STATUS.join('/')}）`);
  }
  if (st === 'refuted') {
    const src = (f.retire && f.retire.source) || '';
    const rc = recheckSource(src);
    if (!rc.ok) issues.push(`refuted 但 retire.source 不可复核：${rc.hint}——推翻一条已验证事实的举证责任不低于当初确立它的`);
    if (!((f.retire && f.retire.why) || '').trim()) issues.push('refuted 但没写 retire.why（凭什么推翻）');
  }
  if (st === 'superseded') {
    const to = (f.superseded_by || '').trim();
    if (!to) issues.push('superseded 但没有 superseded_by（说不出被谁取代，就只是让它消失）');
    else if (to === factId(f.claim)) issues.push('superseded_by 指向自己');
    else if (byId.size && !byId.has(to)) issues.push(`superseded_by=${to} 在本学历里找不到——取代者必须真的在盘上`);
  }
  return issues;
}

/** 取代链成环：A←B←A。成环时两条都永远不进上下文，而账面上谁都"有取代者"。 */
export function supersedeCycles(facts) {
  const byId = new Map((facts || []).map(f => [factId(f.claim), f]));
  const cycles = [];
  for (const [id, f] of byId) {
    if (statusOf(f) !== 'superseded') continue;
    const seen = new Set([id]);
    let cur = (f.superseded_by || '').trim();
    while (cur && byId.has(cur)) {
      if (seen.has(cur)) { cycles.push([...seen, cur]); break; }
      seen.add(cur);
      const nx = byId.get(cur);
      if (statusOf(nx) !== 'superseded') break;
      cur = (nx.superseded_by || '').trim();
    }
  }
  return cycles;
}

/**
 * 写入闸门（对称 xuetang/normalizeForWrite）：作者不能自己发降级证。
 *
 * 两个方向都要挡，只挡一头等于没挡：
 *   ① 手写 stale 而没有复核账本 → 压回 active。降级只能由复核器给。
 *   ② 复核账本显示 changed/dangling，却手写成 active → 压回 stale。
 *      这一条才是真正要命的：它是**用手写覆盖机器的观察结果**，
 *      等于把「证据变了」这件事直接抹掉，比①隐蔽得多。
 */
export function normalizeFactsForWrite(facts) {
  const out = [], adjusted = [];
  for (const raw of facts || []) {
    const f = { ...raw };
    const e = f.pin || {};
    const rechecked = (e.runs || 0) > 0;
    if (statusOf(f) === 'stale' && !rechecked) {
      adjusted.push({ claim: f.claim, from: 'stale', to: 'active', why: '手写 stale 但没有复核记录——降级只能由复核器给' });
      f.status = 'active';
    }
    if (statusOf(f) === 'active' && (e.last_result === 'changed' || e.last_result === 'dangling')) {
      adjusted.push({ claim: f.claim, from: 'active', to: 'stale', why: `复核记录显示证据 ${e.last_result}，手写 active 等于抹掉机器的观察结果` });
      f.status = 'stale';
    }
    out.push(f);
  }
  return { facts: out, adjusted };
}

/**
 * 全盘对账：这批学历的事实，有多少还站得住、多少没法复核、多少结构上就有问题。
 *
 * `unpinned` 是这里最重要的那个数，理由与学堂盘点时那句话完全相同：
 * 「58 条经验，49 条自称 verified，0 条能被任何人重跑」。
 * 不把「没法复核」的条数单独打出来，「N 条已验证事实」就会被读成「N 条被证明为真」。
 */
export function auditFacts(states, root) {
  const tally = { total: 0, live: 0, unverified: 0, byStatus: {}, pin: { intact: 0, changed: 0, dangling: 0, unpinned: 0 } };
  const problems = [];
  for (const { rel, s } of states) {
    const facts = s.facts || [];
    const byId = new Map(facts.map(f => [factId(f.claim), f]));
    for (const f of facts) {
      tally.total++;
      if (!f.verified) tally.unverified++;
      const st = statusOf(f);
      tally.byStatus[st] = (tally.byStatus[st] || 0) + 1;
      if (isLive(f)) tally.live++;
      const ev = checkEvidence(f, root);
      tally.pin[ev.state]++;
      for (const msg of retirementIssues(f, byId)) problems.push({ rel, claim: f.claim, msg });
      // 证据已变却还是 active：这正是本部件要抓的那一类。只在钉过证据时才说得出口。
      if (isLive(f) && (ev.state === 'changed' || ev.state === 'dangling')) {
        problems.push({ rel, claim: f.claim, msg: `证据 ${ev.state} 但仍是 active，未跑复核（node southbridge/fact-recheck.mjs）` });
      }
    }
    for (const c of supersedeCycles(facts)) problems.push({ rel, claim: '(取代链)', msg: `superseded_by 成环：${c.join(' → ')}` });
  }
  return { tally, problems };
}
