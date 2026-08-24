#!/usr/bin/env node
// certify.mjs — 发证分离闸门（agentteams-bridge/0.1）
//
// 学堂的规矩是「升级只能由考试给，作者不能给自己发证」。这条规矩在单进程下成立，
// 因为考试是另一个程序；**在多 Agent 下是空的**，因为 exam.mjs 是任何 Worker 都能自己跑的脚本。
// Worker 干完活，自己跑一遍考试，自己给自己发证——现有每一道闸门都放行，
// 因为没有任何东西记录过「跑考试的那个进程」和「写经验的那个进程」是不是同一个。
//
// 这个闸门补的就是这一格：**发证记录必须带考官身份，且考官身份必须由平台签发。**
//
//   G1  考官身份必须 attested（问过 Matrix homeserver）。declared 的不算——
//       环境变量自己 export 一个零成本，据此发证等于没有闸门。
//   G2  被考经验必须记着作者身份。没记就不能考——不知道作者是谁，就无从判断考官是不是作者。
//   G3  考官 ≠ 作者。同一个身份既执行又发证，一律拒绝。
//   G4  recheck 必须是可重跑命令（沿用学堂 checkRecheck，不另立一套）。
//
// 四道闸都是**拒绝发证**，不是拒绝写盘。拒绝的时候经验留在 candidate，
// 学历一个字节不改——同学堂「跑不起来不升不降」：环境不对 ≠ 经验错了。
//
// 每一次判决都追加进台账，且台账**走南桥**（受审计、有风险分级、写后回读）。
// 不自己 appendFileSync：那正是 RFC-0006 §0 说的「自证在本仓库复发五次的结构性原因」。
//
// 退出码：0=通过（升级/维持）  2=闸门拒绝发证  3=考试挂了（降级）  4=跑不起来/写失败  1=用法错
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { observeIdentity, identityRecord, identityFingerprint, SPEC } from './identity.mjs';
import { readState, putState } from '../southbridge/benjing-core.mjs';
import { learningId, checkRecheck, applyExam } from '../xuetang/learning-core.mjs';
import { doWrite } from '../southbridge/shadowcore-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
// 台账路径可被环境变量覆盖，理由同影核的 SHADOWCORE_AUDIT_LOG：
// 判据要制造「台账写不进去」这类故障场景，不能只能靠改代码。
const LEDGER_REL = process.env.AGENTTEAMS_CERTIFY_LEDGER || 'demo/agentteams-bridge/certify-ledger.jsonl';
const MAX_CAS_RETRY = 5;

const USAGE = `发证分离闸门（${SPEC}）

  whoami                              观察本进程在 AgentTeams 里是谁（不发证，只看）
  list    --state <学历路径>            列出可考的经验及其作者/考官记录
  stamp   --state <学历路径> --lesson <一句话> --recheck <命令> [--expect-exit N]
                                      以**作者**身份登记一条 candidate 经验（不发证）
  observe --state <学历路径> --learning <id 或 lesson 片段>
                                      以**取象**身份跑考题，产出判决依据（不发证）
  certify --state <学历路径> --learning <id 或 lesson 片段>
                                      以**考官**身份读观察记录并判升降级（不跑任何命令）

stdout = 一行 JSON（机器读）；stderr = 给人看的话
退出码 0=通过 2=闸门拒绝 3=考试挂了 4=跑不起来/写失败 1=用法错

三个子命令对应三个必须分离的身份，分法是**推出来的不是分出来的**：
  作者写 → 只能写 candidate（自封 verified 会被写入闸门压回）
  取象跑 → **整个协议里只有 observe 会执行命令**，且它不判分
  考官判 → 只读观察记录，不跑任何命令

  为什么取象必须独立出来：v0.1 里考官自己跑考试又自己采信结果，
  四道闸拦住了「作者给自己发证」，没拦住「考官自己产生判决依据」——
  那是同一个病换了位置（透镜：决策权与判断依据分离）。

  分成子命令拦不住「同一个进程连扳三次」，**但身份闸门拦得住**：
  三次调用留下的指纹一样，第二次就被判自证。`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-/g, '_');
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

// 台账走南桥：判决要能被事后翻案，而翻案的前提是判决本身留下了受审计的物证。
// 写失败不吞：调用方必须看得见「这次判决没留下台账」。
function ledger(entry) {
  const line = JSON.stringify({ spec: SPEC, at: new Date().toISOString(), ...entry }) + '\n';
  const r = doWrite(
    { relpath: LEDGER_REL, content: line, mode: 'append' },
    'agentteams_certify'
  );
  return { status: r.status, action_id: r.action_id, footprint: r.footprint ?? null };
}

function findLearning(state, needle) {
  const ls = state.learnings || [];
  const n = String(needle);
  let i = ls.findIndex(l => (l.id || learningId(l.lesson)) === n);
  if (i < 0) i = ls.findIndex(l => String(l.lesson || '').includes(n));
  return i;
}

function out(obj, code) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  process.exit(code);
}

function humanTip(msg) {
  // 人话只走 stderr，且只在交互终端下打——管道里不污染（同南桥 CLI 的约定）
  if (process.stderr.isTTY) { try { process.stderr.write(msg + '\n'); } catch { /* ignore */ } }
}

// ───────────────────────────── whoami ─────────────────────────────
async function cmdWhoami() {
  const me = await observeIdentity();
  humanTip(me.attested
    ? `✅ 身份由 homeserver 签发：${me.id}`
    : me.unreachable
      ? '⚠ 够不着 homeserver —— 这是仪器失效，不是「没有身份」。此刻不能发证，但也别据此断言身份不存在'
      : `⚠ 身份只有 ${me.source} 出处，不足以发证`);
  out({ kind: 'identity.observation', ...me }, me.attested ? 0 : 2);
}

// ───────────────────────────── list ─────────────────────────────
async function cmdList(a) {
  const p = path.resolve(ROOT, a.state);
  const { state } = readState(p);
  const rows = (state.learnings || []).map(l => ({
    id: l.id || learningId(l.lesson),
    status: l.status,
    lesson: String(l.lesson || '').slice(0, 70),
    author_fp: l.author?.fp ?? null,
    author_attested: l.author?.attested === true,
    examiner_fp: l.exam?.examiner?.fp ?? null,
    runs: l.exam?.runs ?? 0,
    last_result: l.exam?.last_result ?? null,
    // 「有考试记录」和「有合格考官」是两件事。旧账里前者有、后者一律为空——
    // 那不是数据缺失，那是本闸门上线之前**这个问题根本没被问过**。
    separated: !!(l.author?.fp && l.exam?.examiner?.fp && l.author.fp !== l.exam.examiner.fp),
  }));
  out({ kind: 'learning.list', state: a.state, count: rows.length, learnings: rows }, 0);
}

// ───────────────────────────── stamp（作者身份登记）─────────────────────────────
async function cmdStamp(a) {
  const p = path.resolve(ROOT, a.state);
  if (!fs.existsSync(p)) out({ status: 'failed', reason: `学历不存在: ${a.state}` }, 4);
  const lesson = typeof a.lesson === 'string' ? a.lesson.trim() : '';
  const run = typeof a.recheck === 'string' ? a.recheck.trim() : '';
  if (!lesson || !run) out({ status: 'denied', reason: 'stamp 需要 --lesson 与 --recheck' }, 1);

  const me = await observeIdentity();
  const rc = { kind: 'command', run, ...(a.expect_exit !== undefined ? { expect_exit: Number(a.expect_exit) } : {}) };
  const chk = checkRecheck(rc);
  if (!chk.ok) out({ status: 'denied', reason: `recheck 不可跑：${chk.reason}` }, 1);

  // 作者身份**不要求 attested**：登记 candidate 不是发证，门槛不该跟发证一样高。
  // 但 source 如实记下——考的时候 G2 会看它，declared 的作者身份挡不住自证，
  // 因为一个进程能声明成 A 也就能声明成 B。这一格的诚实做法是让它显形，不是假装够用。
  const learning = {
    id: learningId(lesson),
    lesson,
    status: 'candidate',           // 只能写 candidate。写 verified 会被 putState 压回来
    recheck: rc,
    author: identityRecord(me),
    origin: { task: state_id(p), when: new Date().toISOString() },
  };

  const r = patchAppendLearning(p, learning);
  const led = ledger({ verb: 'learning.stamp', state: a.state, learning_id: learning.id, author: learning.author, write_status: r.status });
  humanTip(r.status === 'denied' ? `⛔ ${r.reason}` : `📝 已登记 candidate（作者出处：${learning.author.source}）`);
  out({ kind: 'certify.result', verb: 'stamp', learning_id: learning.id, author: learning.author, write: r, ledger: led },
      r.status === 'denied' || r.status === 'failed' ? 4 : 0);
}

function state_id(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')).id || null; } catch { return null; }
}

// 追加一条经验：走 CAS 重试（追加可交换）。不整份写回。
function patchAppendLearning(p, learning) {
  let last = null;
  for (let attempt = 1; attempt <= MAX_CAS_RETRY; attempt++) {
    const cur = readState(p);
    const next = JSON.parse(JSON.stringify(cur.state));
    delete next.content_hash; delete next.actor;
    next.learnings = [...(next.learnings || []), learning];
    const r = putState(p, next, { expect: cur.computed, actor: { by: 'agentteams/certify' } });
    if (r.status !== 'diverged') return { ...r, attempts: attempt };
    last = r;
  }
  return { ...last, attempts: MAX_CAS_RETRY };
}

// ───────────────────────────── observe（取象身份产生判决依据）─────────────────────────────
//
// 考题的指纹。观察绑在**这一道题**上，改题之后旧观察必须作废——
// 否则「换一道更好过的题、拿旧观察去发证」就是一条绕过全部闸门的路。
function recheckFingerprint(rc) {
  const canon = JSON.stringify({
    kind: rc?.kind ?? null, run: String(rc?.run ?? '').trim(),
    expect_exit: Number.isInteger(rc?.expect_exit) ? rc.expect_exit : 0,
  });
  return crypto.createHash('sha256').update(canon).digest('hex').slice(0, 16);
}

async function cmdObserve(a) {
  const p = path.resolve(ROOT, a.state);
  if (!fs.existsSync(p)) out({ status: 'failed', reason: `学历不存在: ${a.state}` }, 4);
  const needle = typeof a.learning === 'string' ? a.learning : '';
  if (!needle) out({ status: 'denied', reason: 'observe 需要 --learning <id 或 lesson 片段>' }, 1);

  const { state } = readState(p);
  const idx = findLearning(state, needle);
  if (idx < 0) out({ status: 'failed', reason: `学历里找不到经验: ${needle}` }, 4);
  const target = state.learnings[idx];
  const lid = target.id || learningId(target.lesson);

  const me = await observeIdentity();
  const observer = identityRecord(me);

  const refuse = (code, why) => {
    const rec = { kind: 'certify.result', verb: 'observe', decision: 'refused', code, learning_id: lid, why, observer };
    rec.ledger = ledger({ verb: 'observe.refused', code, state: a.state, learning_id: lid, observer, why });
    humanTip(`⛔ 拒绝观察（${code}）：${why}`);
    out(rec, 2);
  };

  // 观察者身份也必须由平台签发：判决依据的来源如果谁都能冒充，
  // 那闸门只是把「谁都能说」从判决挪到了证据上。
  if (!me.attested) {
    refuse(me.unreachable ? 'observer_unreachable' : 'observer_unattested',
      me.unreachable ? '够不着 homeserver，此刻无法确认观察者是谁——仪器失效，不产出观察'
                     : `观察者身份只有 ${me.source} 出处`);
  }
  // 自己干的活自己看 = 确认偏误机（同取象铁律：observe 永不接收「你觉得应该是什么」）
  if (target.author?.fp && target.author.fp === observer.fp) {
    refuse('observer_is_author', '观察者与作者是同一个身份——自己干的活自己看，观察不构成独立证据');
  }
  const chk = checkRecheck(target.recheck);
  if (!chk.ok) refuse('unrunnable_recheck', `recheck 不可跑：${chk.reason}`);

  // ── 真正跑考题。**整个协议里只有这一处执行命令。** ────────────────────
  const expectExit = Number.isInteger(target.recheck.expect_exit) ? target.recheck.expect_exit : 0;
  let result, detail;
  try {
    const r = spawnSync(chk.argv[0], chk.argv.slice(1), {
      cwd: ROOT, encoding: 'utf8', timeout: 120000, windowsHide: true,
    });
    if (r.error) { result = 'error'; detail = `跑不起来: ${r.error.message}`; }
    else if (r.status === null) { result = 'error'; detail = '超时或被信号中断'; }
    else if (r.status === expectExit) { result = 'pass'; detail = `exit=${r.status}（期望 ${expectExit}）`; }
    else { result = 'fail'; detail = `exit=${r.status}（期望 ${expectExit}）${String(r.stderr || '').trim().slice(0, 160)}`; }
  } catch (e) {
    result = 'error'; detail = `跑不起来: ${e.message}`;
  }

  const observation = {
    observer, result, detail,
    recheck_fp: recheckFingerprint(target.recheck),
    consumed_by: null,
    at: new Date().toISOString(),
  };

  let write = null;
  for (let attempt = 1; attempt <= MAX_CAS_RETRY; attempt++) {
    const cur = readState(p);
    const next = JSON.parse(JSON.stringify(cur.state));
    delete next.content_hash; delete next.actor;
    const j = findLearning(next, lid);
    if (j < 0) { write = { status: 'failed', reason: '写回时经验已不在盘上' }; break; }
    next.learnings[j] = { ...next.learnings[j], observation };
    const r = putState(p, next, { expect: cur.computed, actor: { by: 'agentteams/observe' } });
    if (r.status !== 'diverged') { write = { ...r, attempts: attempt }; break; }
    write = { ...r, attempts: attempt };
  }

  const rec = {
    kind: 'certify.result', verb: 'observe', decision: result,
    learning_id: lid, result, detail, observer, recheck_fp: observation.recheck_fp, write,
  };
  rec.ledger = ledger({ verb: 'observe.' + result, state: a.state, learning_id: lid, observer, detail });
  humanTip(`👁 观察完成：${result}（观察者 ${observer.fp}）——判决交给考官，本命令不发证`);
  if (write && (write.status === 'denied' || write.status === 'failed')) out({ ...rec, reason: write.reason }, 4);
  out(rec, result === 'error' ? 4 : 0);
}

// ───────────────────────────── certify（考官身份发证）─────────────────────────────
async function cmdCertify(a) {
  const p = path.resolve(ROOT, a.state);
  if (!fs.existsSync(p)) out({ status: 'failed', reason: `学历不存在: ${a.state}` }, 4);
  const needle = typeof a.learning === 'string' ? a.learning : '';
  if (!needle) out({ status: 'denied', reason: 'certify 需要 --learning <id 或 lesson 片段>' }, 1);

  const { state } = readState(p);
  const idx = findLearning(state, needle);
  if (idx < 0) out({ status: 'failed', reason: `学历里找不到经验: ${needle}` }, 4);
  const target = state.learnings[idx];
  const lid = target.id || learningId(target.lesson);

  const me = await observeIdentity();
  const examiner = identityRecord(me);
  const author = target.author || null;

  const refuse = (code, why, extra = {}) => {
    const rec = {
      kind: 'certify.result', verb: 'certify', decision: 'refused', code,
      learning_id: lid, why, examiner, author, ...extra,
    };
    // 拒绝也要留台账。**只在通过时记账的账本，记的是喜报不是历史。**
    rec.ledger = ledger({ verb: 'certify.refused', code, state: a.state, learning_id: lid, examiner, author, why });
    humanTip(`⛔ 拒绝发证（${code}）：${why}`);
    out(rec, 2);
  };

  // ── G1 考官身份必须由平台签发 ──────────────────────────────────────────
  if (!me.attested) {
    refuse(
      me.unreachable ? 'examiner_unreachable' : 'examiner_unattested',
      me.unreachable
        ? `够不着 homeserver，此刻无法确认考官是谁——这是仪器失效，不判经验的对错（${me.probes.find(x => x.unreachable)?.reason || ''}）`
        : `考官身份只有 ${me.source} 出处。环境变量自己 export 一个零成本，据此发证等于没有闸门`,
      { unreachable: me.unreachable },
    );
  }

  // ── G2 被考经验必须记着作者 ────────────────────────────────────────────
  if (!author || !author.fp) {
    refuse('unknown_author',
      '这条经验没有作者身份记录，无从判断考官是不是作者。' +
      '本闸门上线前写的经验都是这样——那不是数据缺失，是这个问题此前没被问过。用 stamp 重新登记');
  }

  // ── G3 考官 ≠ 作者 ────────────────────────────────────────────────────
  if (author.fp === examiner.fp) {
    refuse('self_certification',
      '考官与作者是同一个身份。「作者不能给自己发证」在多 Agent 上第一次有了可执行形态——' +
      '此前它只检查「有没有考试记录」，不检查考试是谁跑的');
  }

  // 作者身份是 declared 时，G3 的结论有多硬要说清楚：一个能把自己声明成 A 的进程
  // 也能声明成 B，所以 fp 不同**不等于**真是两个 Agent。不拦，但必须披露。
  const separation_strength = author.attested ? 'attested_both' : 'examiner_only';

  // ── G4 recheck 必须可跑 ───────────────────────────────────────────────
  const chk = checkRecheck(target.recheck);
  if (!chk.ok) refuse('unrunnable_recheck', `recheck 不可跑：${chk.reason}`);

  // ── G5~G8 判决依据必须来自别人（v0.2 新增）────────────────────────────
  //
  // 上一版这里是 `spawnSync(chk.argv...)` —— **考官自己跑考试、又自己采信结果**。
  // 四道闸拦住了「作者给自己发证」，却没拦住「考官自己产生判决依据」，
  // 那是同一个病换了个位置：本仓库那条透镜叫**决策权与判断依据分离**。
  //
  // 所以判决依据改由第三个身份（取象 Agent）用 `observe` 子命令产生，
  // 考官只读不跑。**certify 这条路径上从此没有任何命令执行**（判据 O1 锁住）。
  const ob = target.observation || null;
  if (!ob) {
    refuse('no_observation',
      '没有观察记录。考官不许自己跑考试——那是「考官自己产生判决依据」，' +
      '与「作者给自己发证」是同一个病换了位置。先让取象 Agent 跑 `observe`');
  }
  if (!ob.observer?.fp || ob.observer.attested !== true) {
    refuse('observer_unattested',
      `观察者身份出处是 ${ob.observer?.source ?? 'none'}。判决依据的来源必须与考官同等可核，` +
      '否则只是把「谁都能说」从判决挪到了证据上');
  }
  // 观察者不能是作者（自己观察自己的活），也不能是考官（就退回上一版那个洞）
  if (ob.observer.fp === author.fp) {
    refuse('observer_is_author', '观察者与作者是同一个身份——自己干的活自己看，观察器退化成确认偏误机');
  }
  if (ob.observer.fp === examiner.fp) {
    refuse('observer_is_examiner', '观察者与考官是同一个身份——判决依据由判决者自己生产，等于没有分离');
  }
  // 考题改了，旧观察作废。否则改一道更好过的题、拿旧观察去发证，闸门全白设
  const rfp = recheckFingerprint(target.recheck);
  if (ob.recheck_fp !== rfp) {
    refuse('stale_observation',
      '观察记录对应的是另一道考题（recheck 已被修改）。改题之后必须重新观察');
  }
  // 一份观察只能用一次。不然一次通过的观察可以被反复拿来发证——
  // 「有过一次绿」和「现在是绿的」是两件事，这条与事实生命周期同源。
  if (ob.consumed_by) {
    refuse('observation_replayed',
      `这份观察已被 ${String(ob.consumed_by).slice(0, 8)}… 用过。一份观察只能发一次证，` +
      '否则一次通过可以被无限复用');
  }

  const result = ob.result;
  const detail = `[观察者 ${ob.observer.fp.slice(0, 8)}…] ${ob.detail || ''}`;

  // ── 写回：CAS 重试，只动这一条经验 ────────────────────────────────────
  const when = new Date().toISOString();
  let write = null;
  for (let attempt = 1; attempt <= MAX_CAS_RETRY; attempt++) {
    const cur = readState(p);
    const next = JSON.parse(JSON.stringify(cur.state));
    delete next.content_hash; delete next.actor;
    const j = findLearning(next, lid);
    if (j < 0) { write = { status: 'failed', reason: '写回时经验已不在盘上' }; break; }

    const updated = applyExam(next.learnings[j], result, { when, detail });
    // 考官身份进 exam 记录。**这是本闸门在学历上留下的唯一痕迹**——
    // 没有它，一份学历事后回答不了「这个 verified 是谁给的」。
    updated.exam.examiner = examiner;
    updated.exam.separation_strength = separation_strength;
    // 观察者也要落盘：事后要能回答「这个证依据的是谁的观察」，
    // 而不只是「谁签的字」。签字的和看东西的是两个人，账上就得是两个人。
    updated.exam.observer = ob.observer;
    // 核销这份观察：同一份观察不能发第二次证
    updated.observation = { ...(next.learnings[j].observation || ob), consumed_by: examiner.fp, consumed_at: when };
    next.learnings[j] = updated;

    const r = putState(p, next, { expect: cur.computed, actor: { by: 'agentteams/certify' } });
    if (r.status !== 'diverged') { write = { ...r, attempts: attempt }; break; }
    write = { ...r, attempts: attempt };
  }

  const after = readState(p).state.learnings[findLearning(readState(p).state, lid)];
  const rec = {
    kind: 'certify.result', verb: 'certify', decision: result,
    learning_id: lid, result, detail,
    examiner, author, separation_strength,
    status_now: after?.status ?? null,
    write,
  };
  rec.ledger = ledger({
    verb: 'certify.' + result, state: a.state, learning_id: lid,
    examiner, author, separation_strength, detail, status_now: rec.status_now,
  });

  humanTip({
    pass: `✅ 考试通过 → ${rec.status_now}（考官 ${examiner.fp}，作者 ${author.fp}）`,
    fail: `❌ 考试挂了 → ${rec.status_now}`,
    error: `⚠ 跑不起来，不升不降：${detail}`,
  }[result]);

  if (write && (write.status === 'denied' || write.status === 'failed')) out({ ...rec, reason: write.reason }, 4);
  out(rec, result === 'pass' ? 0 : result === 'fail' ? 3 : 4);
}

// ───────────────────────────── main ─────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || ['-h', '--help', 'help'].includes(cmd)) {
    process.stderr.write(USAGE + '\n');
    process.exit(cmd ? 0 : 1);
  }
  const a = parseArgs(argv.slice(1));
  if (cmd !== 'whoami' && (!a.state || a.state === true)) {
    process.stderr.write('错误：缺少 --state\n\n' + USAGE + '\n');
    process.exit(1);
  }
  if (cmd === 'whoami') return cmdWhoami();
  if (cmd === 'list') return cmdList(a);
  if (cmd === 'stamp') return cmdStamp(a);
  if (cmd === 'observe') return cmdObserve(a);
  if (cmd === 'certify') return cmdCertify(a);
  process.stderr.write(`未知子命令: ${cmd}\n\n${USAGE}\n`);
  process.exit(1);
}

main().catch(e => {
  process.stdout.write(JSON.stringify({ status: 'failed', reason: e.message }) + '\n');
  process.exit(4);
});
