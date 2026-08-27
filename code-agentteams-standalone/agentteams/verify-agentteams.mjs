#!/usr/bin/env node
// verify-agentteams.mjs — 发证分离闸门一致性验证（agentteams-bridge/0.1）
//
// 判据以**反向用例**为主，理由同学堂：正向只能测「实现有没有跑」，测不出「判据成不成立」。
// 这一套尤其需要反向用例，因为它管的是「谁有资格给谁发证」——
// 一个只会点头的考官，比没有考官更坏：它给自证的经验盖了公章。
//
// ⚠ 关于本套判据的**证明强度上限**，先说清楚，别让绿灯被读大：
//   判据里的 homeserver 是本进程起的 stub（127.0.0.1 上的 http.Server）。
//   它验证的是**闸门逻辑**——「问过服务器」和「自己声明」被区分开、自证被拦下。
//   它**不**验证 Matrix 的身份签发本身有多硬，那要真的 Tuwunel + 真的 Worker 容器。
//   拿本套全绿去主张「身份已被外部锚定」，就是本仓库反复在抓的那种统计者谎报。
//
// 用法：node agentteams/verify-agentteams.mjs
// 退出码：0 = 全过　1 = 有失败
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { SPEC, observeIdentity, identityFingerprint, compareIdentity } from './identity.mjs';
import { readState, putState } from '../southbridge/benjing-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const CERTIFY = path.join(here, 'certify.mjs');

const results = [];
const cases = [];
const t = (id, name, fn) => cases.push({ id, name, fn });

// ───────── 沙箱：学历放 tmpdir，台账与审计另开一份 ─────────
// 学历**不放 demo/ 下**：那会让一份测试夹具被 scanStateFiles 当成真学历，
// 下次开会就注进上下文了。台账必须落在 demo/ 里（南桥白名单），所以用一个
// 显眼的一次性文件名，跑完删掉；它是文件不是目录，扫不出 task.origin.json。
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'atbridge-'));
const LEDGER_REL = 'demo/.agentteams-selftest-ledger.jsonl';
const LEDGER_ABS = path.join(ROOT, LEDGER_REL);
const AUDIT_ABS = path.join(SB, 'audit.log');

const ALICE = '@worker-alice:test.local';    // 作者
const BOB = '@worker-bob:test.local';        // 考官
const CAROL = '@worker-carol:test.local';    // 取象
const DAVE = '@worker-dave:test.local';      // 重派观察者 / 审计者

// ───────── stub homeserver：必须是独立进程 ─────────
// 判据用 spawnSync 调 certify.mjs，那会阻塞本进程的事件循环。第一版把 http.Server
// 起在本进程里，于是子进程一个连接都建不上，9 条判据集体报「够不着 homeserver」——
// 判据框架把**自己的失效**读成了被测对象的属性。留这段注释是因为这个坑值钱：
// identity.mjs 里 unreachable 那一格防的正是这件事，它却在判据框架自己身上复发了一次。
let server, HS;
function startHomeserver() {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [path.join(here, 'stub-homeserver.mjs')], {
      cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true,
    });
    const timer = setTimeout(() => reject(new Error('stub homeserver 起不来（5s 无 ready）')), 5000);
    server.stdout.once('data', d => {
      clearTimeout(timer);
      try { HS = JSON.parse(String(d).trim()).url; resolve(); }
      catch (e) { reject(new Error('stub homeserver 的 ready 行读不懂: ' + String(d))); }
    });
  });
}

// ───────── 夹具 ─────────
let seq = 0;
function mkState(learnings = [], extras = {}) {
  const dir = path.join(SB, 'case' + (++seq));
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'task.origin.json');
  fs.writeFileSync(p, JSON.stringify({
    spec: '2origin/0.2', kind: 'task.origin', id: 'atbridge-selftest-' + seq,
    title: '发证分离自测', goal: '判据夹具', current_state: '夹具',
    next_steps: ['被判据使用'], learnings, version: 1, ...extras,
    updated_at: new Date().toISOString(),
  }, null, 2), 'utf8');
  return p;
}

function env(tok, extra = {}) {
  return {
    ...process.env,
    MATRIX_HOMESERVER_URL: HS,
    ...(tok ? { MATRIX_ACCESS_TOKEN: tok } : {}),
    // 判据只在指定的回执里提供批准者 token，不能被启动 verify 的环境偷偷影响。
    MATRIX_APPROVER_ACCESS_TOKEN: '',
    AGENTTEAMS_CERTIFY_LEDGER: LEDGER_REL,
    SHADOWCORE_AUDIT_LOG: AUDIT_ABS,
    SHADOWCORE_LEDGER: path.join(SB, 'idem.jsonl'),
    ...extra,
  };
}

function run(args, tok, extra = {}) {
  const r = spawnSync(process.execPath, [CERTIFY, ...args], {
    // observe 的内层上限是 300s；外层必须另留至少 30s，不能把超时误归因给被测协议。
    cwd: ROOT, encoding: 'utf8', env: env(tok, extra), timeout: 330000, windowsHide: true,
  });
  let json = null;
  try { json = JSON.parse(String(r.stdout).trim().split('\n').pop()); } catch { /* 留 null */ }
  return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

// 恒绿 / 恒红考题：不挑真实脚本当考题，免得判据结果随仓库其它改动漂移
const GREEN = { kind: 'command', run: 'node --version', expect_exit: 0 };
const RED = { kind: 'command', run: 'node -e process.exit(7)', expect_exit: 0 };
const BADCMD = { kind: 'command', run: 'rm -rf /', expect_exit: 0 };

const rec = (fp, attested = true) => ({ fp, source: attested ? 'attested' : 'declared', attested, device_id: null, at: new Date().toISOString() });

// v0.2 起 certify 不再自己跑考题：判决依据必须由取象身份先产出。
// 判据里这一步用 carol，绝大多数用例都要先走它——**这本身就是协议的形状**。
const observeBy = (p, lid, who = 'tok-carol') => run(['observe', '--state', p, '--learning', lid], who);
const L = (over = {}) => ({
  id: 'lrn-fixture-' + (over.tag || 'x'), lesson: '这是一条足够长的、可以被推翻的经验主张',
  status: 'candidate', recheck: GREEN, ...over,
});

// ══════════════════════════ 身份取象 ══════════════════════════

t('I1', '【反向】observeIdentity 收到任何参数必须抛错（观察器收预期就退化成确认偏误机）', async () => {
  try { await observeIdentity({ id: ALICE }); return 'observeIdentity 接收了预期却没抛错'; }
  catch (e) { return /不接收任何参数/.test(e.message) || '抛了错但不是因为收参数：' + e.message; }
});

t('I2', '【反向】只有环境变量自称时，source 必须是 declared 且 attested=false', async () => {
  const r = run(['whoami'], null, { MATRIX_USER_ID: ALICE, MATRIX_HOMESERVER_URL: '' });
  if (!r.json) return '没拿到 JSON：' + r.stdout;
  return (r.json.source === 'declared' && r.json.attested === false && r.code === 2)
    || `env 自称被当成了 ${r.json.source}/attested=${r.json.attested}（exit=${r.code}）`;
});

t('I3', '【反向】够不着 homeserver ≠ 没有身份——两者必须能分开（同锚定把「核不动」与「没盖章」分开）', async () => {
  // 指向一个没人监听的端口
  const r = run(['whoami'], 'tok-alice', { MATRIX_HOMESERVER_URL: 'http://127.0.0.1:9', AGENTTEAMS_WHOAMI_TIMEOUT_MS: '800' });
  if (!r.json) return '没拿到 JSON：' + r.stdout;
  if (r.json.attested !== false) return '够不着却报了 attested';
  return r.json.unreachable === true
    || '够不着没有被单独标出（unreachable 缺失），会被读成「这个身份不存在」';
});

t('I4', '【反向】whoami 返回 200 但没有 user_id，不许算 attested（存在性检查冒充验证）', async () => {
  const r = run(['whoami'], 'tok-empty');
  if (!r.json) return '没拿到 JSON：' + r.stdout;
  return (r.json.attested === false && r.json.source !== 'attested')
    || '空 whoami 响应被当成了合法身份';
});

t('I5', '【反向】服务器说的压过环境变量自称——env 冒名时观察结果必须是服务器那个', async () => {
  const r = run(['whoami'], 'tok-alice', { MATRIX_USER_ID: BOB });   // 自称 bob，token 是 alice
  if (!r.json) return '没拿到 JSON：' + r.stdout;
  return (r.json.attested === true && r.json.id === ALICE)
    || `冒名成功：观察到 ${r.json.id}（应为 ${ALICE}）`;
});

t('I6', '身份指纹不得含原始 user_id（企业部署里它可能带真实姓名——列名字本身就是泄露）', async () => {
  const fp = identityFingerprint(ALICE);
  return (typeof fp === 'string' && fp.length === 16 && !fp.includes('alice') && fp !== ALICE)
    || '指纹泄露了原始身份：' + fp;
});

t('I7', '【反向】compareIdentity 在观察出处是 declared 时必须报 usable_as_evidence=false', async () => {
  const c = compareIdentity({ id: ALICE, source: 'declared', attested: false }, { id: ALICE });
  return (c.same === true && c.usable_as_evidence === false)
    || '声明出处的一致被当成了证据：' + JSON.stringify(c);
});

// ══════════════════════════ 发证闸门 ══════════════════════════

t('C1', '【反向】考官身份未经签发时必须拒绝发证，且学历一个字节不改', async () => {
  const p = mkState([L({ tag: 'c1', author: rec('AUTHOR-A') })]);
  const before = readState(p).computed;
  const r = run(['certify', '--state', p, '--learning', 'lrn-fixture-c1'], null, { MATRIX_HOMESERVER_URL: '' });
  const after = readState(p).computed;
  if (r.code !== 2) return `应 exit 2，实为 ${r.code}：${r.stdout}`;
  if (r.json?.code !== 'examiner_unattested') return '拒绝理由不对：' + JSON.stringify(r.json?.code);
  return before === after || '闸门拒绝了却改动了学历';
});

t('C2', '【反向】经验没有作者身份记录时必须拒考（不知道作者是谁，就无从判断考官是不是作者）', async () => {
  const p = mkState([L({ tag: 'c2' })]);            // 无 author
  const before = readState(p).computed;
  const r = run(['certify', '--state', p, '--learning', 'lrn-fixture-c2'], 'tok-bob');
  const after = readState(p).computed;
  if (r.code !== 2) return `应 exit 2，实为 ${r.code}：${r.stdout}`;
  if (r.json?.code !== 'unknown_author') return '拒绝理由不对：' + JSON.stringify(r.json?.code);
  return before === after || '闸门拒绝了却改动了学历';
});

t('C3', '【反向·本闸门的存在理由】考官与作者同一身份时必须拒绝——这是「作者不能给自己发证」第一次可执行', async () => {
  const p = mkState([L({ tag: 'c3', author: rec(identityFingerprint(BOB)) })]);
  const before = readState(p).computed;
  const r = run(['certify', '--state', p, '--learning', 'lrn-fixture-c3'], 'tok-bob');   // bob 考 bob
  const after = readState(p).computed;
  if (r.code !== 2) return `自证没被拦住！exit=${r.code} ${r.stdout}`;
  if (r.json?.code !== 'self_certification') return '拒绝理由不对：' + JSON.stringify(r.json?.code);
  return before === after || '闸门拒绝了却改动了学历';
});

t('C4', '考官 ≠ 作者且考试通过时升 verified，且考官身份必须落在 exam 里（否则事后答不出「谁发的证」）', async () => {
  const p = mkState([L({ tag: 'c4', author: rec(identityFingerprint(ALICE)) })]);
  observeBy(p, 'lrn-fixture-c4');
  const r = run(['certify', '--state', p, '--learning', 'lrn-fixture-c4'], 'tok-bob');
  if (r.code !== 0) return `应 exit 0，实为 ${r.code}：${r.stdout}${r.stderr}`;
  const l = readState(p).state.learnings[0];
  if (l.status !== 'verified') return '通过了却没升级：' + l.status;
  if (l.exam?.examiner?.fp !== identityFingerprint(BOB)) return 'exam 里没记考官身份：' + JSON.stringify(l.exam?.examiner);
  return l.exam.examiner.attested === true || '考官身份记下了但没标 attested';
});

t('C5', '【反向】考官合法不能替经验背书——考试挂了照样降级', async () => {
  const p = mkState([L({ tag: 'c5', status: 'verified', recheck: RED, author: rec(identityFingerprint(ALICE)), exam: { runs: 1, passes: 1, last_result: 'pass' } })]);
  observeBy(p, 'lrn-fixture-c5');
  const r = run(['certify', '--state', p, '--learning', 'lrn-fixture-c5'], 'tok-bob');
  if (r.code !== 3) return `应 exit 3（fail），实为 ${r.code}：${r.stdout}`;
  const l = readState(p).state.learnings[0];
  return l.status === 'candidate' || '考试挂了却没降级：' + l.status;
});

t('C6', '【反向】recheck 不在白名单时拒考（考题只许观察，不许改变被观察的东西）', async () => {
  const p = mkState([L({ tag: 'c6', recheck: BADCMD, author: rec(identityFingerprint(ALICE)) })]);
  const r = run(['certify', '--state', p, '--learning', 'lrn-fixture-c6'], 'tok-bob');
  if (r.code !== 2) return `应 exit 2，实为 ${r.code}：${r.stdout}`;
  return r.json?.code === 'unrunnable_recheck' || '拒绝理由不对：' + JSON.stringify(r.json?.code);
});

t('C7', '【反向】拒绝也必须留台账——只在通过时记账的账本，记的是喜报不是历史', async () => {
  const count = () => (fs.existsSync(LEDGER_ABS) ? fs.readFileSync(LEDGER_ABS, 'utf8').split('\n').filter(Boolean).length : 0);
  const before = count();
  const p = mkState([L({ tag: 'c7', author: rec(identityFingerprint(BOB)) })]);
  run(['certify', '--state', p, '--learning', 'lrn-fixture-c7'], 'tok-bob');   // 必被拒
  if (!fs.existsSync(LEDGER_ABS)) return '拒绝之后台账文件都没有';
  if (count() <= before) return `台账没有增长（${before} → ${count()}）`;
  const lines = fs.readFileSync(LEDGER_ABS, 'utf8').split('\n').filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  return (last.verb === 'certify.refused' && last.code === 'self_certification')
    || '台账最后一条不是这次拒绝：' + JSON.stringify(last.verb);
});

t('C8', '【反向】作者身份只是 declared 时，分离强度必须标 examiner_only，不许标 attested_both', async () => {
  const p = mkState([L({ tag: 'c8', author: rec('SOME-DECLARED-FP', false) })]);
  observeBy(p, 'lrn-fixture-c8');
  const r = run(['certify', '--state', p, '--learning', 'lrn-fixture-c8'], 'tok-bob');
  if (r.code !== 0) return `应能通过（作者 declared 不拦，只披露），实为 ${r.code}：${r.stdout}`;
  if (r.json?.separation_strength !== 'examiner_only') return '分离强度标错：' + r.json?.separation_strength;
  const l = readState(p).state.learnings[0];
  return l.exam?.separation_strength === 'examiner_only'
    || '强度只出现在返回值里，没落进学历——事后读学历的人看不见这条证据有多软';
});

t('C9', '【反向】考试跑不起来（error）不升不降：环境坏了 ≠ 经验错了', async () => {
  const p = mkState([L({ tag: 'c9', recheck: { kind: 'command', run: 'node ./no-such-file-atbridge.mjs', expect_exit: 0 }, author: rec(identityFingerprint(ALICE)) })]);
  observeBy(p, 'lrn-fixture-c9');
  const r = run(['certify', '--state', p, '--learning', 'lrn-fixture-c9'], 'tok-bob');
  const l = readState(p).state.learnings[0];
  // node 跑不存在的文件退出码是 1，会被判 fail 而非 error；这里只锁「不许升 verified」
  return l.status !== 'verified' || '考试没通过却升成了 verified';
});

t('C10', '发证台账必须走南桥（受审计）——影核审计里要有本模块的 actor 记录', async () => {
  if (!fs.existsSync(AUDIT_ABS)) return '审计日志不存在：台账没走南桥';
  const txt = fs.readFileSync(AUDIT_ABS, 'utf8');
  return /"actor":"agentteams_certify"/.test(txt)
    || '审计里没有 agentteams_certify —— 说明台账是自己 appendFileSync 写的，绕过了影核';
});

t('C11', '【反向】stamp 只能登记 candidate：作者自封 verified 会被写入闸门压回', async () => {
  const p = mkState([]);
  const r = run(['stamp', '--state', p, '--lesson', '这是一条由判据登记的、足够长的经验主张', '--recheck', 'node --version'], 'tok-alice');
  if (r.code !== 0) return `stamp 失败：${r.stdout}${r.stderr}`;
  const l = readState(p).state.learnings.at(-1);
  if (l.status !== 'candidate') return 'stamp 写出了非 candidate：' + l.status;
  return (l.author && l.author.attested === true && l.author.fp === identityFingerprint(ALICE))
    || '作者身份没被记下或记错：' + JSON.stringify(l.author);
});

t('C12', '【反向】闸门必须在跑考试之前拦——自证被拒时不许留下 exam.runs 增加的痕迹', async () => {
  const p = mkState([L({ tag: 'c12', author: rec(identityFingerprint(BOB)), exam: { runs: 3, passes: 3, last_result: 'pass' } })]);
  run(['certify', '--state', p, '--learning', 'lrn-fixture-c12'], 'tok-bob');   // 自证，必被拒
  const l = readState(p).state.learnings[0];
  return l.exam.runs === 3
    || `自证被拒却把考试次数从 3 推到了 ${l.exam.runs}——闸门放在了跑考试之后，等于自证者仍能刷考试记录`;
});

t('C13', '【反向】whoami 子命令在未签发时退出码必须非 0（不然脚本会把「不知道我是谁」当成正常）', async () => {
  const r = run(['whoami'], null, { MATRIX_HOMESERVER_URL: '', MATRIX_USER_ID: '' });
  return r.code === 2 || `未签发时 exit=${r.code}，脚本无从判断`;
});

t('C14', '【反向】本套判据必须真的在测盘上那个 certify.mjs——文件不在就该红，不该悄悄跳过', async () => {
  return (fs.existsSync(CERTIFY) && /self_certification/.test(fs.readFileSync(CERTIFY, 'utf8')))
    || 'certify.mjs 不存在或不含自证闸门：这个名字目前只是一句主张';
});

t('C15', '【反向】attested 的记录必须写明**签发者是谁**——只说"有人签过字"而不说是谁，事后不可审计', async () => {
  const p = mkState([L({ tag: 'c15', author: rec(identityFingerprint(ALICE)) })]);
  observeBy(p, 'lrn-fixture-c15');
  const r = run(['certify', '--state', p, '--learning', 'lrn-fixture-c15'], 'tok-bob');
  if (r.code !== 0) return `应通过，实为 ${r.code}：${r.stdout}`;
  const l = readState(p).state.learnings[0];
  const hs = l.exam?.examiner?.homeserver;
  if (!hs) return 'exam.examiner 里没有 homeserver：把 MATRIX_HOMESERVER_URL 指向自建服务器一样得 attested=true，而学历里看不出是谁签的';
  return /^127\.0\.0\.1:\d+$/.test(hs) || `homeserver 记录不对：${hs}`;
});

t('C16', '【反向】身份记录不得泄露 access token 或完整 URL（路径/查询串可能带令牌）', async () => {
  const p = mkState([L({ tag: 'c16', author: rec(identityFingerprint(ALICE)) })]);
  observeBy(p, 'lrn-fixture-c16');
  run(['certify', '--state', p, '--learning', 'lrn-fixture-c16'], 'tok-bob');
  const raw = fs.readFileSync(p, 'utf8');
  if (/tok-bob|tok-alice/.test(raw)) return '学历里出现了 access token';
  if (/https?:\/\//.test(JSON.stringify(readState(p).state.learnings[0].exam || {}))) return 'exam 里落了完整 URL 而非 host';
  return true;
});

t('C17', '【反向】代码不得自封签发强度等级——从进程里分不出"自建"与"第三方"，输出等级就是自封', async () => {
  const src = fs.readFileSync(path.join(here, 'identity.mjs'), 'utf8');
  // 允许注释里讲这四级（那是披露），不允许它变成一个被输出的字段
  const emits = /\b(attestation_tier|trust_level|tier)\s*:/.test(src);
  if (emits) return 'identity.mjs 输出了签发强度等级字段：代码分不出 stub 与 Tuwunel 与第三方，给等级即自封';
  return /四级|① 同进程 mock/.test(src)
    || 'identity.mjs 没有披露「代码分不出签发强度」这件事——不给等级但也不说为什么不给，读的人会以为 attested 是一个够用的结论';
});

// ══════════════════════════ 取象分离（v0.2 新增的第三个职能）══════════════════════════

t('O1', '【反向·行为】考官不许自己跑考题——观察说 pass 而考题实际会红时，必须采信观察', async () => {
  // 这条是**行为**判据不是源码判据：考题恒红（exit 7），观察记录写 pass。
  // 若 certify 还在自己 spawnSync，就会拿到 fail；采信观察才会 pass。
  const p = mkState([L({ tag: 'o1', recheck: RED, author: rec(identityFingerprint(ALICE)) })]);
  // 先让 carol 正常观察（会得到 fail），再手工把结果改成 pass 模拟「观察与实跑不一致」
  observeBy(p, 'lrn-fixture-o1');
  fs.chmodSync(p, 0o644);   // putState 写完会上只读位，直改夹具前必须先解锁
  const st = JSON.parse(fs.readFileSync(p, 'utf8'));
  st.learnings[0].observation.result = 'pass';
  st.learnings[0].observation.detail = '人为改成 pass，用来分辨考官是读观察还是自己跑';
  delete st.content_hash;
  fs.writeFileSync(p, JSON.stringify(st, null, 2), 'utf8');
  const r = run(['certify', '--state', p, '--learning', 'lrn-fixture-o1'], 'tok-bob');
  return (r.code === 0 && r.json?.result === 'pass')
    || `考官没有采信观察（exit=${r.code} result=${r.json?.result}）——它多半还在自己跑考题`;
});

t('O1b', '【反向·源码】certify 这条路径上不得出现命令执行', async () => {
  const src = fs.readFileSync(CERTIFY, 'utf8');
  const i = src.indexOf('async function cmdCertify');
  const end = src.indexOf('\nasync function main', i);
  // **先剥注释再匹配。** 第一版直接对整段正则，结果匹配到的是**注释里引用的**那句
  // `spawnSync(...)`——而那段注释正是在解释「上一版这里曾有命令执行」。
  // 判据该测代码，不该测散文；同 governance/verify-selfref.mjs 治的那个病。
  const seg = src.slice(i, end < 0 ? undefined : end)
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  return !/spawnSync|execSync|exec\(/.test(seg)
    || 'cmdCertify 里仍有命令执行——考官自己产生判决依据，与「作者给自己发证」是同一个病';
});

t('O2', '【反向】没有观察记录时拒绝发证（no_observation），学历一字不改', async () => {
  const p = mkState([L({ tag: 'o2', author: rec(identityFingerprint(ALICE)) })]);
  const before = readState(p).computed;
  const r = run(['certify', '--state', p, '--learning', 'lrn-fixture-o2'], 'tok-bob');
  if (r.code !== 2 || r.json?.code !== 'no_observation') return `应拒 no_observation，实为 exit=${r.code} code=${r.json?.code}`;
  return before === readState(p).computed || '拒绝了却改动了学历';
});

t('O3', '【反向】观察者不能是作者——自己干的活自己看，观察不构成独立证据', async () => {
  const p = mkState([L({ tag: 'o3', author: rec(identityFingerprint(ALICE)) })]);
  const r = observeBy(p, 'lrn-fixture-o3', 'tok-alice');     // alice 既是作者又想观察
  return (r.code === 2 && r.json?.code === 'observer_is_author')
    || `应拒 observer_is_author，实为 exit=${r.code} code=${r.json?.code}`;
});

t('O4', '【反向】观察者不能是考官——判决依据由判决者自己生产，等于没有分离', async () => {
  const p = mkState([L({ tag: 'o4', author: rec(identityFingerprint(ALICE)) })]);
  observeBy(p, 'lrn-fixture-o4', 'tok-bob');                  // bob 自己观察
  const r = run(['certify', '--state', p, '--learning', 'lrn-fixture-o4'], 'tok-bob');  // bob 再发证
  return (r.code === 2 && r.json?.code === 'observer_is_examiner')
    || `应拒 observer_is_examiner，实为 exit=${r.code} code=${r.json?.code}`;
});

t('O5', '【反向】一份观察只能发一次证——用过之后重放必须被拒', async () => {
  const p = mkState([L({ tag: 'o5', author: rec(identityFingerprint(ALICE)) })]);
  observeBy(p, 'lrn-fixture-o5');
  const first = run(['certify', '--state', p, '--learning', 'lrn-fixture-o5'], 'tok-bob');
  if (first.code !== 0) return `第一次就没过：exit=${first.code} ${first.stdout}`;
  const again = run(['certify', '--state', p, '--learning', 'lrn-fixture-o5'], 'tok-bob');
  return (again.code === 2 && again.json?.code === 'observation_replayed')
    || `重放没被拦：exit=${again.code} code=${again.json?.code}——一次通过可以被无限复用`;
});

t('O6', '【反向】换一道更好过的考题后，旧观察必须作废（否则闸门可被绕过）', async () => {
  const p = mkState([L({ tag: 'o6', recheck: RED, author: rec(identityFingerprint(ALICE)) })]);
  observeBy(p, 'lrn-fixture-o6');                              // 对着恒红考题观察
  fs.chmodSync(p, 0o644);   // 同上
  const st = JSON.parse(fs.readFileSync(p, 'utf8'));
  st.learnings[0].recheck = GREEN;                             // 偷偷换成恒绿考题
  delete st.content_hash;
  fs.writeFileSync(p, JSON.stringify(st, null, 2), 'utf8');
  const r = run(['certify', '--state', p, '--learning', 'lrn-fixture-o6'], 'tok-bob');
  return (r.code === 2 && r.json?.code === 'stale_observation')
    || `改题后旧观察仍被采信：exit=${r.code} code=${r.json?.code}`;
});

t('O7', '【反向】观察者身份未经签发时不许产出观察（否则只是把「谁都能说」挪到了证据上）', async () => {
  const p = mkState([L({ tag: 'o7', author: rec(identityFingerprint(ALICE)) })]);
  const r = run(['observe', '--state', p, '--learning', 'lrn-fixture-o7'], null, { MATRIX_HOMESERVER_URL: '' });
  return (r.code === 2 && r.json?.code === 'observer_unattested')
    || `应拒 observer_unattested，实为 exit=${r.code} code=${r.json?.code}`;
});

t('O8', '三个身份齐备时发证成功，且学历里同时留下考官与观察者（答得出「依据谁的观察」）', async () => {
  const p = mkState([L({ tag: 'o8', author: rec(identityFingerprint(ALICE)) })]);
  observeBy(p, 'lrn-fixture-o8');
  const r = run(['certify', '--state', p, '--learning', 'lrn-fixture-o8'], 'tok-bob');
  if (r.code !== 0) return `应通过，实为 ${r.code}：${r.stdout}`;
  const l = readState(p).state.learnings[0];
  const three = new Set([l.author?.fp, l.exam?.examiner?.fp, l.exam?.observer?.fp]);
  if (three.size !== 3) return `三个身份不齐或有重合：${JSON.stringify([...three])}`;
  return (l.exam.observer.fp === identityFingerprint(CAROL) && l.exam.observer.attested === true)
    || '观察者没落盘或落错：' + JSON.stringify(l.exam?.observer);
});
const approvalReceipt = (p, lid, over = {}) => {
  const receipt = path.join(path.dirname(p), `human-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(receipt, JSON.stringify({
    schema: 'agentteams.human-approval/1', state_id: readState(p).state.id, learning_id: lid,
    decision: 'approved', approved_by: 'human-reviewer', at: new Date().toISOString(), issued_at: new Date().toISOString(), ...over,
  }), 'utf8');
  return receipt;
};
const verifiedFixture = (over = {}, extras = {}) => mkState([L({
  tag: 'audit-' + (++seq), status: 'verified', author: rec(identityFingerprint(ALICE)),
  observation: { result: 'pass', observer: rec(identityFingerprint(CAROL)), consumed_by: identityFingerprint(BOB) },
  exam: { runs: 1, passes: 1, last_result: 'pass', observer: rec(identityFingerprint(CAROL)), examiner: rec(identityFingerprint(BOB)) }, ...over,
})], extras);

// ══════════════════════════ 异常分支（GOAI A档3）══════════════════════════

t('E1', '【故障注入】观察超时必须是 exit 4（仪器失效）而非 exit 3；重派给另一个观察者后可完成', async () => {
  const slow = path.join(SB, 'slow-observe-' + Date.now() + '.mjs');
  fs.writeFileSync(slow, 'setTimeout(() => process.exit(0), 50);', 'utf8');
  const p = mkState([L({ tag: 'e1', recheck: { kind: 'command', run: `node ${slow}`, expect_exit: 0 }, author: rec(identityFingerprint(ALICE)) })]);
  const timedOut = run(['observe', '--state', p, '--learning', 'lrn-fixture-e1', '--attempt-id', 'e1-first'], 'tok-carol', { AGENTTEAMS_OBSERVE_TIMEOUT_MS: '10' });
  if (timedOut.code !== 4 || timedOut.json?.result !== 'error' || timedOut.json?.attempt?.status !== 'timed_out') return `超时 attempt 被误判（exit=${timedOut.code} result=${timedOut.json?.result} attempt=${JSON.stringify(timedOut.json?.attempt)})`;
  const reassigned = run(['observe', '--state', p, '--learning', 'lrn-fixture-e1', '--attempt-id', 'e1-second', '--supersedes', 'e1-first'], 'tok-dave');
  if (reassigned.code !== 0 || reassigned.json?.result !== 'pass') return `重派观察者没有完成：exit=${reassigned.code} result=${reassigned.json?.result}`;
  const certified = run(['certify', '--state', p, '--learning', 'lrn-fixture-e1'], 'tok-bob');
  const l = readState(p).state.learnings[0];
  const ledger = fs.existsSync(LEDGER_ABS) ? fs.readFileSync(LEDGER_ABS, 'utf8') : '';
  return (certified.code === 0 && l.status === 'verified' && l.exam?.observer?.fp === identityFingerprint(DAVE)
    && l.observation?.attempt?.attempt_id === 'e1-second' && l.observation?.attempt?.supersedes === 'e1-first'
    && /"attempt_id":"e1-first"/.test(ledger))
    || `重派 attempt 留痕不完整：exit=${certified.code} observation=${JSON.stringify(l.observation?.attempt)}`;
});

t('E1a', '【反向】supersedes 必须指向另一观察者留下的 timed_out attempt，attempt_id 不得重放', async () => {
  const missing = mkState([L({ tag: 'e1a-missing', author: rec(identityFingerprint(ALICE)) })]);
  const noPrior = run(['observe', '--state', missing, '--learning', 'lrn-fixture-e1a-missing', '--attempt-id', 'e1a-missing-next', '--supersedes', 'never-recorded'], 'tok-dave');
  if (noPrior.code !== 4 || noPrior.json?.code !== 'attempt_invalid_supersedes' || readState(missing).state.learnings[0].observation) {
    return `不存在前序 attempt 被放过或写盘：${JSON.stringify(noPrior.json)}`;
  }

  const completed = mkState([L({ tag: 'e1a-completed', author: rec(identityFingerprint(ALICE)) })]);
  const first = run(['observe', '--state', completed, '--learning', 'lrn-fixture-e1a-completed', '--attempt-id', 'e1a-completed-first'], 'tok-carol');
  const notTimedOut = run(['observe', '--state', completed, '--learning', 'lrn-fixture-e1a-completed', '--attempt-id', 'e1a-completed-next', '--supersedes', 'e1a-completed-first'], 'tok-dave');
  const replay = run(['observe', '--state', completed, '--learning', 'lrn-fixture-e1a-completed', '--attempt-id', 'e1a-completed-first'], 'tok-dave');
  if (first.code !== 0 || notTimedOut.code !== 4 || notTimedOut.json?.code !== 'attempt_invalid_supersedes' || replay.code !== 4 || replay.json?.code !== 'attempt_replay') {
    return `completed/replay 校验不对：${JSON.stringify({ first: first.json, notTimedOut: notTimedOut.json, replay: replay.json })}`;
  }

  const slow = path.join(SB, 'slow-same-assignee-' + Date.now() + '.mjs');
  fs.writeFileSync(slow, 'setTimeout(() => process.exit(0), 50);', 'utf8');
  const timed = mkState([L({ tag: 'e1a-timed', recheck: { kind: 'command', run: `node ${slow}`, expect_exit: 0 }, author: rec(identityFingerprint(ALICE)) })]);
  const timedFirst = run(['observe', '--state', timed, '--learning', 'lrn-fixture-e1a-timed', '--attempt-id', 'e1a-timed-first'], 'tok-carol', { AGENTTEAMS_OBSERVE_TIMEOUT_MS: '10' });
  const sameAssignee = run(['observe', '--state', timed, '--learning', 'lrn-fixture-e1a-timed', '--attempt-id', 'e1a-timed-next', '--supersedes', 'e1a-timed-first'], 'tok-carol');
  return (timedFirst.code === 4 && timedFirst.json?.attempt?.status === 'timed_out'
    && sameAssignee.code === 4 && sameAssignee.json?.code === 'attempt_invalid_supersedes')
    || `同一观察者接手超时 attempt 被放过：${JSON.stringify({ timed: timedFirst.json, same: sameAssignee.json })}`;
});

t('E1b', '【反向】supersedes 不得跨任务借用前序 attempt——换一个学历/经验引用同一 attempt_id 必须拒', async () => {
  const slow = path.join(SB, 'slow-e1b-' + Date.now() + '.mjs');
  fs.writeFileSync(slow, 'setTimeout(() => process.exit(0), 50);', 'utf8');
  // 任务甲：Carol 超时留下 timed_out attempt
  const taskA = mkState([L({ tag: 'e1b-a', recheck: { kind: 'command', run: `node ${slow}`, expect_exit: 0 }, author: rec(identityFingerprint(ALICE)) })]);
  const timedA = run(['observe', '--state', taskA, '--learning', 'lrn-fixture-e1b-a', '--attempt-id', 'e1b-shared'], 'tok-carol', { AGENTTEAMS_OBSERVE_TIMEOUT_MS: '10' });
  if (timedA.code !== 4 || timedA.json?.attempt?.status !== 'timed_out') return `任务甲超时 attempt 没留下：${JSON.stringify(timedA.json)}`;
  // 任务乙：同一个 attempt_id 当 supersedes 引用（跨任务借用）必须拒
  const taskB = mkState([L({ tag: 'e1b-b', author: rec(identityFingerprint(ALICE)) })]);
  const crossTask = run(['observe', '--state', taskB, '--learning', 'lrn-fixture-e1b-b', '--attempt-id', 'e1b-b-next', '--supersedes', 'e1b-shared'], 'tok-dave');
  return (crossTask.code === 4 && crossTask.json?.code === 'attempt_invalid_supersedes' && !readState(taskB).state.learnings[0].observation)
    || `跨任务借用前序 attempt 未被拦：${JSON.stringify(crossTask.json)}`;
});

t('E1c', '【反向】同一 attempt_id 真并发：两个观察者进程同时启动，恰好一个取得 claim 并完成，另一个必须 attempt_replay，学历只有一份 observation', async () => {
  const slow = path.join(SB, 'slow-e1c-' + Date.now() + '.mjs');
  fs.writeFileSync(slow, 'setTimeout(() => process.exit(0), 300);', 'utf8');
  const p = mkState([L({ tag: 'e1c', recheck: { kind: 'command', run: `node ${slow}`, expect_exit: 0 }, author: rec(identityFingerprint(ALICE)) })]);
  const lid = 'lrn-fixture-e1c';
  const sharedAttempt = 'e1c-race-' + Date.now();
  const argsFor = tok => [
    CERTIFY, 'observe', '--state', p, '--learning', lid, '--attempt-id', sharedAttempt,
  ];
  // 两个进程**同时**启动（spawn，非 spawnSync），用 300ms 的慢 recheck 给两个
  // 进程都抵达 claim 窗口的机会——真正的竞争不是顺序重放。
  const runConcurrent = tok => new Promise(resolve => {
    const child = spawn(process.execPath, argsFor(tok), {
      cwd: ROOT, env: env(tok), windowsHide: true,
    });
    let stdout = '';
    child.stdout.on('data', d => { stdout += String(d); });
    child.on('close', code => {
      let json = null;
      try { json = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop()); } catch { /* leave null */ }
      resolve({ tok, code, json });
    });
  });
  const [a, b] = await Promise.all([runConcurrent('tok-carol'), runConcurrent('tok-dave')]);
  const winners = [a, b].filter(x => x.code === 0 && x.json?.result === 'pass');
  const losers = [a, b].filter(x => x.code === 4 && x.json?.code === 'attempt_replay');
  const stateNow = readState(p).state;
  const observations = stateNow.learnings.filter(l => l.observation).length;
  return (winners.length === 1 && losers.length === 1 && observations === 1)
    || `并发占位没达到「恰好一个赢」：winner=${JSON.stringify(a)} loser=${JSON.stringify(b)} observations=${observations}`;
});

t('E1d', '【反向】八路不同 attempt/经验并发观察：只有自报 write=done 的观察才可在盘上逐条找到，锁竞争/CAS 耗尽必须显式 diverged', async () => {
  const slow = path.join(SB, 'slow-e1d-' + Date.now() + '.mjs');
  // 慢 recheck 让所有子进程先抵达写入前，而不是被顺序启动偶然串行化。
  fs.writeFileSync(slow, 'setTimeout(() => process.exit(0), 350);', 'utf8');
  const N = 8;
  const batch = Array.from({ length: N }, (_, i) => ({
    lid: `lrn-fixture-e1d-${i}`,
    attemptId: `e1d-attempt-${Date.now()}-${i}`,
  }));
  const p = mkState(batch.map((x, i) => L({
    tag: `e1d-${i}`,
    recheck: { kind: 'command', run: `node ${slow}`, expect_exit: 0 },
    author: rec(identityFingerprint(ALICE)),
  })));
  const runConcurrent = spec => new Promise(resolve => {
    const child = spawn(process.execPath, [
      CERTIFY, 'observe', '--state', p, '--learning', spec.lid, '--attempt-id', spec.attemptId,
    ], { cwd: ROOT, env: env('tok-carol'), windowsHide: true });
    let stdout = '';
    child.stdout.on('data', d => { stdout += String(d); });
    child.on('close', code => {
      let json = null;
      try { json = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop()); } catch { /* leave null */ }
      resolve({ ...spec, code, json });
    });
  });
  const outcomes = await Promise.all(batch.map(runConcurrent));
  // 口径：只数本批八条经验里带 observation 的经验；每条经验最多一份 observation。
  const observed = readState(p).state.learnings
    .filter(l => batch.some(x => x.lid === l.id) && l.observation).length;
  const done = outcomes.filter(x => x.code === 0 && x.json?.write?.status === 'done');
  const diverged = outcomes.filter(x => x.code === 4 && x.json?.write?.status === 'diverged');
  const badSuccess = outcomes.filter(x => x.code === 0 && x.json?.write?.status !== 'done');
  const badFailure = outcomes.filter(x => x.code !== 0 && x.json?.write?.status !== 'diverged');
  // 断言核心：自报 done 的观察必须全部在盘上找到（R5-1 复发即红）。
  // ⚠ 不再断言 diverged.length > 0：那是「失败必须发生」的上界约束——将来写入层
  //    加退避后八路可能全成功，判据会误红（opus R6 残留⑤）。正确形态是
  //    done == observed 且 非 done 者必须显式 diverged/或无观察落盘。
  const ok = done.length === observed && badSuccess.length === 0 && badFailure.length === 0;
  if (ok) {
    console.log(`   ↳ R5-1 实测：P4 八路并发 self-reported done=${done.length}，disk observations=${observed}，静默丢观察=0`);
    console.log(`   ↳ R5-2 实测：CAS/锁竞争 diverged=${diverged.length}，均 exit 4，未被误报为成功`);
    return true;
  }
  return `并发写入出现谎报或漏报：done=${done.length} disk_observations=${observed} outcomes=${JSON.stringify(outcomes)}`;
});

t('E1e', '【反向】锁键必须归一：预置规范化锁占位后调 putState 必须 diverged 且盘不变（确定性判据，删掉锁键归一修复立刻变红）', async () => {
  // opus R7 抓出：自然并发下两把锁要互相覆盖需要微秒级窗口相遇，概率极低 →
  // 原 E1e 是恒绿考题。改成确定性形态：直接考锁的身份，不靠竞态。
  const base = mkState([L({ tag: 'e1e', author: rec(identityFingerprint(ALICE)) })]);
  // 先按小写拼写预置锁文件（模拟另一个进程用另一种拼写已经持锁）。
  // putState 的锁键是 realpathSync.native(绝对路径).toLowerCase() 的 sha256。
  const before = readState(base);
  const absMixed = path.resolve(base);
  let absReal = absMixed;
  try { absReal = fs.realpathSync.native(absMixed); } catch { /* 不存在则退回 resolve */ }
  const lockPath = path.join(
    path.dirname(absReal),
    `${crypto.createHash('sha256').update(absReal.toLowerCase()).digest('hex')}.lock`,
  );
  fs.writeFileSync(lockPath, '');   // 空占位 = 另一个进程持锁中
  try {
    const next = JSON.parse(JSON.stringify(before.state));
    next.version = (next.version || 0) + 1;
    const r = putState(base, next, { expect: before.computed, actor: { by: 'agentteams/verify-e1e' } });
    const after = readState(base);
    if (r.status === 'diverged' && after.computed === before.computed) return true;
    return `锁键未归一：占位后写请求 status=${r.status}，盘上 computed ${before.computed.slice(0, 8)}→${after.computed.slice(0, 8)}（删掉 realpath+toLowerCase 修复即复现）`;
  } finally {
    try { fs.rmSync(lockPath, { force: true }); } catch { /* 释放占位 */ }
  }
});

  t('E2', '【故障注入】身份服务不可用必须显式 unreachable，且不得产出观察判决依据', async () => {
    const p = mkState([L({ tag: 'e2', author: rec(identityFingerprint(ALICE)) })]);
  const before = readState(p).computed;
  const r = run(['observe', '--state', p, '--learning', 'lrn-fixture-e2'], 'tok-carol', {
    MATRIX_HOMESERVER_URL: 'http://127.0.0.1:9', AGENTTEAMS_WHOAMI_TIMEOUT_MS: '800',
  });
  const after = readState(p);
  if (!(r.code === 4 && r.json?.code === 'observer_unreachable' && before === after.computed && !after.state.learnings[0].observation)) {
    return `观察者身份服务故障被误读或写出了观察：exit=${r.code} code=${r.json?.code}`;
  }
  // 考官同样必须把「签发者够不着」保留为仪器失效，而不是把经验读成不合格。
  const q = mkState([L({ tag: 'e2-certify', author: rec(identityFingerprint(ALICE)) })]);
  observeBy(q, 'lrn-fixture-e2-certify');
  const certBefore = readState(q).computed;
  const cert = run(['certify', '--state', q, '--learning', 'lrn-fixture-e2-certify'], 'tok-bob', {
    MATRIX_HOMESERVER_URL: 'http://127.0.0.1:9', AGENTTEAMS_WHOAMI_TIMEOUT_MS: '800',
  });
  return (cert.code === 4 && cert.json?.code === 'examiner_unreachable' && cert.json?.unreachable === true && certBefore === readState(q).computed)
    || `考官身份服务故障被误读或改了学历：exit=${cert.code} code=${cert.json?.code}`;
});

t('E3', '【反向】人工确认回执必须有 schema/时间/非自批，且内容被替换时审计必须抓住', async () => {
  const p = mkState([L({ tag: 'e3', author: rec(identityFingerprint(ALICE)) })], { policy: { requires_human: true } });
  observeBy(p, 'lrn-fixture-e3');
  const denied = approvalReceipt(p, 'lrn-fixture-e3', { decision: 'denied' });
  const before = readState(p).computed;
  const r = run(['certify', '--state', p, '--learning', 'lrn-fixture-e3', '--human-approval', denied], 'tok-bob');
  const deniedPreserved = before === readState(p).computed;
  const lines = fs.existsSync(LEDGER_ABS) ? fs.readFileSync(LEDGER_ABS, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
  const badSchema = approvalReceipt(p, 'lrn-fixture-e3', { schema: 'forged' });
  const futureAt = approvalReceipt(p, 'lrn-fixture-e3', { at: new Date(Date.now() + 10 * 60_000).toISOString() });
  const futureIssuedAt = approvalReceipt(p, 'lrn-fixture-e3', { issued_at: new Date(Date.now() + 10 * 60_000).toISOString() });
  const self = approvalReceipt(p, 'lrn-fixture-e3', { approved_by: BOB });
  const wrongApproverToken = approvalReceipt(p, 'lrn-fixture-e3', { approved_by: ALICE, approver_token: 'tok-carol' });
  const s1 = run(['certify', '--state', p, '--learning', 'lrn-fixture-e3', '--human-approval', badSchema], 'tok-bob');
  const s2 = run(['certify', '--state', p, '--learning', 'lrn-fixture-e3', '--human-approval', futureAt], 'tok-bob');
  const s2b = run(['certify', '--state', p, '--learning', 'lrn-fixture-e3', '--human-approval', futureIssuedAt], 'tok-bob');
  const s3 = run(['certify', '--state', p, '--learning', 'lrn-fixture-e3', '--human-approval', self], 'tok-bob');
  const s4 = run(['certify', '--state', p, '--learning', 'lrn-fixture-e3', '--human-approval', wrongApproverToken], 'tok-bob');
  const valid = approvalReceipt(p, 'lrn-fixture-e3', { approved_by: DAVE, approver_token: 'tok-dave' });
  const ok = run(['certify', '--state', p, '--learning', 'lrn-fixture-e3', '--human-approval', valid], 'tok-bob');
  fs.writeFileSync(valid, JSON.stringify({ replaced: true }), 'utf8');
  const audit = run(['audit', '--state', p, '--learning', 'lrn-fixture-e3', '--human-approval', valid], 'tok-dave');
  return (r.code === 2 && r.json?.code === 'human_approval_denied' && deniedPreserved && lines.some(x => x.code === 'human_approval_denied')
    && s1.json?.code === 'human_approval_mismatch' && s2.json?.code === 'human_approval_future' && s2b.json?.code === 'human_approval_future'
    && s3.json?.code === 'human_approval_self_approved' && s4.code === 2 && s4.json?.code === 'human_approval_approver_mismatch'
    && !JSON.stringify(s4.json).includes('tok-carol')
    && ok.code === 0 && ok.json?.approval?.approver_kind === 'attested' && !JSON.stringify(ok.json).includes('tok-dave')
    && audit.code === 2 && audit.json?.findings?.some(x => x.id === 'human_receipt_hash' && !x.pass))
    || `人工确认闸门漏项：${JSON.stringify({ denied: r.json?.code, schema: s1.json?.code, future_at: s2.json?.code, future_issued_at: s2b.json?.code, self: s3.json?.code, mismatch: s4.json?.code, ok: ok.code, ok_body: ok.json, audit: audit.json?.findings })}`;
});

// ══════════════════════════ 审计一致性（R2）══════════════════════════

t('A1', '【反向】审计身份服务不可达必须 exit 4 + auditor_unreachable + unreachable，学历零改动', async () => {
  const p = verifiedFixture();
  const before = readState(p).computed;
  const r = run(['audit', '--state', p, '--learning', readState(p).state.learnings[0].id], 'tok-dave', {
    MATRIX_HOMESERVER_URL: 'http://127.0.0.1:9', AGENTTEAMS_WHOAMI_TIMEOUT_MS: '800',
  });
  return (r.code === 4 && r.json?.code === 'auditor_unreachable' && r.json?.unreachable === true && before === readState(p).computed)
    || `审计不可达语义不对：exit=${r.code} ${JSON.stringify(r.json)}`;
});

t('A2', '【反向】作者、观察者或考官不得兼任审计者', async () => {
  const p = verifiedFixture();
  const lid = readState(p).state.learnings[0].id;
  for (const tok of ['tok-alice', 'tok-carol', 'tok-bob']) {
    const r = run(['audit', '--state', p, '--learning', lid], tok);
    if (r.code !== 2 || r.json?.code !== 'auditor_not_independent') return `token=${tok} 未被独立性闸门拦住：${JSON.stringify(r.json)}`;
  }
  return true;
});

t('A3', '【反向】未发证经验不得审计通过', async () => {
  const p = mkState([L({ tag: 'a3', author: rec(identityFingerprint(ALICE)) })]);
  const r = run(['audit', '--state', p, '--learning', 'lrn-fixture-a3'], 'tok-dave');
  return (r.code === 2 && r.json?.code === 'audit_missing_certificate')
    || `未发证经验被审计通过：${JSON.stringify(r.json)}`;
});

t('A4', '【反向】要求人工确认而证书缺批准物证时必须拒绝', async () => {
  const p = verifiedFixture({}, { policy: { requires_human: true } });
  const r = run(['audit', '--state', p, '--learning', readState(p).state.learnings[0].id], 'tok-dave');
  return (r.code === 2 && r.json?.code === 'audit_missing_human_approval')
    || `缺人工物证仍通过审计：${JSON.stringify(r.json)}`;
});

t('A5', '【反向】手工伪造 verified 但观察者不一致时审计必须拒绝', async () => {
  const p = verifiedFixture({ exam: { runs: 1, passes: 1, last_result: 'pass', observer: rec(identityFingerprint(ALICE)), examiner: rec(identityFingerprint(BOB)) } });
  const r = run(['audit', '--state', p, '--learning', readState(p).state.learnings[0].id], 'tok-dave');
  return (r.code === 2 && r.json?.code === 'audit_certificate_inconsistent'
    && r.json?.findings?.some(x => x.id === 'observation_matches_certificate' && !x.pass))
    || `伪造证书未被一致性校验抓住：${JSON.stringify(r.json)}`;
});

t('A6', '【反向】手工伪造作者等于考官的 verified 学历时审计必须拒绝', async () => {
  const p = verifiedFixture({ author: rec(identityFingerprint(BOB)) });
  const r = run(['audit', '--state', p, '--learning', readState(p).state.learnings[0].id], 'tok-dave');
  return (r.code === 2 && r.json?.code === 'audit_certificate_inconsistent'
    && r.json?.findings?.some(x => x.id === 'certificate_identities_attested_distinct' && !x.pass))
    || `自审证书未被一致性校验抓住：${JSON.stringify(r.json)}`;
});

t('A7', '【反向】已验证学历缺 consumed_by 时审计必须拒绝，不得把未核销观察当作已发证依据', async () => {
  const p = verifiedFixture({ observation: { result: 'pass', observer: rec(identityFingerprint(CAROL)) } });
  const r = run(['audit', '--state', p, '--learning', readState(p).state.learnings[0].id], 'tok-dave');
  return (r.code === 2 && r.json?.code === 'audit_certificate_inconsistent'
    && r.json?.findings?.some(x => x.id === 'observation_consumed_by_examiner' && !x.pass))
    || `缺 consumed_by 未被审计抓住：${JSON.stringify(r.json)}`;
});

t('A7b', '【反向】consumed_by 指向另一考官（非发证考官）时审计必须拒绝，不得放行「没核销在发证考官头上」的证书', async () => {
  const p = verifiedFixture({ observation: { result: 'pass', observer: rec(identityFingerprint(CAROL)), consumed_by: identityFingerprint(ALICE) } });
  const r = run(['audit', '--state', p, '--learning', readState(p).state.learnings[0].id], 'tok-dave');
  return (r.code === 2 && r.json?.code === 'audit_certificate_inconsistent'
    && r.json?.findings?.some(x => x.id === 'observation_consumed_by_examiner' && !x.pass))
    || `consumed_by 错配未被审计抓住：${JSON.stringify(r.json)}`;
});

t('A8', '【反向】需要人工确认的已发证学历，回执缺失时审计必须拒绝', async () => {
  const p = verifiedFixture({ exam: {
    runs: 1, passes: 1, last_result: 'pass', observer: rec(identityFingerprint(CAROL)), examiner: rec(identityFingerprint(BOB)),
    approval: { required: true, approver_fp: identityFingerprint('human-reviewer'), receipt: 'missing-receipt.json', receipt_sha256: '0'.repeat(64) },
  } }, { policy: { requires_human: true } });
  const r = run(['audit', '--state', p, '--learning', readState(p).state.learnings[0].id], 'tok-dave');
  return (r.code === 2 && r.json?.code === 'audit_certificate_inconsistent'
    && r.json?.findings?.some(x => x.id === 'human_receipt_hash' && !x.pass))
    || `缺失人工回执未被审计抓住：${JSON.stringify(r.json)}`;
});

// ───────── 报告 ─────────
(async () => {
  // 起点清一次台账：上次异常中断残留的行会让 attempt_replay 假阳性（E1/E1a 依赖干净台账）。
  fs.rmSync(LEDGER_ABS, { force: true });
  // 同样清掉 .claims 占位目录：固定 attempt_id（e1-first/e1a-completed-first 等）
  // 在上一次运行崩溃时残留的 claim 文件，会让本次运行的预查直接 EEXIST 误伤。
  try { fs.rmSync(path.join(path.dirname(LEDGER_ABS), '.claims'), { recursive: true, force: true }); } catch { /* ignore */ }
  await startHomeserver();
  for (const c of cases) {
    let ok, detail = '';
    try {
      const r = await c.fn();
      ok = r === true;
      if (r !== true) detail = typeof r === 'object' ? JSON.stringify(r) : String(r);
    } catch (e) { ok = false; detail = 'EXCEPTION: ' + (e.message || e); }
    results.push({ ...c, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${c.id.padEnd(5)} ${c.name}${ok ? '' : `\n        ${detail}`}`);
  }
  try { server.kill(); } catch { /* ignore */ }
  fs.rmSync(SB, { recursive: true, force: true });
  fs.rmSync(LEDGER_ABS, { force: true });

  const pass = results.filter(r => r.ok).length;
  const rev = results.filter(r => /【反向/.test(r.name)).length;
  console.log(`\n═══ 发证分离闸门一致性验证（${SPEC}）═══`);
  console.log(`判决: ${pass === results.length ? '✅ VERIFIED' : '❌ NOT VERIFIED'}（${results.length} 条判据，其中 ${rev} 条是反向用例：故意造假必须被抓住）`);
  console.log(`通过 ${pass} / ${results.length}`);
  console.log('⚠ 证明强度上限：判据里的 homeserver 是本进程起的 stub。本套绿灯说明**闸门逻辑**成立，');
  console.log('  不说明身份已被外部锚定——那要真 Tuwunel + 真 Worker 容器才谈得上。');
  if (pass !== results.length) {
    console.log('\n失败:');
    for (const r of results.filter(x => !x.ok)) console.log(`  • ${r.id} ${r.name}\n    ${r.detail}`);
  }
  process.exit(pass === results.length ? 0 : 1);
})();
