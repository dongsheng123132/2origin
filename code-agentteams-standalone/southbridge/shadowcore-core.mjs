// shadowcore-core.mjs — 影核动作核心（shadowcore/0.2）
//
// 「一核多影」的核。所有驱动（MCP / CLI / 未来的 HTTP）共用这一份逻辑：
// 同样的风险判级、同样的批准规则、同样的写后观察、同样的 action.result。
// 驱动只负责传输与呈现，不得自己判风险、不得自己决定 status。
//
// 为什么现在才抽核心：RFC-0004 §5 曾明确拒绝「一核多影」，理由是只有 1 个 driver
// 时属过早抽象。2026-08-08 实测出 MCP 通道被 harness 的工具审批闸门整体堵死
// （南桥 audit.log 零记录），第二条通道才有了存在的必要——抽象的理由是实测，不是对称美。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');              // ShadowOS 根
export const SPEC = 'shadowcore/0.2';

const ALLOWED = [path.resolve(ROOT, 'demo')];              // 白名单：只允许 demo/ 下写
// 路径可被环境变量覆盖：验证器要制造"审计不可写"这类故障场景，不能只能靠改代码
const AUDIT_LOG = process.env.SHADOWCORE_AUDIT_LOG || path.join(here, 'audit.log');
const LEDGER = process.env.SHADOWCORE_LEDGER || path.join(here, 'idempotency.jsonl');
const LEDGER_LEGACY = path.join(here, 'idempotency.json');  // v0.2 早期格式，只读兼容
const LEDGER_MAX = Number(process.env.SHADOWCORE_LEDGER_MAX || 500);
const BACKUP_DIR = path.join(here, '.backups');

// 受保护路径：即使在白名单内，覆盖也算 high risk（学历文件、协议文件、代码）
const PROTECTED = [/task\.origin\.json$/, /\.mjs$/, /^schemas\//, /^\.claude\//];

// ───────────────────────── 本象观察：唯一的事实来源 ─────────────────────────
// 不信"我说我写了"，回头看磁盘。这是 evidence 与 status 的唯一依据。
export function observe(absPath) {
  try {
    const st = fs.statSync(absPath);
    if (!st.isFile()) return { exists: false, reason: 'not-a-file' };
    const buf = fs.readFileSync(absPath);
    return {
      exists: true,
      size_bytes: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      mtime: st.mtime.toISOString()
    };
  } catch {
    return { exists: false, size_bytes: 0, sha256: null, mtime: null };
  }
}

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

// ───────────────────────── 区间观察：只看「我造成的那一段」 ─────────────────────────
// observe() 看的是整个文件的快照，对覆盖写够用；但 append 只改动了文件末尾一段，
// 拿整文件 sha 去判「我那次追加还在不在」是把快照当差分用（RFC-0004 §6.3 实测缺陷）。
// 复现：node southbridge/probe-append-idempotency.mjs
export function observeRange(absPath, offset, length) {
  try {
    const buf = fs.readFileSync(absPath);
    if (buf.length < offset + length) {
      return { present: false, reason: 'file-shorter-than-footprint', file_size: buf.length };
    }
    const slice = buf.subarray(offset, offset + length);
    return {
      present: true,
      sha256: crypto.createHash('sha256').update(slice).digest('hex'),
      file_size: buf.length
    };
  } catch {
    return { present: false, reason: 'unreadable', file_size: 0 };
  }
}

// actor 由驱动传入，审计日志因此能回答「这次写是从哪条通道进来的」——
// 跨层 Trust 的排查全靠它（实测中正是审计零记录定的责）。
// 返回值不是装饰：审计写失败必须能被上层看见，见 doWrite 的 fail-closed 闸门。
function logAudit(actor, entry) {
  const line = JSON.stringify({ t: new Date().toISOString(), actor, spec: SPEC, ...entry });
  try { fs.appendFileSync(AUDIT_LOG, line + '\n'); return true; }
  catch (e) {
    try { process.stderr.write(`[southbridge] 审计写入失败: ${e.message}\n`); } catch { /* stderr 也没了就算了 */ }
    return false;
  }
}

// ───────────────────────── 幂等账本：追加式，不读改写 ─────────────────────────
// v0.2 初版用 JSON 对象整体读改写，两个会话并发就丢记录——而丢一条幂等记录
// 意味着后续重放会真的把世界再改一次。本机「多会话并发是常态」，这是必然会踩的。
// 改成 JSONL 追加：写入只 append 一行，读取时后写覆盖先写。没有读改写窗口。
function readLedger() {
  const map = {};
  // 只读兼容早期 idempotency.json
  try {
    const legacy = JSON.parse(fs.readFileSync(LEDGER_LEGACY, 'utf8'));
    for (const [k, v] of Object.entries(legacy)) map[k] = v;
  } catch { /* 没有就算了 */ }
  try {
    for (const line of fs.readFileSync(LEDGER, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const e = JSON.parse(line); if (e && e.key) map[e.key] = e; } catch { /* 坏行跳过 */ }
    }
  } catch { /* 没有就算了 */ }
  return map;
}

function appendLedger(entry, actor) {
  try {
    fs.appendFileSync(LEDGER, JSON.stringify(entry) + '\n', 'utf8');
    compactLedgerIfNeeded(actor);
    return true;
  } catch { return false; }
}

// 压缩：账本只增不删会无限长。按「最近活跃」保留 LEDGER_MAX 个 key，tmp+rename 原子换掉。
//
// 代价要说清楚：被淘汰的老 key 再重放时命中不到账本，会**真的再执行一次**。
// 对 mode=write 影响不大（同内容同结果），对 mode=append 会重复追加。
// 所以淘汰不是静默的——记一条审计，让事后能查到"这些 key 的幂等保证从此不成立"。
function compactLedgerIfNeeded(actor) {
  try {
    const lines = fs.readFileSync(LEDGER, 'utf8').split('\n').filter(l => l.trim());
    if (lines.length <= LEDGER_MAX) return;

    // 从最新往回收集，保留最近活跃的 LEDGER_MAX 个 key
    const kept = [], seen = new Set();
    for (let i = lines.length - 1; i >= 0 && seen.size < LEDGER_MAX; i--) {
      try {
        const e = JSON.parse(lines[i]);
        if (e?.key && !seen.has(e.key)) { seen.add(e.key); kept.unshift(e); }
      } catch { /* 坏行跳过 */ }
    }
    const allKeys = new Set();
    for (const line of lines) { try { const k = JSON.parse(line)?.key; if (k) allKeys.add(k); } catch { /* skip */ } }
    const evicted = [...allKeys].filter(k => !seen.has(k));

    const tmp = LEDGER + '.tmp';
    fs.writeFileSync(tmp, kept.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    fs.renameSync(tmp, LEDGER);

    if (evicted.length) {
      logAudit(actor || 'shadowcore', {
        kind: 'ledger.compact', status: 'done', kept: kept.length,
        evicted_count: evicted.length, evicted_keys: evicted.slice(0, 20),
        note: '被淘汰 key 的幂等保证从此不成立，重放会真的再执行一次'
      });
    }
  } catch { /* 压缩失败不影响正确性，只是文件偏大 */ }
}

// ───────────────────────── 风险判级：纯函数，不看模型怎么说 ─────────────────────────
// 判据只有三个客观输入：目标在不在白名单、目标存不存在、目标是不是受保护路径。
export function assessRisk(relpath, absPath, mode) {
  const norm = relpath.replace(/\\/g, '/');
  const inWhitelist = ALLOWED.some(d => absPath === d || absPath.startsWith(d + path.sep));
  if (!inWhitelist) return { risk: 'denied', reason: '目标不在白名单 demo/ 下' };

  const exists = fs.existsSync(absPath);
  if (PROTECTED.some(re => re.test(norm)) && exists) {
    return { risk: 'high', reason: '受保护路径（学历/协议/代码），覆盖需显式批准' };
  }
  if (mode === 'write' && exists) {
    return { risk: 'medium', reason: '覆盖已存在文件，属破坏性写' };
  }
  return { risk: 'low', reason: mode === 'append' ? '追加写' : '新建文件' };
}

// ───────────────────────── 批准的出处（RFC-0009）─────────────────────────
// 观察本进程处在什么上下文里。**必须由核心自己观察，不能由驱动声明**——
// 若把这个检查放进 CLI，叛徒驱动跳过它即可，那是把 RFC-0009 §1 的 R3 原样复现。
// 返回的是观察结果，调用方传什么都不影响它。
export function observeApprovalContext() {
  return {
    tty: !!process.stdin.isTTY,
    headless_override: process.env.SHADOWCORE_HEADLESS_CONFIRM === '1'
  };
}

// 批准判定：low 自动放行；medium/high 必须出示凭据。
//
// 两种凭据的可伪造性根本不同，v0.2 初版却一视同仁（RFC-0009 §2 实测）：
//   expect_sha256      —— **自证的**。核心拿 before.sha256 一比就知真假；驱动想伪造
//                         就必须真去读文件，而真读了就真满足了"证明你读过"。
//   approval:"confirm" —— **无出处**。核心分不清"人点了确认"和"驱动打了这五个字母"。
// 后果不是写错文件，是事后定责会定到人头上：审计白纸黑字写着"人在环确认"。
//
// 所以 confirm 现在需要一个无头通道拿不到的东西。逃生门保留（见下），
// 因为目的不是禁止自动化自批，是**让审计能区分谁批的**——堵死只会让人改代码，更查不到。
export function checkApproval(risk, before, args, ctx = observeApprovalContext()) {
  if (risk === 'low') return { ok: true, approval: 'auto', approval_evidence: null };

  const { expect_sha256, approval } = args;
  if (expect_sha256) {
    if (expect_sha256 === before.sha256) {
      return { ok: true, approval: 'expect_sha256', approval_evidence: { source: 'expect_sha256', self_proving: true, human: null } };
    }
    return { ok: false, approval: 'expect_sha256', reason: `expect_sha256 不匹配：目标当前 ${before.sha256}` };
  }

  if (approval === 'confirm') {
    if (ctx.tty) {
      return { ok: true, approval: 'confirm', approval_evidence: { source: 'interactive_tty', self_proving: false, human: true } };
    }
    if (ctx.headless_override) {
      // 放行，但审计从此写着 human:false —— 这条记录就是本次修复的全部意义
      return {
        ok: true, approval: 'confirm',
        approval_evidence: {
          source: 'headless_override', self_proving: false, human: false,
          note: '非人工确认：由 SHADOWCORE_HEADLESS_CONFIRM=1 放行，不得据此认定有人批准过'
        }
      };
    }
    return {
      ok: false, approval: 'confirm',
      approval_evidence: { source: 'none', self_proving: false, human: false },
      reason: 'approval:"confirm" 的语义是人在环显式确认，但本进程 stdin 不是 TTY（无头通道）。' +
              '改用 expect_sha256（自证的凭据），或显式设 SHADOWCORE_HEADLESS_CONFIRM=1 —— 后者会在审计里记为非人工批准'
    };
  }

  return { ok: false, approval: 'none', reason: `risk=${risk} 需要 expect_sha256（乐观锁）或 approval:"confirm"` };
}

// ───────────────────────── 动作执行 ─────────────────────────
export function doWrite(args, actor = 'shadowcore') {
  const { relpath, content = '', mode = 'write', idempotency_key = null } = args;
  const actionId = 'act:' + crypto.randomUUID().slice(0, 8);
  const target = path.resolve(ROOT, relpath || '');

  const base = {
    spec: SPEC, kind: 'action.result', action_id: actionId,
    verb: mode === 'append' ? 'file.append' : 'file.write',
    target: relpath, idempotency_key
  };

  if (!relpath) {
    const r = { ...base, status: 'denied', reason: 'relpath 为空' };
    logAudit(actor, r);
    return r;
  }

  // ── 幂等闸门：同 key 重放直接返回原 evidence，不再动世界
  const reqHash = sha256(`${relpath}\0${mode}\0${content}`);
  if (idempotency_key) {
    const ledger = readLedger();
    const prev = ledger[idempotency_key];
    if (prev) {
      if (prev.request_hash === reqHash) {
        // 账本也要回头观察，否则它就是新的"声明与现实脱节"来源：
        // 账本说 done，磁盘上文件可能已被外部删除/改写。幂等 ≠ 可以不看世界。
        const now = observe(target);

        // 观察对象要跟动作的作用范围对齐：
        //   覆盖写 → 语义是"整个文件应等于我写的内容"，比整文件 sha 是对的
        //   追加写 → 语义只是"我那段在文件里的原位"，别人继续追加是合法的，不构成 diverged
        // 用整文件 sha 判追加，会把正常的并发追加误判成 diverged；调用方按退出码 4 重试，
        // 同一段内容就被写了两次——幂等机制亲手诱发它本要防的重复写（§6.3，2/2 场景实测复现）。
        const fp = prev.result?.footprint ?? null;
        const seen = fp ? observeRange(target, fp.offset, fp.length) : null;
        const hit = fp
          ? (now.exists && seen.present && seen.sha256 === fp.sha256)
          : (now.exists && now.sha256 === prev.result?.evidence?.sha256);   // 无 footprint 的旧账本记录：退回整文件比对

        if (hit) {
          logAudit(actor, { ...base, status: 'replayed', of: prev.action_id, scope: fp ? 'footprint' : 'whole-file' });
          return {
            ...prev.result, status: 'replayed', action_id: actionId, replayed_of: prev.action_id,
            // evidence 必须是此刻的观察，不能把首次动作时的旧快照当现状交出去——
            // 那正是 v0.1 缺陷①的形状。footprint_observed 才是"重放判定"的依据。
            evidence: now,
            ...(fp ? { footprint_observed: seen } : {})
          };
        }
        const r = {
          ...base, status: 'diverged',
          reason: fp
            ? '这次追加的那段已不在原位（被截断或改写），不能声称重放成功'
            : '幂等账本与磁盘现实不符：目标已被外部删除或改写，不能声称重放成功',
          ledger_evidence: prev.result?.evidence ?? null, evidence: now, replayed_of: prev.action_id,
          ...(fp ? { footprint: fp, footprint_observed: seen } : {})
        };
        logAudit(actor, { ...r, ledger_evidence: undefined });
        return r;
      }
      const r = { ...base, status: 'denied', reason: 'idempotency_key 已用于不同请求（key 冲突）' };
      logAudit(actor, r);
      return r;
    }
  }

  // ── 风险与批准闸门
  const before = observe(target);
  const { risk, reason: riskReason } = assessRisk(relpath, target, mode);
  if (risk === 'denied') {
    const r = { ...base, status: 'denied', risk: 'denied', reason: riskReason };
    logAudit(actor, r);
    return r;
  }
  const appr = checkApproval(risk, before, args);
  if (!appr.ok) {
    const r = {
      ...base, status: 'requires_approval', risk, approval: appr.approval,
      approval_evidence: appr.approval_evidence ?? null,
      reason: appr.reason, riskReason,
      current: { sha256: before.sha256, size_bytes: before.size_bytes, exists: before.exists }
    };
    logAudit(actor, { ...r, current: undefined });
    return r;
  }

  // ── 批准绑定哪一笔改动（RFC-0009 §9；外部对照 arXiv:2607.10487 "bound to the same effect"）
  //
  // 缺口：checkApproval 从头到尾没见过 content。
  //   expect_sha256 证明的是「你读过**改前**的样子」，不是「你要写的是**这一笔**」。
  //   TTY confirm 证明的是「有人在终端」，同样不绑内容。
  // 于是审计事后问「这次批准绑定的是哪笔改动」——答不上来。
  //
  // bound_effect 由**核心自己算**（核心手里有 content），驱动传什么都不影响它。
  // 这跟 observeApprovalContext 是同一条原则：审计记观察，不记声明。
  // 仍然「不是阻止，是定责」——它不拦任何写，它让事后能对上账：
  // 批准绑的 effect hash 是 H_e，盘上留下的是什么，两者能不能对上。
  // 只在确实出示过凭据时才绑：low 风险走 auto，没有批准可绑。
  const boundEffect = {
    sha256: sha256(content),
    bytes: Buffer.byteLength(content, 'utf8'),
    mode, target: relpath
  };
  const approvalEvidence = appr.approval_evidence
    ? { ...appr.approval_evidence, bound_effect: boundEffect }
    : null;

  // ── 审计闸门（fail-closed）：动世界之前先记 intent，记不下就不动
  // 「所有关键 Action 必须可审计」不是口号。审计写不进去还照做，等于这次动作
  // 事后无法定责——而定责恰恰是本协议唯一一次真正救过场的能力（§6.6 靠审计零记录定的责）。
  if (!logAudit(actor, {
    ...base, kind: 'action.intent', status: 'pending', risk,
    approval: appr.approval, approval_evidence: approvalEvidence
  })) {
    const r = {
      ...base, status: 'denied', risk, approval: appr.approval,
      approval_evidence: appr.approval_evidence ?? null,
      reason: '审计不可写，按 fail-closed 拒绝执行（世界未被改动）', audit: 'unavailable'
    };
    return r;   // 审计都写不了，这里也不再尝试写审计
  }

  // ── 覆盖前备份：reversible 的物证，不是形容词
  let backupPath = null;
  if (before.exists && mode === 'write') {
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      backupPath = path.join(BACKUP_DIR, `${Date.now()}-${path.basename(relpath)}`);
      fs.copyFileSync(target, backupPath);
    } catch { backupPath = null; }
  }

  // ── 提交那一刻重新观察（RFC-0009 §10；外部对照 arXiv:2607.10487 "fresh at commit time"）
  //
  // 缺口是个 TOCTOU：before 在风险闸门处观察，真正的写发生在**三个 IO 之后**
  // （logAudit 追加审计、mkdirSync、copyFileSync 备份）。而本机常态是多个会话并发开着。
  // 别的会话在这个窗口里写了同一个文件，我们照样覆盖，那个叫「乐观锁」的凭据一个字都不说——
  // 凭据在**检查**那一刻新鲜，在**提交**那一刻已经不新鲜了。这正是 CTA 那篇分开的两件事：
  // endpoint success 是 utility，authorized commit 才是 security property。
  //
  // 只对覆盖写重检。追加写不重检是有意的：别人继续追加是合法的（见上方幂等段），
  // 拿整文件 sha 判 diverged 会把正常并发追加误判成冲突，反而诱发重复写。
  // **这只收窄窗口，不消灭它**：重观察到 writeFileSync 之间仍有一瞬（同 §4 对 R2 的态度，
  // 能做的是让越权可被发现，不是假装同进程外的世界能被锁住）。
  const atWrite = observe(target);
  if (mode === 'write' && atWrite.sha256 !== before.sha256) {
    const r = {
      ...base, status: 'diverged', risk, approval: appr.approval,
      approval_evidence: approvalEvidence,
      reason: '批准依据的那份 before 已经不是提交时的现实——期间有人改了这个文件，本次写已放弃',
      state_diff: {
        approved_against: { exists: before.exists, sha256: before.sha256, size_bytes: before.size_bytes },
        at_commit: { exists: atWrite.exists, sha256: atWrite.sha256, size_bytes: atWrite.size_bytes }
      },
      evidence: atWrite
    };
    logAudit(actor, r);
    return r;
  }

  // ── 真正动世界
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (mode === 'append') fs.appendFileSync(target, content, 'utf8');
    else fs.writeFileSync(target, content, 'utf8');
  } catch (e) {
    const r = { ...base, status: 'failed', risk, approval: appr.approval, approval_evidence: approvalEvidence, reason: `写失败: ${e.message}` };
    logAudit(actor, r);
    return r;
  }

  // ── 写后回头观察：status 由观察决定，不由 writeFileSync 决定
  const after = observe(target);
  const expectedBytes = Buffer.byteLength(content, 'utf8');   // v0.1 这里错用了 content.length（字符数）
  // 基线用 atWrite 而不是 before：两者在单线程下相同，但并发追加时 before 已经过期，
  // 拿它算 grew 会把「别人也追加了」误判成写失败。footprint 的 offset 同理。
  const grew = mode === 'append'
    ? after.size_bytes === (atWrite.size_bytes || 0) + expectedBytes
    : after.size_bytes === expectedBytes;

  const status = after.exists && grew ? 'done' : 'failed';
  const result = {
    ...base,
    status,
    risk, approval: appr.approval, riskReason,
    // 批准的出处（RFC-0009）：核心观察所得，非调用方声明。审计据此区分"人批的"与"自动化自批的"，
    // 并经 bound_effect 回答"这次批准绑定的是哪一笔改动"。
    approval_evidence: approvalEvidence,
    evidence: after,
    state_diff: { before: { exists: before.exists, sha256: before.sha256 }, after: { exists: after.exists, sha256: after.sha256 } },
    bytes_written: expectedBytes,
    // footprint = 这次动作在世界上留下的那一段（偏移+长度+该段 sha）。
    // 追加写的幂等重放靠它判定，而不是整文件快照——这样别人往同一文件继续追加不会污染判决。
    // offset 取 atWrite（提交那刻的观察）而非 before：并发追加时 before.size_bytes 已过期，
    // 用它记 offset 会让后续重放去读错位置，把成功的重放判成 diverged。
    ...(mode === 'append'
      ? { footprint: { offset: atWrite.size_bytes || 0, length: expectedBytes, sha256: sha256(content) } }
      : {}),
    reversible: true,
    backup_path: backupPath ? path.relative(ROOT, backupPath).replace(/\\/g, '/') : null,
    undo_hint: backupPath ? 'restore from backup_path' : 'delete target'
  };
  if (status === 'failed') result.reason = '写后观察不符：文件不存在或大小不符（世界没有按预期改变）';

  // 结果审计失败时世界已经改了，拦不住了——但必须让调用方看见这次动作没留下完整审计
  if (!logAudit(actor, result)) result.audit = 'result-log-failed';

  if (idempotency_key && status === 'done') {
    if (!appendLedger({ key: idempotency_key, request_hash: reqHash, action_id: actionId, result }, actor)) {
      result.idempotency = 'ledger-write-failed';   // 幂等保证在这次动作上不成立，别假装成立
    }
  }
  return result;
}

// 独立的再观察：让下游/另一个 harness 有能力给已完成的动作翻案
export function doVerify(args, actor = 'shadowcore') {
  const { relpath, expect_sha256 = null } = args;
  const target = path.resolve(ROOT, relpath || '');
  const obs = observe(target);
  let verdict = obs.exists ? 'exists' : 'missing';
  if (obs.exists && expect_sha256) verdict = expect_sha256 === obs.sha256 ? 'match' : 'mismatch';
  const r = {
    spec: SPEC, kind: 'action.result', verb: 'state.observe',
    target: relpath, status: (verdict === 'missing' || verdict === 'mismatch') ? 'failed' : 'done',
    verdict, evidence: obs
  };
  logAudit(actor, { ...r, kind: 'observation' });
  return r;
}

// 工具与 schema 声明也放核心：驱动各自呈现，但描述同源，避免两条通道说法漂移
export const TOOLS = [
  {
    name: 'southbridge_write',
    description: '南桥写动作（影核 v0.2）：白名单内写/追加文件。返回 action.result —— status 由写后回头观察决定，不是 exit code。medium/high 风险需 expect_sha256（乐观锁）；approval:"confirm" 仅在交互式 TTY 下有效，MCP 通道是无头的，请用 expect_sha256。',
    inputSchema: {
      type: 'object',
      properties: {
        relpath: { type: 'string', description: '相对 ShadowOS 根的目标路径，须以 demo/ 开头' },
        content: { type: 'string', description: '要写入的内容' },
        mode: { type: 'string', enum: ['write', 'append'], default: 'write' },
        idempotency_key: { type: 'string', description: '幂等键。同 key 同请求重放不会重复写' },
        expect_sha256: { type: 'string', description: '目标当前内容的 sha256。批准破坏性写的凭据（证明你读过）' },
        approval: { type: 'string', enum: ['confirm'], description: '人在环显式确认。仅当核心观察到 stdin 是 TTY 时有效——无头通道拿不到 TTY，会被判 requires_approval（RFC-0009）' }
      },
      required: ['relpath', 'content']
    }
  },
  {
    name: 'southbridge_verify',
    description: '本象再观察：读目标当前 exists/size/sha256/mtime，可对 expect_sha256 判 match/mismatch。用于给已报 done 的动作翻案。',
    inputSchema: {
      type: 'object',
      properties: {
        relpath: { type: 'string' },
        expect_sha256: { type: 'string' }
      },
      required: ['relpath']
    }
  }
];
