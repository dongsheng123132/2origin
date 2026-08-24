#!/usr/bin/env node
// stub-homeserver.mjs — 判据用的假 homeserver（agentteams-bridge/0.1）
//
// ⚠ 这是一个**测试替身**，不是协议的一部分。它存在的唯一理由是：
//    让「问过服务器」这条代码路径能在没有 Docker / 没有 Tuwunel 的机器上被走通并被判据观察到。
//
// **它证明不了任何关于身份强度的事。** 它由判据自己启动、自己控制、自己发令牌——
// 拿它的绿灯去主张「Worker 身份已被外部签发」，就是把「我们控制不了的签发者」
// 换成了「我们自己写的那个」，正是本模块要治的病本身。真实强度只在真 Tuwunel 上谈。
//
// 必须跑在**独立进程**里：判据用 spawnSync 调 certify.mjs，那会阻塞判据进程的事件循环，
// 同进程内的 http.Server 一个连接都接不了。第一版就是这么写的，结果 9 条判据集体
// 报「够不着 homeserver」——**仪器失效被读成了被测对象的属性**，
// 而这恰好是 identity.mjs 里 unreachable 那一格要防的事，在判据框架自己身上复发了一次。
//
// 用法：node agentteams/stub-homeserver.mjs
//   启动后往 stdout 打一行 JSON：{"ready":true,"url":"http://127.0.0.1:PORT"}
//   收到 SIGTERM 或 stdin 关闭即退出。
import http from 'node:http';

// 令牌 → 身份。判据靠这张表制造「两个不同的 Agent」。
const TOKENS = {
  'tok-alice': '@worker-alice:test.local',      // 作者
  'tok-bob': '@worker-bob:test.local',          // 考官
  'tok-carol': '@worker-carol:test.local',      // 取象（v0.2 新增的第三个职能）
  // tok-empty 故意返回 200 但不带 user_id：制造「存在性检查冒充验证」的反向用例
};

const server = http.createServer((req, res) => {
  if (!req.url.startsWith('/_matrix/client/v3/account/whoami')) {
    res.writeHead(404, { 'content-type': 'application/json' }).end('{}');
    return;
  }
  const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (tok === 'tok-empty') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    return;
  }
  const uid = TOKENS[tok];
  if (!uid) {
    res.writeHead(401, { 'content-type': 'application/json' }).end('{"errcode":"M_UNKNOWN_TOKEN"}');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' })
     .end(JSON.stringify({ user_id: uid, device_id: 'DEV-' + tok.slice(4).toUpperCase() }));
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(JSON.stringify({ ready: true, url: `http://127.0.0.1:${server.address().port}` }) + '\n');
});

const bye = () => { try { server.close(); } catch { /* ignore */ } process.exit(0); };
process.on('SIGTERM', bye);
process.on('SIGINT', bye);
process.stdin.on('end', bye);
process.stdin.resume();
