// identity-anchors.mjs — 身份签发者适配层（agentteams-bridge/0.2）
//
// 回答承诺⑤的那句话：「考官身份由平台签发」里的**平台**，凭什么只能是 Matrix。
// 跨主机部署里，作者、取象、考官常常各在一台机器、各自有企业已经发好的身份：
// OIDC（SSO 签发的访问令牌）、SPIFFE（工作负载身份）、Kubernetes ServiceAccount。
// 闸门要的从来不是「Matrix 身份」，而是：**身份是问一个我们控制不了的进程得来的，
// 不是进程自己声明的。** 这一层把四种签发者收敛到同一种探针结果形状，
// certify.mjs 的 G1~G8 一行不改就能吃。
//
// ── 三条新锚的验证方式与诚实边界 ──────────────────────────────────────
//   oidc    问签发者的 userinfo 端点（令牌内省）。跟 Matrix whoami 同一强度级别：
//           「服务器认这个令牌」。不做本地签名校验——那不是本层该自封的能力。
//   spiffe  验 JWT-SVID：本地用信任域的 JWKS 验**签名**（node:crypto，RS256/ES256），
//           并检查 exp 与 spiffe:// 前缀。这是四条锚里唯一一条本地密码学验证，
//           强度高于另外三条——如实写在这里，不许在别处把它说成三条都一样硬。
//   k8s     问 apiserver 的 TokenReview（ projected SA token 的官方核验路径）。
//           「apiserver 说 authenticated」就是结论；集群外的我们无从复核更多。
//
// 四条的共同点：结论都来自**签发者或其受托方**，而不是被测进程自己。
// 差异点（谁验的、在哪验的）全部落进探针记录，读账的人自己判断强度——
// 同 identity.mjs 的规矩：代码分不出的等级就不输出，但原始材料必须在场。

import crypto from 'node:crypto';
import fs from 'node:fs';

const TIMEOUT_MS = Number(process.env.AGENTTEAMS_WHOAMI_TIMEOUT_MS || 4000);

export const ANCHOR_KINDS = ['matrix', 'oidc', 'spiffe', 'k8s'];

/** 主机名提取：记 host 不记完整 URL——路径与查询串可能带令牌（同 identityRecord 的排除规则） */
function hostOf(url) {
  try { return new URL(url).host; } catch { return null; }
}

async function fetchJson(url, init, fetchImpl) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await (fetchImpl || fetch)(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
  const body = await res.json().catch(() => null);
  return { res, body };
}

/** 够不着（网络层失败）必须与「对方说不」分开报——仪器失效不是被测对象的属性 */
function unreachable(probe, e) {
  return {
    probe, ok: false, unreachable: true,
    reason: `够不着签发者：${e.name === 'AbortError' || e.name === 'TimeoutError' ? `超时 ${TIMEOUT_MS}ms` : e.message}`,
  };
}

// ── 探针 1：matrix（原 identity.mjs 内联逻辑收编于此，字段形状一字不改）──────
async function probeMatrix(env, fetchImpl) {
  const hs = env.MATRIX_HOMESERVER_URL || env.MATRIX_HOMESERVER || '';
  const token = env.MATRIX_ACCESS_TOKEN || '';
  if (!hs || !token) {
    return {
      probe: 'matrix_whoami', ok: false,
      reason: `缺 ${!hs ? 'MATRIX_HOMESERVER_URL' : ''}${!hs && !token ? ' 与 ' : ''}${!token ? 'MATRIX_ACCESS_TOKEN' : ''}`,
    };
  }
  const url = hs.replace(/\/+$/, '') + '/_matrix/client/v3/account/whoami';
  try {
    const { res, body } = await fetchJson(url, { headers: { Authorization: `Bearer ${token}` } }, fetchImpl);
    if (res.ok && body && typeof body.user_id === 'string' && body.user_id) {
      return {
        probe: 'matrix_whoami', ok: true, source: 'attested',
        id: body.user_id, device_id: body.device_id || null,
        homeserver: hs, issuer: hostOf(hs), http_status: res.status,
      };
    }
    if (res.ok) {
      return { probe: 'matrix_whoami', ok: false, reason: 'whoami 返回里没有 user_id', http_status: res.status };
    }
    return { probe: 'matrix_whoami', ok: false, reason: `whoami HTTP ${res.status}`, http_status: res.status };
  } catch (e) {
    return unreachable('matrix_whoami', e);
  }
}

// ── 探针 2：oidc（userinfo 内省）─────────────────────────────────────
async function probeOidc(env, fetchImpl) {
  const issuer = env.OIDC_ISSUER || '';
  let token = env.OIDC_ACCESS_TOKEN || '';
  const tokFile = env.OIDC_TOKEN_FILE || '';
  if (!token && tokFile) {
    try { token = fs.readFileSync(tokFile, 'utf8').trim(); } catch { /* 读不到按缺令牌处理 */ }
  }
  if (!issuer || !token) {
    return {
      probe: 'oidc_userinfo', ok: false,
      reason: `缺 ${!issuer ? 'OIDC_ISSUER' : ''}${!issuer && !token ? ' 与 ' : ''}${!token ? 'OIDC_ACCESS_TOKEN（或 OIDC_TOKEN_FILE）' : ''}`,
    };
  }
  try {
    // 发现端点拿 userinfo_url——不假设路径，这是 OIDC 与硬编码 URL 的区别
    const disc = await fetchJson(issuer.replace(/\/+$/, '') + '/.well-known/openid-configuration', {}, fetchImpl);
    if (!disc.res.ok || !disc.body?.userinfo_endpoint) {
      return { probe: 'oidc_userinfo', ok: false, reason: `discovery HTTP ${disc.res.status} 或无 userinfo_endpoint`, http_status: disc.res.status };
    }
    const uiUrl = disc.body.userinfo_endpoint;
    const ui = await fetchJson(uiUrl, { headers: { Authorization: `Bearer ${token}` } }, fetchImpl);
    if (ui.res.ok && ui.body && typeof ui.body.sub === 'string' && ui.body.sub) {
      return {
        probe: 'oidc_userinfo', ok: true, source: 'attested',
        id: ui.body.sub, issuer: hostOf(uiUrl), homeserver: hostOf(uiUrl),
        http_status: ui.res.status,
      };
    }
    return {
      probe: 'oidc_userinfo', ok: false,
      reason: ui.body?.error ? `userinfo ${ui.body.error}` : `userinfo HTTP ${ui.res.status}`,
      http_status: ui.res.status,
    };
  } catch (e) {
    return unreachable('oidc_userinfo', e);
  }
}

// ── 探针 3：spiffe（JWT-SVID 本地签名验证）───────────────────────────
function b64urlToJson(part) {
  try {
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch { return null; }
}

async function verifyJwtSvid(token, bundleUrl, fetchImpl) {
  const seg = String(token || '').trim().split('.');
  if (seg.length !== 3) return { ok: false, reason: 'SVID 不是三段式 JWT' };
  const header = b64urlToJson(seg[0]);
  const payload = b64urlToJson(seg[1]);
  if (!header || !payload) return { ok: false, reason: 'SVID 头或载荷解不开' };

  // 过期先于签名查：便宜的错误先报
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number') return { ok: false, reason: 'SVID 无 exp' };
  if (payload.exp <= now) return { ok: false, reason: `SVID 已过期（exp=${payload.exp} < now=${now}）` };
  if (typeof payload.sub !== 'string' || !payload.sub.startsWith('spiffe://')) {
    return { ok: false, reason: `sub 不是 SPIFFE ID：${String(payload.sub).slice(0, 40)}` };
  }

  const bundle = await fetchJson(bundleUrl, {}, fetchImpl);
  if (!bundle.res.ok || !Array.isArray(bundle.body?.keys)) {
    return { ok: false, reason: `信任域 JWKS 拿不到（HTTP ${bundle.res.status}）`, unreachable: false };
  }
  const jwk = bundle.body.keys.find(k => !header.kid || k.kid === header.kid)
    || bundle.body.keys[0];
  if (!jwk) return { ok: false, reason: 'JWKS 里没有匹配 kid 的密钥' };

  let key;
  try {
    key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch (e) {
    return { ok: false, reason: `JWKS 公钥导入失败：${e.message}` };
  }
  const alg = header.alg === 'ES256' ? 'SHA256' : 'RSA-SHA256';
  if (!['RS256', 'ES256'].includes(header.alg)) {
    return { ok: false, reason: `不支持的签名算法：${header.alg}` };
  }
  const sig = Buffer.from(seg[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const data = Buffer.from(`${seg[0]}.${seg[1]}`);
  const okSig = crypto.verify(alg, data, key, sig);
  if (!okSig) return { ok: false, reason: '签名验证失败——这份 SVID 不是信任域密钥签的' };
  return { ok: true, sub: payload.sub, exp: payload.exp, alg: header.alg };
}

async function probeSpiffe(env, fetchImpl) {
  const svidFile = env.SPIFFE_SVID_FILE || '';
  const bundleUrl = env.SPIFFE_BUNDLE_URL || '';
  if (!svidFile || !bundleUrl) {
    return {
      probe: 'spiffe_jwtsvid', ok: false,
      reason: `缺 ${!svidFile ? 'SPIFFE_SVID_FILE' : ''}${!svidFile && !bundleUrl ? ' 与 ' : ''}${!bundleUrl ? 'SPIFFE_BUNDLE_URL' : ''}`,
    };
  }
  let token = '';
  try { token = fs.readFileSync(svidFile, 'utf8').trim(); } catch (e) {
    return { probe: 'spiffe_jwtsvid', ok: false, reason: `SVID 文件读不到：${e.message}` };
  }
  try {
    const v = await verifyJwtSvid(token, bundleUrl, fetchImpl);
    if (!v.ok) return { probe: 'spiffe_jwtsvid', ok: false, reason: v.reason };
    return {
      probe: 'spiffe_jwtsvid', ok: true, source: 'attested',
      id: v.sub, issuer: hostOf(bundleUrl), homeserver: hostOf(bundleUrl),
      verified_locally: true, sig_alg: v.alg,
    };
  } catch (e) {
    return unreachable('spiffe_jwtsvid', e);
  }
}

// ── 探针 4：k8s（TokenReview）────────────────────────────────────────
async function probeK8s(env, fetchImpl) {
  let token = env.K8S_TOKEN || '';
  const tokFile = env.K8S_TOKEN_FILE || '';
  if (!token && tokFile) {
    try { token = fs.readFileSync(tokFile, 'utf8').trim(); } catch { /* 同上 */ }
  }
  const api = env.K8S_API_URL
    || (env.KUBERNETES_SERVICE_HOST && env.KUBERNETES_SERVICE_PORT_HTTPS
      ? `https://${env.KUBERNETES_SERVICE_HOST}:${env.KUBERNETES_SERVICE_PORT_HTTPS}` : '');
  if (!api || !token) {
    return {
      probe: 'k8s_tokenreview', ok: false,
      reason: `缺 ${!api ? 'K8S_API_URL（或 KUBERNETES_SERVICE_HOST/PORT）' : ''}${!api && !token ? ' 与 ' : ''}${!token ? 'K8S_TOKEN（或 K8S_TOKEN_FILE）' : ''}`,
    };
  }
  try {
    const { res, body } = await fetchJson(
      api.replace(/\/+$/, '') + '/apis/authentication.k8s.io/v1/tokenreviews',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          apiVersion: 'authentication.k8s.io/v1', kind: 'TokenReview',
          spec: { token },
        }),
      }, fetchImpl,
    );
    if (res.ok && body?.status?.authenticated === true && body?.status?.user?.username) {
      return {
        probe: 'k8s_tokenreview', ok: true, source: 'attested',
        id: body.status.user.username, issuer: hostOf(api), homeserver: hostOf(api),
        http_status: res.status,
      };
    }
    const why = body?.status?.error || (res.ok ? 'apiserver 判 authenticated=false' : `TokenReview HTTP ${res.status}`);
    return { probe: 'k8s_tokenreview', ok: false, reason: why, http_status: res.status };
  } catch (e) {
    return unreachable('k8s_tokenreview', e);
  }
}

/**
 * 按名字跑某一条锚。未知名字抛错——静默回落到 declared 是本层最不能犯的错。
 */
export async function probeAnchor(kind, env = process.env, fetchImpl = globalThis.fetch) {
  switch (kind) {
    case 'matrix': return probeMatrix(env, fetchImpl);
    case 'oidc': return probeOidc(env, fetchImpl);
    case 'spiffe': return probeSpiffe(env, fetchImpl);
    case 'k8s': return probeK8s(env, fetchImpl);
    default: throw new Error(`未知的身份锚类型：${kind}（可选：${ANCHOR_KINDS.join('/')}）`);
  }
}

/**
 * 解析要用哪几条锚、什么顺序。
 *
 * 显式指定 AGENTTEAMS_IDENTITY_ANCHOR 时只跑那一条——确定性优先，
 * 不给「配错了悄悄滑到另一条」留门。auto（默认）按配置了哪些环境变量决定顺序：
 * matrix → oidc → spiffe → k8s，第一条产出 attested 即胜出，其余照旧全量披露。
 */
export function resolveAnchorOrder(env = process.env) {
  const want = String(env.AGENTTEAMS_IDENTITY_ANCHOR || 'auto').trim().toLowerCase();
  if (want === 'auto') {
    const order = [];
    if ((env.MATRIX_HOMESERVER_URL || env.MATRIX_HOMESERVER) && env.MATRIX_ACCESS_TOKEN) order.push('matrix');
    if ((env.OIDC_ISSUER && (env.OIDC_ACCESS_TOKEN || env.OIDC_TOKEN_FILE))) order.push('oidc');
    if (env.SPIFFE_SVID_FILE && env.SPIFFE_BUNDLE_URL) order.push('spiffe');
    if ((env.K8S_TOKEN || env.K8S_TOKEN_FILE) && (env.K8S_API_URL || env.KUBERNETES_SERVICE_HOST)) order.push('k8s');
    return order.length ? order : ['matrix']; // 兜底保持旧行为：给出「缺环境变量」的可读原因
  }
  if (!ANCHOR_KINDS.includes(want)) {
    throw new Error(`AGENTTEAMS_IDENTITY_ANCHOR=${want} 不认识（可选：auto/${ANCHOR_KINDS.join('/')}）`);
  }
  return [want];
}
