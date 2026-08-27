// benjing-core.mjs — 本境协议 v0.2 共享核心（benjing/0.2）
// 一处实现，三处复用：SessionStart 加载、SessionEnd 归档、验证器。
// 设计约束来自实测缺陷，不是来自架构文档的论述：
//   ② version 曾是「开过几次会」的自证计数器 → 改由 content_hash 驱动
//   ④ 两个 harness 并发写学历会静默吃掉一条已验证事实 → putState 上乐观锁
//   ⑤ 状态文件里 0 个 actor/provenance 字段 → detectActor 只写可观测到的
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
// 「看世界」这件事交给专职观察者，本境不再自己实现一遍。
// 复盘结论：sha256/existsSync 曾在三个文件里各写一遍，每个部件自己当自己的观察者——
// 这正是「自证」在本仓库复发五次的结构性原因。
import { observe } from '../benxiang/observe.mjs';
import { checkState } from './schema-check.mjs';  // RFC-0010：写入闸门强制 schema 校验
// 循环引用（fact-core 反过来要本文件的 resolveSourceRefs/recheckSource）。
// 不拆成两个模块是刻意的：拆了就得把「哪些状态算活着」的判断复制一份，而两份判断
// 迟早会分叉——本仓库为「同一件事有两个真相」付过五次学费。ESM 处理得了这种环，
// 前提是两边都只在函数体里用对方、不在模块求值期用。判据 F5.3 把这个前提锁住：
// 任一侧先被加载都必须能跑通。
import { normalizeFactsForWrite } from './fact-core.mjs';
// 学堂定义「什么是考试」，学籍执行「谁有资格宣称考试结果」——判断依据与决策权分开。
// learning-core 不 import 本仓库任何东西（只用 node:crypto），所以这条不成环。
// 为什么必须在这里而不是在学堂：**它此前是死代码**。exam.mjs 第 26 行 import 了
// normalizeForWrite，全文一次都没调用；X2.1~X2.4 四条判据证明这个函数работает，
// 而写入路径上没有任何人调用它。实弹（demo/control-m0/probe-selfcert.mjs）：
// `{status:'verified', exam:{runs:0}}` 一路绿灯落盘，北桥还标着「已通过长循环考试」注入。
// 一个纯装饰的闸门，跟那份「没人加载的 schema」是同一个病。
import { normalizeForWrite as normalizeLearningsForWrite } from '../xuetang/learning-core.mjs';

export const SPEC = '2origin/0.2';
export const SPEC_ACCEPTED = ['2origin/0.1', '2origin/0.2']; // 向后兼容：v0.1 状态仍可读
export const SKIP_DIRS = new Set(['.claude', 'node_modules', '.git', '.svn', '.backups']);

// content_hash 不覆盖的字段：它们描述「这份记录本身」，不是「学到了什么」。
// actor 排除在外，否则换个 harness 原样存一次就会让 version 通胀 —— 那就是缺陷②换了个马甲。
const HASH_EXCLUDED = new Set(['version', 'updated_at', 'content_hash', 'actor']);

/** 稳定序列化：键排序，保证同样内容在任何机器上算出同一个哈希 */
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort()
    .map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

/** 学历内容指纹。version 不再自己 +1，由这个值变没变来决定 */
export function contentHash(state) {
  const body = {};
  for (const k of Object.keys(state)) if (!HASH_EXCLUDED.has(k)) body[k] = state[k];
  return crypto.createHash('sha256').update(canonical(body)).digest('hex');
}

export function detectHarness() {
  if (process.env.CLAUDECODE === '1' || process.env.CLAUDE_CODE_ENTRYPOINT) return 'claude-code';
  // Codex Desktop 不一定向子进程透传 CODEX_HOME / CODEX_SANDBOX；2026-08-13
  // 实测稳定存在的是 CODEX_THREAD_ID。漏掉它会把真实 Codex 写入记成 unknown，
  // 恰好让 provenance 在最需要跨 harness 交接时失真。
  if (process.env.CODEX_SANDBOX || process.env.CODEX_HOME || process.env.CODEX_THREAD_ID) return 'codex';
  // Hermes（第三个本机 harness）。2026-08-24 实测：它透传 HERMES_AGENT=true、
  // AI_AGENT=hermes-agent、HERMES_SESSION_ID；不认它就会把真实 Hermes 写入记成
  // unknown，B5.1 红灯——和上面 Codex 那条是同一个病：漏一个环境信号就失真一次。
  // 放在 vscode 前面：在 vscode 终端里跑 Hermes 时，更具体的身份优先。
  if (process.env.HERMES_AGENT === 'true' || process.env.AI_AGENT === 'hermes-agent') return 'hermes';
  if (process.env.TERM_PROGRAM === 'vscode') return 'vscode';
  return 'unknown';
}

/** 只读文件尾部 N 字节，transcript 可能很大，不整份读进来 */
function tailBytes(file, n = 262144) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, n);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}

const lastModelIn = txt => {
  const m = [...txt.matchAll(/"model"\s*:\s*"([^"]+)"/g)];
  return m.length ? m[m.length - 1][1] : null;
};

/**
 * 观测模型名（RFC-0005 §6.1 的举证缺口对策）。
 * v0.2 落成时写的是 unobserved，因为环境变量里确实没有。后来实测发现**磁盘上有**：
 *   Claude Code: ~/.claude/projects/<slug>/<session_id>.jsonl 里 "model":"claude-opus-5"
 *   codex:       ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl 的 session_meta 里 "model":"gpt-5.5"
 * 返回 { model, source }。source 是「证据的证据」：transcript 观测到的和环境变量声明的，
 * 可信度不一样，不能混作一谈。
 */
export function observeModel(transcriptPath = null) {
  const envModel = process.env.CLAUDE_MODEL || process.env.ANTHROPIC_MODEL
    || process.env.CODEX_MODEL || process.env.OPENAI_MODEL;

  const tryFile = f => {
    try { if (f && fs.existsSync(f)) return lastModelIn(tailBytes(f)); } catch { /* ignore */ }
    return null;
  };

  // 1) SessionEnd hook 直接给了 transcript_path，最可靠
  let m = tryFile(transcriptPath);
  if (m) return { model: m, source: 'transcript' };

  // 2) Claude Code：按 session_id 在 ~/.claude/projects/*/ 下找
  const sid = process.env.CLAUDE_CODE_SESSION_ID;
  if (sid) {
    const base = path.join(os.homedir(), '.claude', 'projects');
    try {
      for (const d of fs.readdirSync(base)) {
        const f = path.join(base, d, sid + '.jsonl');
        m = tryFile(f);
        if (m) return { model: m, source: 'transcript' };
      }
    } catch { /* ignore */ }
  }

  // 3) codex：找 cwd 对得上的最新 rollout
  try {
    const root = path.join(os.homedir(), '.codex', 'sessions');
    const stack = [root]; const found = [];
    while (stack.length) {
      const d = stack.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) stack.push(full);
        else if (/^rollout-.*\.jsonl$/.test(e.name)) found.push({ full, t: fs.statSync(full).mtimeMs });
      }
    }
    found.sort((a, b) => b.t - a.t);
    for (const { full } of found.slice(0, 8)) {
      const head = fs.readFileSync(full, 'utf8').slice(0, 4096);
      if (head.includes(process.cwd().replace(/\\/g, '\\\\')) || head.includes(process.cwd())) {
        const mm = lastModelIn(head);
        if (mm) return { model: mm, source: 'rollout' };
      }
    }
  } catch { /* ignore */ }

  // 4) 环境变量只是「声明」，排在观测之后，且如实标注来源
  if (envModel) return { model: envModel, source: 'env' };
  return { model: 'unobserved', source: 'none' };
}

/** 只记录可观测到的。观测不到的写 unobserved，不编 */
export function detectActor(transcriptPath = null) {
  const { model, source } = observeModel(transcriptPath);
  return {
    harness: detectHarness(),
    model,
    model_source: source, // transcript | rollout | env | none —— 证据的证据
    session_id: process.env.CLAUDE_CODE_SESSION_ID || process.env.CODEX_SESSION_ID
      || process.env.HERMES_SESSION_ID || '',
    at: new Date().toISOString()
  };
}

/**
 * 递归找出所有学历文件。
 * 缺陷⑥（本轮实测）：v0.1 只按文件名匹配，把 schemas/task.origin.json —— 那份 JSON Schema 本身 ——
 * 也当成了一份学历。只要它 mtime 最新，SessionStart 就会把 schema 当「上次任务状态」注入，
 * SessionEnd 还会往 schema 里塞 version/updated_at 字段。所以必须按 kind 认，不能按文件名认。
 */
export function scanStateFiles(root, depth = 0) {
  const res = { states: [], orphans: [] };
  if (depth > 5) return res;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return res; }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      const sub = scanStateFiles(full, depth + 1);
      res.states.push(...sub.states); res.orphans.push(...sub.orphans);
    } else if (e.name === 'task.origin.json') {
      let o = null;
      try { o = JSON.parse(fs.readFileSync(full, 'utf8')); }
      catch (err) { res.orphans.push({ path: full, reason: 'JSON 解析失败: ' + err.message.slice(0, 60) }); continue; }
      if (o && o.kind === 'task.origin') { res.states.push(full); continue; }
      // JSON Schema 本身天生不是学历，不该每次开会都被报成孤儿——
      // 假阳性会训练人忽略体检行，那等于把体检废掉。
      if (o && o.$schema && o.kind === undefined) continue;
      res.orphans.push({ path: full, reason: `kind=${JSON.stringify(o?.kind)}，本境认不出` });
    }
  }
  return res;
}

export function findStates(root, depth = 0) {
  return scanStateFiles(root, depth).states;
}

/**
 * 原子替换写（RFC-0005 §6.2 对策）：先写同目录临时文件，再 rename 覆盖。
 * 直接 writeFileSync 是「截断 + 逐段写」，中途崩溃会留下半截 JSON —— 学历直接报废。
 * rename 在同一卷上是原子的，读者要么看到旧的完整版，要么看到新的完整版。
 */
export function writeAtomic(p, text, { relock = false } = {}) {
  const tmp = p + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmp, text, 'utf8');
  const wasLocked = fs.existsSync(p) && isLocked(p);
  if (wasLocked) unlockState(p); // rename 覆盖只读目标同样 EPERM，必须先解锁
  try { fs.renameSync(tmp, p); }
  catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    if (wasLocked) lockState(p);
    throw e;
  }
  if (relock || wasLocked) lockState(p);
}

/**
 * 学历文件的只读位 —— harness 无关的强制点（RFC-0005 §6b.2 对策）。
 *
 * PreToolUse 硬拦截只在 Claude Code 生效；codex 只有 `notify`（turn-ended），
 * 做不出工具级拦截。而本机实测：Windows 只读位对 writeFileSync 覆盖、rename 覆盖、
 * appendFileSync 三种写法一律 EPERM —— 闸门下沉到文件系统就跟 harness 无关了。
 *
 * **这不是安全边界。** 任何有权限的进程都能 `attrib -R` 解除。它挡的是「不知情的写入者」
 * （手滑的 Write、codex 的 apply_patch、shell 重定向），不挡「故意绕过的写入者」。
 * 跟乐观锁一样，是协作机制，不是权限机制。
 */
export function isLocked(p) {
  try { return (fs.statSync(p).mode & 0o200) === 0; } catch { return false; }
}
export function lockState(p) {
  try { fs.chmodSync(p, 0o444); return true; } catch { return false; }
}
export function unlockState(p) {
  try { fs.chmodSync(p, 0o644); return true; } catch { return false; }
}

export function readState(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const state = JSON.parse(raw);
  return { state, raw, computed: contentHash(state) };
}

/**
 * 学历写入的唯一合法入口：乐观锁。
 * expect 是调用方开工时读到的 content_hash。盘上对不上就拒写 —— 因为对不上意味着
 * 期间有别人（另一个 harness / 手改）改过，直接覆盖就会静默吃掉对方的已验证事实（实测缺陷④）。
 * 语义和影核 v0.2 的 expect_sha256 一致：证明你读过当前内容，才准写。
 */
export function putState(p, next, { expect = null, actor = null } = {}) {
  // 乐观锁能识别「我读盘后，别人写过」；但两位写者若同时读到同一份内容，仍会
  // 一起通过 expect 并依次覆盖。锁必须包住**读 → 比 → 写 → 回读**整个临界区，
  // 而不是只包 writeAtomic 那一瞬间。锁名由绝对路径派生，避免不同学历互相串锁。
  //
  // Windows 锁身份必须**规范化物理路径**：NTFS 默认大小写不敏感，`demo/x` 与
  // `DEMO/X` 是同一文件，但 path.resolve 字符串不同 → 两把锁 → 两个进程可同时
  // 进临界区（sol R6 抓出）。realpathSync.native 拿到物理路径后小写归一，junction
  // 边界仍不可完全消除（需要的话在文档里声明），但大小写别名这一层必须堵住。
  let absolute = path.resolve(p);
  try { absolute = fs.realpathSync.native(absolute); } catch { /* 文件可能尚不存在：退回 resolve 结果 */ }
  const lockKey = absolute.toLowerCase();
  const lockPath = path.join(
    path.dirname(absolute),
    `${crypto.createHash('sha256').update(lockKey).digest('hex')}.lock`,
  );
  let lockFd;
  try {
    lockFd = fs.openSync(lockPath, 'wx');
  } catch (e) {
    // Windows 上另一个进程正 close/unlink 同一个 wx 锁时，Node 有时返回 EPERM
    // 而非 EEXIST；这仍是「没有取得锁」，不能误读成一般写入失败或放行继续写。
    if (e?.code === 'EEXIST' || e?.code === 'EPERM') {
      return {
        status: 'diverged',
        reason: '学历写入锁被并发占用（另一个进程正在写同一份学历）',
        disk_unchanged: true,
      };
    }
    return { status: 'failed', reason: '创建学历写入锁失败: ' + e.message, disk_unchanged: true };
  }

  try {
    // 取得锁后才读盘：等待锁期间可能已有写者完成，不能沿用任何锁前快照。
    let current = null;
    if (fs.existsSync(p)) {
      try { current = readState(p); }
      catch (e) { return { status: 'failed', reason: 'current state unparseable: ' + e.message }; }
    }

  if (current && expect !== null && expect !== current.computed) {
    return {
      status: 'diverged',
      reason: '盘上内容已变，expect 过期',
      expected: expect,
      actual: current.computed,
      disk_unchanged: true
    };
  }
  if (current && expect === null) {
    return { status: 'denied', reason: '写学历必须出示 expect（首次创建除外）', disk_unchanged: true };
  }

  // ── 写入前校验：乐观锁只证明「你读过」，不证明「你写的还是一份学历」 ──
  //
  // 2026-08-08 实测数据丢失：另一会话交上来的 next.json 只有 6 个字段
  // （无 kind/id/title/goal/current_state），putState 照单全收 —— task5 的已验证事实
  // 从 11 条掉到 3 条，且因为丢了 kind 而整份从本境消失。expect 是对的，所以一路绿灯。
  //
  // 这是「存在性检查冒充验证」的又一种形态：验了凭据，没验内容。**失败必须关门**。
  const REQUIRED = ['kind', 'id', 'goal', 'current_state', 'next_steps'];
  const missing = REQUIRED.filter(k => next[k] === undefined || next[k] === null || next[k] === '');
  if (next.kind !== undefined && next.kind !== 'task.origin') missing.push(`kind 应为 task.origin（实为 ${JSON.stringify(next.kind)}）`);
  if (missing.length) {
    return {
      status: 'denied',
      reason: `拒写：这不是一份完整的学历，缺 ${missing.join('/')}。`
        + `写学历必须「读盘 → 改 → 整份写回」，不能只交增量字段——缺的字段会被静默抹掉。`,
      missing, disk_unchanged: true
    };
  }
  // 别悄悄缩水。
  //
  // 第一版只拦 facts —— 那是修症状不是修那一类。事故的实际损失是
  // **11 条 facts + 2 条 decisions + 6 条 learnings + 3 条 artifacts**（task5 事后重建记录），
  // 而当时的护栏只看得见其中一样。凡是「只增不减为常态」的集合，缩水都要显式声明。
  const GUARDED = ['facts', 'decisions', 'actions', 'learnings', 'artifacts'];
  const allowLoss = next.__allow_loss || next.__allow_fact_loss; // 旧名保留兼容
  if (current && !allowLoss) {
    const shrunk = GUARDED
      .map(k => ({ k, was: (current.state[k] || []).length, now: (next[k] || []).length }))
      .filter(x => x.was > 0 && x.now < x.was);
    if (shrunk.length) {
      return {
        status: 'denied',
        reason: `拒写：${shrunk.map(x => `${x.k} 由 ${x.was} 降到 ${x.now}`).join('，')}。`
          + `若确实要删，请在提交对象里显式加 __allow_loss: true。`,
        shrunk, disk_unchanged: true
      };
    }
  }

  // ── schema 闸门（RFC-0010）──────────────────────────────────────────────
  //
  // 前面三道检查都是被真事故逼出来的，但它们之间有条缝：
  //   乐观锁 —— 证明「你读过盘上那份」，不证明「你写的还是一份学历」
  //   必填字段 —— 只查字段在不在，不查字段的**类型**
  //   缩水检查 —— 只查数组条数，不查数组元素的**形状**
  //
  // 两次实弹都是从这条缝里穿过去的：字段齐全、条数没少、expect 正确，只是类型错了。
  //   ① artifacts 写成 [{path,what}]（schema 要 string[]）→ 下游 reobserve / verify-state
  //      双双 ERR_INVALID_ARG_TYPE，数据不合规伪装成程序 bug
  //   ② codex 写入 source_kind="path+command"（不在允许集内）→ 无人报错
  //
  // 第②次来自另一个 harness。PreToolUse 那道硬拦截只在 Claude Code 生效，
  // codex 走的是合法通道，闸门放行。**缺陷的严重性不能只按本 harness 的暴露面估。**
  //
  // 校验器（schema-check.mjs）一直存在也一直好用，只是写入路径上没人调用它。
  // 不提供旁路开关：有开关的硬拦截等于没有硬拦截。
  const viol = checkState(next);
  if (viol.length) {
    return {
      status: 'denied',
      reason: `拒写：不合 schema（${viol.length} 处）。校验器一直存在，只是此前写入路径上没人调用它。`,
      schema_violations: viol,
      disk_unchanged: true
    };
  }

  // ── 事实生命周期闸门（学籍 fact/0.1）────────────────────────────────────
  //
  // 挂在 putState 而不是 benjing-put.mjs 那个 CLI，理由就写在上面 schema 闸门那段里：
  // **缺陷的严重性不能只按本 harness 的暴露面估**。PreToolUse 硬拦截只在 Claude Code
  // 生效，codex 走的是合法通道；闸门挂在 CLI 上，等于只拦住会看说明书的那个 harness。
  //
  // 拦的是「作者给自己发降级证」，两个方向：手写 stale 而无复核账本、
  // 以及复核账本说证据变了却手写回 active。后者更要命——那是用手写覆盖机器的观察结果。
  // 与学堂 normalizeForWrite 逐条对称，也与它一样**只压回不拒写**：
  // 拒写会让一次合法的事实追加因为另一条事实的状态问题而整份失败。
  const factGate = normalizeFactsForWrite(next.facts);
  const learnGate = normalizeLearningsForWrite(next.learnings);
  const adjusted = [
    ...factGate.adjusted.map(a => ({ kind: 'fact', what: a.claim, from: a.from, to: a.to, why: a.why })),
    ...learnGate.demoted.map(d => ({ kind: 'learning', what: d.lesson, from: 'verified', to: 'candidate', why: d.why })),
  ];
  if (adjusted.length) next = { ...next, facts: factGate.facts, learnings: learnGate.learnings };

  const body = { ...next };
  delete body.__allow_fact_loss;      // 这是一次性开关，不进学历、不进指纹
  delete body.__allow_loss;
  body.spec = SPEC; // 必须在算指纹之前定妥：spec 计入 content_hash，
                    // 先算后改会让回读指纹对不上——那就是这个函数自己要防的「声明与现实脱节」
  const newHash = contentHash(body);
  const prevHash = current ? current.state.content_hash : null;
  const changed = newHash !== prevHash;

  body.content_hash = newHash;
  // actor 是 provenance 字段。schema 里写着它存在的**理由**：
  // 「跨模型/跨 harness 继承学历是本架构的核心主张，但 v0.1 状态文件里 0 个
  //   provenance 字段，主张无从举证」。
  //
  // 而 v0.2 写的是 `actor || detectActor()` —— 调用方随手传个字符串标签
  // （'xuetang/exam'、'naming-review'）就能把观测到的 harness/model/model_source
  // 整个盖掉。实测代价：盘上 11 份学历有 8 份的 actor 是字符串，举证材料被擦掉了。
  //
  // 这是那条已验证经验在字段粒度上的复发：「让 agent 更新共享文档时，
  // 读—改—整份写回这个模式本身就危险——它把『我这次要加什么』悄悄换成了
  // 『这份文档应该长什么样』」。这里换的是『actor 应该长什么样』。
  //
  // 改法：调用方给的只能是**标签**，观测到的部分永远保留、永远不被覆盖。
  const observed = detectActor();
  body.actor = (actor && typeof actor === 'object')
    ? { ...observed, ...actor }
    : (actor ? { ...observed, by: String(actor) } : observed);
  body.version = changed ? ((current?.state.version || 0) + 1) : (current?.state.version || 1);
  body.updated_at = new Date().toISOString();

  // 覆盖前留物证。影核对 demo/ 下的普通文件都做备份，而更贵的学历一直裸奔——
  // 直到 task5 被残缺对象覆盖、8 条已验证事实无处可回，这个疏漏才付出代价。
  let backupPath = null;
  if (current) {
    try {
      const dir = path.join(path.dirname(path.dirname(path.resolve(p))), '.benjing-backups');
      fs.mkdirSync(dir, { recursive: true });
      backupPath = path.join(dir, `${Date.now()}-${path.basename(path.dirname(p))}-v${current.state.version || 0}.json`);
      fs.writeFileSync(backupPath, current.raw, 'utf8');
    } catch { backupPath = null; }
  }

  writeAtomic(p, JSON.stringify(body, null, 2), { relock: true });

  // 写完回头读一眼，不信 writeFileSync 没抛错就等于写成了（影核 v0.2 的教训）
  const after = readState(p);
  if (after.computed !== newHash) {
    return { status: 'failed', reason: '回读指纹不符', expected: newHash, actual: after.computed };
  }

  // ── 写侧披露清单（学籍 benjing/0.2）───────────────────────────────────────
  //
  // 北桥有一条铁律：**投影必须披露自己丢了什么**（判据组 N6），`compileRequest` 因此
  // 返回 manifest——正文给模型看，清单给判据看，两者同源。
  // 写侧一直是空白：闸门会替你改东西（把自封的 verified 压回 candidate、把手写的
  // active 压回 stale），却一声不吭。**一个会悄悄改写你提交内容的闸门，
  // 和一个会悄悄丢东西的投影是同一个病**——上一版的事实闸门就是我自己这么写的。
  //
  // 所以对称过来：写完必须说清「盘上多了什么少了什么、我替你改了什么、凭什么」。
  // 清单从**磁盘回读的那份**（after.state）取数，不从提交对象取——
  // 从提交对象取就是「统计者自己报自己」，那正是本仓库反复在抓的谎报。
  const COUNTED = ['facts', 'learnings', 'decisions', 'actions', 'artifacts', 'next_steps'];
  const counts = {};
  for (const k of COUNTED) {
    const was = (current?.state[k] || []).length;
    const now = (after.state[k] || []).length;
    if (was || now) counts[k] = { was, now, delta: now - was };
  }
  const manifest = {
    spec: SPEC,
    version: { from: current?.state.version ?? null, to: body.version },
    content_changed: changed,
    counts,
    adjusted,              // 闸门替调用方改的每一处；没改就是空数组，不许假装改过
    backup_path: backupPath,
  };
  return {
    status: changed ? 'done' : 'unchanged', content_hash: newHash, version: body.version,
    backup_path: backupPath, manifest,
  };
  } finally {
    try { fs.closeSync(lockFd); } catch { /* 已关闭或 close 失败时仍尝试清理锁文件 */ }
    try { fs.unlinkSync(lockPath); } catch { /* 不掩盖主写入结果；下次会 fail-closed 为 diverged */ }
  }
}

/**
 * 字段级写入 —— 「共享状态文件绝不能读进内存再整体写回」这条规矩的**可执行形态**。
 *
 * 为什么需要它：那条规矩 CLAUDE.md 早就写了，但在此之前**唯一的工具 `--from next.json`
 * 正是整体写回**。规矩说了别做的事，而工具只提供那一种做法——这跟「没人加载的 schema」
 * 同型：一条只存在于文档里的约束，等于不存在。
 *
 * 核心区分（整个部件立在这一句上）：**追加可交换，赋值不可交换。**
 *   - `append` → CAS 重试循环。两个并发追加顺序无关，重试必然收敛，两条都活。
 *   - `set`    → 单次 CAS，diverged 就报错交给人。**自动重试会静默盖掉别人刚写的值**，
 *                那正是本函数要治的病本身，不能在实现里复发一次。
 *
 * 铁律：**patchState 永不接收调用方手里的状态副本**——传 `state`/`expect` 进来直接抛错。
 * 与本象 `observe()` 永不接收预期同构：一旦接收内存副本，它立刻退化成整体写回。
 */
export const PATCH_APPEND_FIELDS = ['facts', 'learnings', 'decisions', 'actions', 'artifacts', 'next_steps'];
export const PATCH_SET_FIELDS = ['current_state', 'title', 'goal'];

export function patchState(p, ops, opts = {}) {
  const { actor = null, maxRetry = 5 } = opts;
  if ('state' in opts || 'expect' in opts) {
    throw new Error('patchState 不接收状态副本或 expect：它自己读盘自己写。'
      + '接收副本等于退回整体写回——那正是它要治的病。');
  }
  const list = Array.isArray(ops) ? ops : [ops];
  if (!list.length) return { status: 'denied', reason: '没有操作' };
  for (const o of list) {
    if (o.op === 'append') {
      if (!PATCH_APPEND_FIELDS.includes(o.field))
        return { status: 'denied', reason: `append 不允许写字段 ${o.field}`, allowed: PATCH_APPEND_FIELDS, disk_unchanged: true };
    } else if (o.op === 'set') {
      if (!PATCH_SET_FIELDS.includes(o.field))
        return { status: 'denied', reason: `set 不允许写字段 ${o.field}`, allowed: PATCH_SET_FIELDS, disk_unchanged: true };
    } else {
      return { status: 'denied', reason: `未知操作 ${JSON.stringify(o.op)}`, disk_unchanged: true };
    }
  }
  // 含 set 就不重试：赋值不可交换。只有纯 append 才允许重试收敛。
  const commutative = list.every(o => o.op === 'append');
  const limit = commutative ? Math.max(1, maxRetry) : 1;

  let last = null;
  for (let attempt = 1; attempt <= limit; attempt++) {
    let cur;
    try { cur = readState(p); }
    catch (e) { return { status: 'failed', reason: '读盘失败: ' + e.message }; }
    const next = JSON.parse(JSON.stringify(cur.state));
    delete next.content_hash; delete next.actor;
    for (const o of list) {
      if (o.op === 'append') next[o.field] = [...(next[o.field] || []), o.value];
      else next[o.field] = o.value;
    }
    const r = putState(p, next, { expect: cur.computed, actor });
    if (r.status !== 'diverged') return { ...r, attempts: attempt, commutative };
    last = r;
  }
  return {
    ...last, attempts: limit, commutative,
    reason: commutative
      ? `append 重试 ${limit} 次仍分歧：盘上有人在高频写`
      : 'set 不自动重试：赋值不可交换，重试会静默盖掉别人刚写的值——先读盘看清再决定'
  };
}

/**
 * 归档对账：内容没变就不该产生新版本号。
 * 这是缺陷②的对策 —— 旧 finalize 每次会话结束无脑 +1，实测「内容指纹一字未变，version 1→4」。
 * 返回 'unchanged' | 'bumped' | 'migrated'
 */
export function reconcile(p, transcriptPath = null) {
  let cur;
  try { cur = readState(p); } catch { return { path: p, result: 'unparseable' }; }
  const { state, computed } = cur;

  if (!state.content_hash) {
    // v0.1 老状态：补指纹，但不 +1 —— 内容没变过，只是以前没记指纹
    state.content_hash = computed;
    state.actor = state.actor || detectActor(transcriptPath);
    writeAtomic(p, JSON.stringify(state, null, 2), { relock: true });
    return { path: p, result: 'migrated', version: state.version, content_hash: computed };
  }
  if (state.content_hash === computed) {
    // 自愈：内容没变也要确保闸门还在。benjing-put 若在解锁后崩溃，只读位会留在关闭状态
    const relocked = isLocked(p) ? false : lockState(p);
    return { path: p, result: 'unchanged', version: state.version, content_hash: computed, relocked };
  }
  state.version = (state.version || 0) + 1;
  state.content_hash = computed;
  state.updated_at = new Date().toISOString();
  state.actor = detectActor(transcriptPath);
  writeAtomic(p, JSON.stringify(state, null, 2), { relock: true });
  return { path: p, result: 'bumped', version: state.version, content_hash: computed };
}

/**
 * 学历体检：便宜的、每次归档都能跑的不变量检查。
 * 上一版的教训是「verify-state 坏了不知多久，对全部三份状态误报缺失」——
 * 一个从不被运行的验证器等于没有。所以把最便宜的那几条做成每次 SessionEnd 都跑，
 * 结果写盘，下次 SessionStart 直接在 bundle 头部亮出来。
 */
export function health(root) {
  const items = [];
  // 孤儿：文件名对得上、但本境认不出的 task.origin.json。
  // 实测（sed -i 把 "kind":"task.origin" 改成 "TASK.origin"）：那份学历直接从本境消失，
  // 而体检照报「全部健康」—— **对「消失的学历」是瞎的，比对「被改的学历」瞎更危险**。
  const scan = scanStateFiles(root);
  const orphans = scan.orphans.map(o => ({ ...o, path: path.relative(root, o.path).replace(/\\/g, '/') }));
  for (const p of scan.states) {
    let st;
    try { st = readState(p); } catch { items.push({ path: p, parse_error: true }); continue; }
    const { state, computed } = st;
    const vf = (state.facts || []).filter(f => f.verified);
    const bad = vf.filter(f => !recheckSource(f.source).ok);
    // 悬空 source：形式合格，但引的东西现在不在盘上了。只报数不判假——见 dereferenceSource
    //
    // 分两桶，判据从 recheckSource 的分类里长出来，不是关键词拍脑袋：
    //   路径没了、但 source 还引了命令/用例编号 → 证据仍可重跑，路径只是中间产物（本仓库
    //     6 条悬空全属此类：写探针文件 → 观察 → 删，claim 依然为真）。
    //   路径没了、而路径是这条 source 里**唯一**可复核物 → 证据现在无法到达，这才该亮灯。
    // 这样「⚠」才有信息量；对一切都报警的探针等于什么都没测（v0.2 泄题那次的同一课）。
    const dangling = [], danglingWithFallback = [];
    for (const f of vf) {
      const d = dereferenceSource(f.source, root);
      if (!d.missing.length) continue;
      const kinds = String(recheckSource(f.source).kind || '');
      const rerunnable = kinds.includes('command') || kinds.includes('testcase');
      const rec = { claim: String(f.claim).slice(0, 40), missing: d.missing };
      (rerunnable ? danglingWithFallback : dangling).push(rec);
    }
    // 走本象观察：顺带拿到 sha256，让「产物内容变没变」在账本里可比对——
    // 原来这里是 existsSync，那本身就是一次「存在性检查冒充验证」。
    const artifactObs = (state.artifacts || []).map(a => {
      let o = observe(a, root);
      if (!o.properties.exists) o = observe(path.resolve(path.dirname(p), a), root);
      return { artifact: a, exists: !!o.properties.exists, sha256: o.properties.sha256 || null };
    });
    const missingArtifacts = artifactObs.filter(x => !x.exists).map(x => x.artifact);
    items.push({
      path: path.relative(root, p).replace(/\\/g, '/'),
      version: state.version,
      in_sync: state.content_hash ? state.content_hash === computed : null,
      locked: isLocked(p), // 只读位掉了 = harness 无关的那道闸门失效了
      // schema 违规不拦写（那会卡住并发会话的正常工作），但必须看得见：
      // 一份没人校验的 schema 是装饰品，而只校验不上报等于没校验。
      schema_issues: (() => { try { return checkState(state).map(x => (x.at || '(顶层)') + ': ' + x.msg); } catch { return []; } })(),
      verified_facts: vf.length,
      unverifiable_sources: bad.map(f => String(f.claim).slice(0, 40)),
      dangling_sources: dangling,
      dangling_with_fallback: danglingWithFallback,
      missing_artifacts: missingArtifacts,
      actor: state.actor || null
    });
  }
  const issues = items.filter(i => i.parse_error || i.in_sync === false || i.locked === false || (i.schema_issues || []).length
    || (i.unverifiable_sources || []).length || (i.missing_artifacts || []).length
    || (i.dangling_sources || []).length);
  return {
    at: new Date().toISOString(),
    states: items.length,
    issues: issues.length + orphans.length,
    orphans,
    items
  };
}

/**
 * source 形式复核（缺陷③对策）。
 * 旧 verify-state 的 CHECK2 只看 source 字段非空 —— 实测把 9 条 source 全换成
 *「我说的，不信拉倒」，判决依然 ✅ VERIFIED。那不是验证，是存在性检查。
 *
 * 判据是「引没引可复核物」，不是「可复核物现在还在不在」：
 * 很多 fact 描述的恰恰是「文件被删了 / 命令报错了」，要求路径存在会把真事实判成假。
 */
export function recheckSource(source) {
  const s = String(source || '');
  if (!s.trim()) return { ok: false, kind: 'missing', hint: 'source 为空' };
  const hits = [];
  // py 是 2026-08-09 补的：bench 接第三方 memory 系统（mem0）时进来了 Python，
  // 而白名单里没有 .py —— 于是引用 bench/mem0_arm.py 的三条真事实被判「不可复核」。
  // 跟下面用例编号那段是同一个病：**规则按当时见过的东西写死，仓库长出新东西就滞后**。
  // 这次仍然只是补一项而不是改成通配，因为「任意 .xxx 都算路径」会把
  //「exit code 0.0」这类噪音也认成可复核物，那等于把判据放空。
  const pathRe = /[\w./\\-]+\.(mjs|js|json|md|log|jsonl|txt|toml|yaml|yml|sh|ps1|py)\b/g;
  // hermes 是本机的第三个 harness，跨 harness 验证时是一等的可复核命令，跟 codex/claude 同级
  const cmdRe = /\b(node|npm|npx|git|ls|cat|wc|tail|head|grep|rm|touch|find|curl|codex|claude|hermes|python)\b/;
  // 用例编号：影核 T*、本境 B*、本象 X*。
  // 前两次是补一个字母（T→TB→TBX），补第三次时就该承认这是个会持续滞后的规则——
  // 每加一个验证器都要回来改一次检查器，而中间那段时间新验证器的产出全被判不可复核。
  // 改成通配「大写字母 + 数字」，让规则不再随部件增长。
  const caseRe = /\b[A-Z]\d+(\.\d+)?\b/;
  const p = s.match(pathRe);
  if (p) hits.push({ kind: 'path', refs: [...new Set(p)] });
  if (cmdRe.test(s)) hits.push({ kind: 'command', refs: [s.match(cmdRe)[0]] });
  if (caseRe.test(s)) hits.push({ kind: 'testcase', refs: [s.match(caseRe)[0]] });
  if (!hits.length) {
    return { ok: false, kind: 'unverifiable', hint: '未引用任何可复核物（文件/命令/验证用例编号），只是一句自然语言断言' };
  }
  return { ok: true, kind: hits.map(h => h.kind).join('+'), refs: hits.flatMap(h => h.refs) };
}

/**
 * 路径别名表 —— 命名裁决留下的**常设部件**，不是迁移工具。
 *
 * 为什么是常设的：16 份锚点快照与 110 份学历备份里的旧名**永远不能改**（改一个字节 `.ots`
 * 立刻失效，那批比特币时间锚全部作废）。所以新旧名不是「过渡期共存」，是**永久共存**——
 * 别名表就是这个永久事实的可执行形态。裁决见 2origin-computer/NAMING-DECISION.md §2。
 *
 * **铁律：只做显式前缀替换，列表逐条写死。** 模糊匹配会让别名表退化成万能通行证——
 * 那时任何不存在的路径都能被「解引用成功」，而一个对什么都放行的探针等于没装探针
 * （同型：判据 X8「一份坏学历不得让观察器对其余全部失明」）。
 */
export const PATH_ALIASES = [
  { from: 'benxiang/', to: 'quxiang/', decision: '取象 Quxiang · Sensor' },
  { from: 'southbridge/benjing-', to: 'southbridge/xueji-', decision: '学籍 Xueji · State Layer' }
];

/**
 * 一个相对路径的全部合法写法：原样 + 每条别名的**两个方向**。
 *
 * 双向是必需的，不是对称美：旧 source 指旧名而文件已改名（旧→新），
 * 而锚点快照里的路径永远是旧名、核验时盘上却是新名（也是旧→新）；
 * 反过来，新写的文档指新名而目录尚未改（新→旧）——本仓库当前正处在这个状态。
 */
export function aliasCandidates(rel) {
  const out = [rel];
  for (const a of PATH_ALIASES) {
    if (rel.startsWith(a.from)) out.push(a.to + rel.slice(a.from.length));
    if (rel.startsWith(a.to)) out.push(a.from + rel.slice(a.to.length));
  }
  return [...new Set(out)];
}

/**
 * source 解引用：把 source 里引用的路径真去看一眼还在不在。
 *
 * 催生它的那次：另一个会话删掉 bench/run-final*.log，六条 source 当场悬空，
 * 而 recheckSource 全绿——它查的是「引没引可复核物」（见上方注释），
 * 不是「那东西还在不在」。两次独立的会话都是靠人肉撞见的。
 *
 * **这里只观察，不判决**：悬空 ≠ 事实为假。很多 fact 讲的正是「这东西没了」，
 * B3.3 把「不许因路径不存在就判假」锁死了，这条不能动。所以本函数返回的是数，
 * 不是判断——由体检和 verify-state 亮出来，由人/AI 决定它意味着什么。
 * （决策权与判断依据分离：查的人给依据，不替决定的人做决定。）
 *
 * 三条克制，都是被以前的误报教出来的：
 *  - 光秃秃的文件名（不含目录分隔符）不查：`results-v2.json` 解析不到唯一位置，
 *    查它只会造噪音。这是「对账器拿 A 协议的账查 B 协议」那次误报的同型预防。
 *  - 只查 verified fact 的 source：候选事实本来就允许指向还不存在的东西。
 *  - 看世界只走本象 observe()，不自己写 existsSync——existsSync 本身就是一次
 *    「存在性检查冒充验证」，health() 里已经为此改过一回。
 */
export function dereferenceSource(source, root) {
  const { refs, resolved, skipped } = resolveSourceRefs(source, root);
  const missing = resolved.filter(r => r.status === 'missing').map(r => r.ref);
  const unresolved = resolved.filter(r => r.status === 'unresolved').map(r => r.ref);
  return { refs, checked: refs.length, missing, unresolved, skipped };
}

/**
 * 解引用的**唯一实现**：把 source 里的路径找到盘上的哪一个绝对路径。
 *
 * 从 dereferenceSource 里抽出来，不是重构洁癖：钉证据指纹（fact-core 的 pinEvidence）
 * 需要的是**解析后的绝对路径**，而旧版只往外吐「存不存在」。不抽的话第二个调用方
 * 就得把这段 ~ / 盘符 / 别名表 / 基准目录的判断再抄一遍——而「sha256/existsSync 在三个
 * 文件里各写一遍」正是 RFC-0006 §0 记下的那个结构性病根。抄一份就有两个真相。
 *
 * 每条 ref 返回 status ∈ found | missing | unresolved，found 时带 resolved 绝对路径。
 * 语义与旧版逐条对齐（missing/unresolved 的判法一字未改），dereferenceSource 现在只是它的投影。
 */
export function resolveSourceRefs(source, root) {
  const s = String(source || '');
  // 字符类必须含 : ~ 和中日韩字符，否则 `C:/Users/...` 被切成 `/Users/...`、
  // `~/.uking/x.json` 被切成 `/.uking/x.json`——两者在 Windows 上都被 isAbsolute 判真，
  // 于是去 D:\ 根下找，必然报「不存在」。首版实测 32 条悬空里有 4 条是这么造出来的。
  const pathRe = /[\w~:.\u4e00-\u9fa5/\\-]+\.(mjs|js|json|md|log|jsonl|txt|toml|yaml|yml|sh|ps1)\b/g;
  const raw = [...new Set((s.match(pathRe) || []).map(x => x.replace(/^[:~]?(?=[\\/])/, m => m)))];
  const refs = raw.filter(r => /[\\/]/.test(r));   // 光秃秃的文件名不查
  const resolved = [];
  for (const r of refs) {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    if (r.startsWith('~/') || r.startsWith('~\\')) {
      if (!home) { resolved.push({ ref: r, status: 'unresolved', resolved: null }); continue; }
      const abs = path.resolve(home, r.slice(2));
      resolved.push(observe(abs, root).properties.exists
        ? { ref: r, status: 'found', resolved: abs }
        : { ref: r, status: 'missing', resolved: null });
      continue;
    }
    if (path.isAbsolute(r) && /^[a-zA-Z]:/.test(r)) {                 // 带盘符才算真绝对路径
      resolved.push(observe(r, root).properties.exists
        ? { ref: r, status: 'found', resolved: r }
        : { ref: r, status: 'missing', resolved: null });
      continue;
    }
    // 相对路径：只有当**基准目录能被确认**时才敢说「不存在」。
    // 判法是看第一段目录在不在——`demo/...` 的 demo 在 root 下，基准确认，缺文件就是真缺；
    // `bench/...` 的 bench 既不在 root 也不在兄弟层，那是隔壁仓库的相对路径，
    // 我们不知道它相对谁，报 unresolved 而不是 missing。
    // 首版把这 16 条一律算成悬空——探针对什么都报警就等于什么都没测。
    const rel = r.replace(/^[./\\]+/, '');
    // 别名表（见 PATH_ALIASES）：改过名的部件，旧 source 仍须能解引用。
    // 基准目录的判断也要走别名——否则 `benxiang/` 改名后第一段目录不在了，
    // 会被判成 unresolved（「不知道相对谁」）而不是解引用成功，那是把改名说成环境问题。
    const cands = aliasCandidates(rel);
    const bases = [root, path.resolve(root, '..')]
      .filter(b => cands.some(c => observe(path.join(b, c.split(/[\\/]/)[0]), root).properties.exists));
    if (!bases.length) { resolved.push({ ref: r, status: 'unresolved', resolved: null }); continue; }
    let hit = null;
    for (const b of bases) {
      for (const c of cands) {
        const abs = path.resolve(b, c);
        if (observe(abs, root).properties.exists) { hit = abs; break; }
      }
      if (hit) break;
    }
    resolved.push(hit ? { ref: r, status: 'found', resolved: hit } : { ref: r, status: 'missing', resolved: null });
  }
  return { refs, resolved, skipped: raw.length - refs.length };
}
