#!/usr/bin/env node
// verify-identity-anchors.mjs — 承诺⑤：跨主机身份锚判据（agentteams-bridge/0.2）
//
// 判据以**反向用例**为主，理由同 verify-agentteams.mjs：一个只会点头的适配层，
// 比没有适配层更坏——它让 declared 身份披着 attested 的皮过闸。
//
// ⚠ 证明强度上限：本套判据的 OIDC/K8s 签发者是本判据起的 stub（独立进程），
//   SPIFFE 用的是判据自己生成的密钥对。绿灯说明「问签发者 vs 自己声明」这条线
//   在三种新锚上都被守住了；不说明任何真实 SSO/SPIFFE/集群的身份强度。
//
// 用法：node agentteams/verify-identity-anchors.mjs
// 退出码：0 = 全过　1 = 有失败
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ANCHOR_KINDS, probeAnchor, resolveAnchorOrder } from './identity-anchors.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const CERTIFY = path.join(here, 'certify.mjs');
const results = [];
const cases = [];
const t = (id, name, fn) => cases.push({ id, name, fn });

// ───────── 沙箱与 stub idp（必须独立进程，同 stub-homeserver 的教训）─────────
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'atanchors-'));
const LEDGER_REL = 'demo/.agentteams-anchor-selftest-ledger.jsonl';
const LEDGER_ABS = path.join(ROOT, LEDGER_REL);
const AUDIT_ABS = path.join(SB, 'audit.log');

let server, IDP;
function startIdp() {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [path.join(here, 'stub-idp.mjs')], {
      cwd: ROOT,
      env: { ...process.env, STUB_JWKS: JWKS },
      stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true,
    });
    const timer = setTimeout(() => reject(new Error('stub idp 起不来（5s 无 ready）')), 5000);
    server.stdout.once('data', d => {
      clearTimeout(timer);
      try { IDP = JSON.parse(String(d).trim()).url; resolve(); }
      catch (e) { reject(new Error('stub idp ready 行读不懂: ' + String(d))); }
    });
  });
}

// SPIFFE 测试密钥对：判据自己生成 RSA 密钥并发布 JWKS，SVID 由判据签发——
// 这样「签名不对必须被拒」这条反向用例才造得出来（换一把没发布过的钥匙签名）
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwkPub = publicKey.export({ format: 'jwk' });
jwkPub.kid = 'anchor-test-key-1'; jwkPub.alg = 'RS256'; jwkPub.use = 'sig';
const JWKS = JSON.stringify({ keys: [jwkPub] });

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function makeSvid({ sub, expOffsetSec = 600, kid = 'anchor-test-key-1', key = privateKey }) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const payload = b64url(JSON.stringify({
    sub,
    aud: ['at-anchor-test'],
    exp: Math.floor(Date.now() / 1000) + expOffsetSec,
    iss: 'spiffe://anchor.test/wit',
  }));
  const sig = b64url(crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key));
  return `${header}.${payload}.${sig}`;
}

const svidGoodPath = path.join(SB, 'svid-good.jwt').replace(/\\/g, '/');
fs.writeFileSync(svidGoodPath, makeSvid({ sub: 'spiffe://anchor.test/ns/at/sa/examiner' }));

// 直连探针用的基础环境（IDP 指向 stub）。单条用例再覆盖。
const BASE_ENV = () => ({
  OIDC_ISSUER: IDP, OIDC_ACCESS_TOKEN: 'tok-good-oidc',
  SPIFFE_SVID_FILE: svidGoodPath, SPIFFE_BUNDLE_URL: `${IDP}/jwks`,
  K8S_API_URL: IDP, K8S_TOKEN: 'sa-token-good',
});

function anchorEnv(kind, extra = {}) {
  const base = {
    ...process.env,
    AGENTTEAMS_CERTIFY_LEDGER: LEDGER_REL,
    SHADOWCORE_AUDIT_LOG: AUDIT_ABS,
    SHADOWCORE_LEDGER: path.join(SB, 'idem.jsonl'),
    // 四条锚的环境变量全部预置成指向 stub / 好令牌，单条用例用 override 关掉别的
    MATRIX_HOMESERVER_URL: '', MATRIX_ACCESS_TOKEN: '',
    OIDC_ISSUER: IDP, OIDC_ACCESS_TOKEN: 'tok-good-oidc',
    SPIFFE_SVID_FILE: svidGoodPath, SPIFFE_BUNDLE_URL: `${IDP}/jwks`,
    K8S_API_URL: IDP, K8S_TOKEN: 'sa-token-good',
    ...extra,
  };
  if (kind === 'oidc') base.AGENTTEAMS_IDENTITY_ANCHOR = 'oidc';
  else if (kind === 'spiffe') base.AGENTTEAMS_IDENTITY_ANCHOR = 'spiffe';
  else if (kind === 'k8s') base.AGENTTEAMS_IDENTITY_ANCHOR = 'k8s';
  return base;
}

function runCertify(args, extraEnv) {
  const r = spawnSync(process.execPath, [CERTIFY, ...args], {
    cwd: ROOT, encoding: 'utf8', env: extraEnv, timeout: 60000, windowsHide: true,
  });
  let json = null;
  try { json = JSON.parse(String(r.stdout).trim().split('\n').pop()); } catch { /* leave null */ }
  return { code: r.status, json, stdout: r.stdout };
}

function whoami(extraEnv) {
  return runCertify(['whoami'], extraEnv);
}

let seq = 0;
function mkState(learnings = []) {
  const dir = path.join(SB, 'case' + (++seq));
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'task.origin.json');
  fs.writeFileSync(p, JSON.stringify({
    spec: '2origin/0.2', kind: 'task.origin', id: 'atchors-selftest-' + seq,
    title: '身份锚自测', goal: '判据夹具', current_state: '夹具',
    next_steps: ['被判据使用'], learnings, version: 1,
    updated_at: new Date().toISOString(),
  }, null, 2), 'utf8');
  return p;
}
const fp16 = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const rec = (fp, attested = true) => ({ fp, source: attested ? 'attested' : 'declared', attested, device_id: null, at: new Date().toISOString() });
const GREEN = { kind: 'command', run: 'node --version', expect_exit: 0 };
const L = (over = {}) => ({
  id: 'lrn-fx-' + (over.tag || 'x'), lesson: '这是一条足够长的、可以被推翻的经验主张',
  status: 'candidate', recheck: GREEN, ...over,
});

// ══════════════ A 组：适配层本身（probeAnchor / resolveAnchorOrder）══════════════

t('A1', '未知锚类型必须抛错——静默回落到 declared 是本层最不能犯的错', async () => {
  try { await probeAnchor('telegram'); return '接受了未知的锚类型'; }
  catch (e) { return /未知的身份锚类型/.test(e.message) || '抛错但原因不对：' + e.message; }
});

t('A2', '【反向】resolveAnchorOrder 收到不认识的名字必须抛错，不许悄悄当 auto', async () => {
  try { resolveAnchorOrder({ AGENTTEAMS_IDENTITY_ANCHOR: 'ldap' }); return '接受了未知锚名'; }
  catch (e) { return /不认识/.test(e.message) || '抛错但原因不对：' + e.message; }
});

t('A3', 'auto 模式按配置了哪些环境变量决定顺序，什么都没配时兜底 matrix（保持旧行为）', () => {
  const order = resolveAnchorOrder({});
  return JSON.stringify(order) === JSON.stringify(['matrix']) || '空配置兜底不是 matrix：' + JSON.stringify(order);
});

t('A4', 'auto 模式下配了 oidc 变量就会把 oidc 排进队列', () => {
  const order = resolveAnchorOrder({ OIDC_ISSUER: 'https://sso.example', OIDC_ACCESS_TOKEN: 'x' });
  return order.includes('oidc') || '配了 oidc 却不在队列：' + JSON.stringify(order);
});

t('A5', '【反向】OIDC 令牌无效（401 invalid_token）不得算 attested', async () => {
  const r = await probeAnchor('oidc', {
    OIDC_ISSUER: IDP, OIDC_ACCESS_TOKEN: 'tok-bad',
  });
  return (!r.ok && r.source !== 'attested' && /invalid_token|401/.test(r.reason))
    || '坏令牌的结果不对：' + JSON.stringify(r);
});

t('A6', '【反向】userinfo 返回 200 但没有 sub（存在性冒充验证）不得算 attested', async () => {
  const r = await probeAnchor('oidc', {
    OIDC_ISSUER: IDP, OIDC_ACCESS_TOKEN: 'tok-empty-oidc',
  });
  if (r.ok || r.source === 'attested') return '空 userinfo 被当成了合法身份：' + JSON.stringify(r);
  return /HTTP 200|没有 sub/.test(String(r.reason)) || '拒绝理由没说清是「200 但无 sub」：' + r.reason;
});

t('A7', '【正向】有效 OIDC 令牌经 discovery→userinfo 得到 attested，且记录里是签发者 host 不是完整 URL', async () => {
  const r = await probeAnchor('oidc', {
    OIDC_ISSUER: IDP, OIDC_ACCESS_TOKEN: 'tok-good-oidc',
  });
  if (!r.ok || r.source !== 'attested') return '好令牌却没过：' + JSON.stringify(r);
  return /^127\.0\.0\.1:\d+$/.test(r.issuer) && !String(r.issuer).includes('/userinfo')
    || 'issuer 记录不是 host：' + r.issuer;
});

t('A8', '【反向】够不着签发者必须标 unreachable（仪器失效 ≠ 身份不存在）', async () => {
  const r = await probeAnchor('oidc', {
    OIDC_ISSUER: 'http://127.0.0.1:9', OIDC_ACCESS_TOKEN: 'tok-good-oidc',
    AGENTTEAMS_WHOAMI_TIMEOUT_MS: '800',
  });
  return (!r.ok && r.unreachable === true)
    || '够不着没有被单独标出：' + JSON.stringify(r);
});

// ══════════════ S 组：SPIFFE 本地验签（四条锚里唯一做本地密码学验证的一条）══════════════

t('S1', '【正向】合法 JWT-SVID 本地验签通过，attested 且带 verified_locally 标记', async () => {
  const r = await probeAnchor('spiffe', BASE_ENV());
  if (!r.ok || r.source !== 'attested') return '合法 SVID 被拒：' + JSON.stringify(r);
  return r.verified_locally === true || '本地验签成功却没有 verified_locally 标记——读账的人分不出这是四条锚里唯一本地验签的一条';
});

t('S2', '【反向】过期 SVID 必须被拒', async () => {
  const p2 = path.join(SB, 'svid-expired.jwt').replace(/\\/g, '/');
  fs.writeFileSync(p2, makeSvid({ sub: 'spiffe://anchor.test/x', expOffsetSec: -10 }));
  const r = await probeAnchor('spiffe', { ...BASE_ENV(), SPIFFE_SVID_FILE: p2 });
  return (!r.ok && /过期/.test(r.reason)) || '过期 SVID 的结果不对：' + JSON.stringify(r);
});

t('S3', '【反向】非信任域密钥签的 SVID 必须被拒（签名验证真的在跑，不是走过场）', async () => {
  const rogue = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const p3 = path.join(SB, 'svid-rogue.jwt').replace(/\\/g, '/');
  fs.writeFileSync(p3, makeSvid({ sub: 'spiffe://evil.test/x', key: rogue }));
  const r = await probeAnchor('spiffe', { ...BASE_ENV(), SPIFFE_SVID_FILE: p3 });
  return (!r.ok && /签名/.test(r.reason)) || '野钥匙签的 SVID 结果不对：' + JSON.stringify(r);
});

t('S4', '【反向】sub 不是 spiffe:// 前缀必须被拒', async () => {
  const p4 = path.join(SB, 'svid-nospiffe.jwt').replace(/\\/g, '/');
  fs.writeFileSync(p4, makeSvid({ sub: 'alice@corp.example' }));
  const r = await probeAnchor('spiffe', { ...BASE_ENV(), SPIFFE_SVID_FILE: p4 });
  return (!r.ok && /SPIFFE/.test(r.reason)) || '非 SPIFFE sub 的结果不对：' + JSON.stringify(r);
});

// ══════════════ K 组：K8s TokenReview ══════════════

t('K1', '【正向】apiserver 判 authenticated=true 时得到 attested，身份是 SA 用户名', async () => {
  const r = await probeAnchor('k8s', BASE_ENV());
  return (r.ok && r.source === 'attested' && r.id === 'system:serviceaccount:at-demo:examiner-sa')
    || '好 SA token 的结果不对：' + JSON.stringify(r);
});

t('K2', '【反向】apiserver 判 authenticated=false 时不算 attested（201 里藏着 false 不许被骗）', async () => {
  const r = await probeAnchor('k8s', { ...BASE_ENV(), K8S_TOKEN: 'sa-token-bad' });
  return !r.ok && r.source !== 'attested' || '坏 token 被 HTTP 201 骗过了：' + JSON.stringify(r);
});

// ══════════════ G 组：新锚接进发证闸门（G1~G8 一行不改就能吃）═════════════

// 三身份全用 k8s 锚：作者/考官/取象是三个不同的 SA 用户名
const AUTHOR_SA = 'system:serviceaccount:at-demo:author-sa';
const EXAMINER_SA = 'system:serviceaccount:at-demo:examiner-sa';
const OBSERVER_SA = 'system:serviceaccount:at-demo:observer-sa';

// stub 只认 sa-token-good → examiner。为了让三个角色拿到不同身份，
// 判据直接在夹具里写死 author/observation（等价于 stamp/observe 已发生），
// certify 只读不跑——这正是 O1 判过的行为边界。
function fixtureWithObservation() {
  return mkState([L({
    tag: 'g' + (seq + 1),
    author: rec(fp16(AUTHOR_SA), true),
    observation: {
      observer: rec(fp16(OBSERVER_SA), true),
      result: 'pass', detail: '判据夹具观察', consumed_by: null,
      recheck_fp: null,   // 与 GREEN 对齐：recheckFingerprint({kind:'command',run:'node --version'})
      at: new Date().toISOString(),
    },
  })]);
}
function greenRecheckFp() {
  const canon = JSON.stringify({ kind: 'command', run: 'node --version', expect_exit: 0 });
  return crypto.createHash('sha256').update(canon).digest('hex').slice(0, 16);
}

t('G1', 'K8s SA 考官 + Matrix 作者指纹：闸门照常放行且 exam.examiner 带 anchor=k8s 与签发者 host', async () => {
  const st = mkState([L({
    tag: 'g1', author: rec(fp16(AUTHOR_SA), true),
    observation: {
      observer: rec(fp16(OBSERVER_SA), true),
      result: 'pass', detail: '夹具', consumed_by: null,
      recheck_fp: greenRecheckFp(), at: new Date().toISOString(),
    },
  })]);
  const r = runCertify(['certify', '--state', st, '--learning', 'lrn-fx-g1'],
    { ...process.env, ...anchorEnv('k8s') });
  if (r.code !== 0) return `应通过，exit=${r.code}：${r.stdout}`;
  const l = JSON.parse(fs.readFileSync(st, 'utf8')).learnings[0];
  const ex = l.exam?.examiner || {};
  if (ex.fp !== fp16(EXAMINER_SA)) return '考官指纹不对：' + ex.fp;
  if (ex.anchor !== 'k8s') return 'exam.examiner 没记 anchor=k8s：' + JSON.stringify(ex);
  return !!ex.homeserver || '没记签发者 host——事后答不出是谁签的';
});

t('G2', '【反向·跨主机自证】考官与作者是同一 SA 用户名（不同主机同身份）必须被拦', async () => {
  const st = mkState([L({
    tag: 'g2', author: rec(fp16(EXAMINER_SA), true),
    observation: {
      observer: rec(fp16(OBSERVER_SA), true),
      result: 'pass', detail: '夹具', consumed_by: null,
      recheck_fp: greenRecheckFp(), at: new Date().toISOString(),
    },
  })]);
  const r = runCertify(['certify', '--state', st, '--learning', 'lrn-fx-g2'],
    { ...process.env, ...anchorEnv('k8s') });
  return (r.code === 2 && r.json?.code === 'self_certification')
    || `跨主机自证没被拦：exit=${r.code} code=${r.json?.code}——换了签发者不等于换了身份`;
});

t('G3', '【反向】显式选 k8s 锚时不许悄悄回落到 Matrix——配错就明说，不给「滑到另一条」留门', async () => {
  // k8s 配置指向没人监听的端口（unreachable），Matrix 配置齐全可用：
  // 若实现偷偷回落到 matrix，whoami 会 attested；正确行为是报 unreachable 且 exit 2
  const r = whoami(anchorEnv('k8s', {
    K8S_API_URL: 'http://127.0.0.1:9',
    AGENTTEAMS_WHOAMI_TIMEOUT_MS: '800',
    MATRIX_HOMESERVER_URL: IDP + '/_matrix',
    MATRIX_ACCESS_TOKEN: 'tok-alice',
  }));
  if (!r.json) return '没拿到 JSON：' + r.stdout;
  // 正确行为：k8s 够不着被单独标出（unreachable=true），attested=false，exit 2。
  // 错误行为（本判据抓的）：悄悄改用 Matrix 探针拿到 attested=true。
  const bad = r.json.attested === true || (r.json.probes || []).some(pp => pp.probe === 'matrix_whoami');
  if (bad) return '回落发生了：' + JSON.stringify({ attested: r.json.attested, probes: r.json.probes?.map(x => x.probe) });
  return (r.json.unreachable === true && r.code === 2)
    || `unreachable 没标出或退出码不对：${JSON.stringify({ unreachable: r.json.unreachable, code: r.code })}`;
});

// ───────── 报告 ─────────
(async () => {
  await startIdp();
  for (const c of cases) {
    let ok, detail = '';
    try {
      const r = await c.fn();
      ok = r === true;
      if (r !== true) detail = typeof r === 'object' ? JSON.stringify(r) : String(r);
    } catch (e) { ok = false; detail = 'EXCEPTION: ' + (e.message || e); }
    results.push({ ...c, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${c.id.padEnd(4)} ${c.name}${ok ? '' : `\n        ${detail}`}`);
  }
  try { server.kill(); } catch { /* ignore */ }
  fs.rmSync(SB, { recursive: true, force: true });
  fs.rmSync(LEDGER_ABS, { force: true });

  const pass = results.filter(r => r.ok).length;
  const rev = results.filter(r => /【反向/.test(r.name)).length;
  console.log(`\n═══ 跨主机身份锚一致性验证（agentteams-bridge/0.2 承诺⑤）═══`);
  console.log(`判决: ${pass === results.length ? '✅ VERIFIED' : '❌ NOT VERIFIED'}（${results.length} 条判据，其中 ${rev} 条反向用例）`);
  console.log(`通过 ${pass} / ${results.length}`);
  console.log('⚠ 证明强度上限：OIDC/K8s 签发者是本判据起的 stub，SPIFFE 用的是判据自己的密钥对。');
  console.log('  绿灯说明「问签发者」这条线在新锚上成立，不说明真实 SSO/SPIFFE/集群的身份强度。');
  if (pass !== results.length) {
    console.log('\n失败:');
    for (const r of results.filter(x => !x.ok)) console.log(`  • ${r.id} ${r.name}\n    ${r.detail}`);
  }
  process.exit(pass === results.length ? 0 : 1);
})();
