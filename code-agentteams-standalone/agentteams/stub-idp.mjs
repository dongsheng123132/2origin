#!/usr/bin/env node
// stub-idp.mjs — 承诺⑤判据用的假身份签发者（OIDC + JWKS + K8s TokenReview）
//
// 必须是独立进程：判据框架用 spawnSync 调 certify.mjs，会阻塞本进程的事件循环；
// 第一版把 stub homeserver 起在本进程里，子进程一个连接都建不上，9 条判据集体
// 报「够不着」——仪器失效被读成被测对象属性。这个坑在 stub-homeserver.mjs 上犯过，
// 这里不再犯第二次。
//
// 它只用于走通代码路径，其绿灯**不证明**任何真实签发者的身份强度——同 stub-homeserver。
import http from 'node:http';

const listenPort = Number(process.argv[2] || 0);
const jwks = JSON.parse(process.env.STUB_JWKS || '{"keys":[]}');

const server = http.createServer((req, res) => {
  const respond = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const base = `http://127.0.0.1:${server.address().port}`;

  // OIDC discovery——不硬编码 userinfo 路径，这正是探针走 discovery 的原因
  if (req.url === '/.well-known/openid-configuration') {
    return respond(200, { issuer: base, userinfo_endpoint: `${base}/userinfo` });
  }
  if (req.url === '/userinfo') {
    const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (tok === 'tok-good-oidc') {
      return respond(200, { sub: 'https://sso.example/c|alice@corp', preferred_username: 'alice@corp.example' });
    }
    if (tok === 'tok-empty-oidc') return respond(200, {});   // 反向用例：存在性 ≠ 验证
    return respond(401, { error: 'invalid_token' });
  }
  // SPIFFE 信任域 JWKS
  if (req.url.startsWith('/jwks')) return respond(200, { keys: jwks.keys || [] });
  // K8s TokenReview（projected SA token 的官方核验路径）
  if (req.url === '/apis/authentication.k8s.io/v1/tokenreviews' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let tok = '';
      try { tok = String(JSON.parse(body)?.spec?.token || ''); } catch { /* 按无效处理 */ }
      if (tok === 'sa-token-good') {
        return respond(201, {
          status: {
            authenticated: true,
            user: { username: 'system:serviceaccount:at-demo:examiner-sa' },
          },
        });
      }
      return respond(201, { status: { authenticated: false, error: '[invalid token]' } });
    });
    return;
  }
  respond(404, {});
});

server.listen(listenPort, '127.0.0.1', () => {
  process.stdout.write(JSON.stringify({
    ready: true,
    url: `http://127.0.0.1:${server.address().port}`,
  }) + '\n');
});
