// identity.mjs — 身份取象（agentteams-bridge/0.1）
//
// 回答一个问题：**「我是谁」这件事，谁说了算。**
//
// 本仓库已经有一条同型的答案。governance/anchor.mjs 那段写着：本机 git 没有 remote、
// commit date 可以任意伪造，所以仓库里的任何时间主张都不可外部核验——解法是把指纹交给
// OpenTimestamps，让**我们控制不了的东西**盖章。
//
// 身份是同一个洞的另一半。学籍的 detectActor() 观察 harness 与 model，但那两样都是
// 本进程自己看自己；换个 harness 原样跑一遍，写出来的 actor 就是另一个名字。单进程下
// 这不要紧，因为「作者」和「考官」是同一台机器上的两个程序，谁跑的都一样。
//
// 多 Agent 下就要紧了。学堂的规则是「verified 只能由考试给」，而考试是 exam.mjs——
// 一个任何 Worker 都能自己跑的脚本。Worker 干完活，自己跑一遍 exam，自己给自己发证，
// 全程符合现有的每一道闸门。**「作者不能给自己发证」在多 Agent 上是空的**，
// 因为没有任何东西能证明跑考试的那个进程不是干活的那个进程。
//
// AgentTeams 补上的正是这一样：Worker 的 Matrix 身份由 homeserver 签发，
// `/_matrix/client/v3/account/whoami` 的答案来自一个我们控制不了的进程。
// 于是身份有了外部锚，跟时间锚在比特币上是同一条原则的两个实例。
//
// ── 三种出处，可伪造性根本不同（同 RFC-0009 对 expect_sha256 与 confirm 的区分）──
//   attested  问过 homeserver。要伪造就得先有一个 homeserver 认的 access token，
//             而有了那个 token 你**就是**那个身份——伪造成本 = 老实做的成本。
//   declared  环境变量里写着。进程自己 export 一个就有了，零成本。**不得据此发证。**
//   none      观察不到。
//
// 铁律沿用取象：observe 永不接收「你觉得应该是什么」。传参数直接抛错。
import os from 'node:os';
import crypto from 'node:crypto';

export const SPEC = 'agentteams-bridge/0.1';

const WHOAMI_PATH = '/_matrix/client/v3/account/whoami';
const TIMEOUT_MS = Number(process.env.AGENTTEAMS_WHOAMI_TIMEOUT_MS || 4000);

/**
 * 观察「本进程在 AgentTeams 里是谁」。
 *
 * 不接收任何参数。观察器一旦收预期就退化成确认偏误机——这条铁律在 benxiang/observe.mjs
 * 上是「传第三个参数直接抛错」，这里是「传任何参数都抛错」。
 *
 * 返回值里 probes 是**全部探针的结果**，不是只有胜出的那个。理由同北桥的
 * 「投影必须披露自己丢了什么」：只报结论不报过程，读的人无从判断这个结论有多硬。
 */
export async function observeIdentity(...rest) {
  if (rest.length) {
    throw new Error(
      'observeIdentity 不接收任何参数。身份是观察出来的，不是传进来的——' +
      '要比对「观察到的」与「声称的」，请先拿观察结果，再调 compareIdentity()。'
    );
  }

  const probes = [];

  // ── 探针 1：问 homeserver。唯一能产出 attested 的一条路 ──────────────────
  const hs = process.env.MATRIX_HOMESERVER_URL || process.env.MATRIX_HOMESERVER || '';
  const token = process.env.MATRIX_ACCESS_TOKEN || '';
  if (hs && token) {
    const url = hs.replace(/\/+$/, '') + WHOAMI_PATH;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
      let res;
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ac.signal,
        });
      } finally { clearTimeout(timer); }

      if (res.ok) {
        const body = await res.json();
        if (body && typeof body.user_id === 'string' && body.user_id) {
          probes.push({
            probe: 'matrix_whoami', ok: true, source: 'attested',
            id: body.user_id, device_id: body.device_id || null,
            homeserver: hs, http_status: res.status,
          });
        } else {
          probes.push({ probe: 'matrix_whoami', ok: false, reason: 'whoami 返回里没有 user_id', http_status: res.status });
        }
      } else {
        probes.push({ probe: 'matrix_whoami', ok: false, reason: `whoami HTTP ${res.status}`, http_status: res.status });
      }
    } catch (e) {
      // 「够不着」不是「没身份」——同 anchor.mjs 对日历服务器超时的处理：
      // 仪器自己的失效必须跟被测对象的属性分开报，否则一次网络抖动会被读成一次身份缺失。
      probes.push({
        probe: 'matrix_whoami', ok: false, unreachable: true,
        reason: `够不着 homeserver：${e.name === 'AbortError' ? `超时 ${TIMEOUT_MS}ms` : e.message}`,
      });
    }
  } else {
    probes.push({
      probe: 'matrix_whoami', ok: false,
      reason: `缺 ${!hs ? 'MATRIX_HOMESERVER_URL' : ''}${!hs && !token ? ' 与 ' : ''}${!token ? 'MATRIX_ACCESS_TOKEN' : ''}`,
    });
  }

  // ── 探针 2：环境变量自称。**永远只能是 declared** ──────────────────────
  const declared = process.env.MATRIX_USER_ID || '';
  probes.push(declared
    ? { probe: 'env_matrix_user_id', ok: true, source: 'declared', id: declared }
    : { probe: 'env_matrix_user_id', ok: false, reason: '未设 MATRIX_USER_ID' });

  // ── 探针 3：容器主机名。同样是 declared——进程改得动自己的 hostname ────────
  const host = os.hostname();
  const isWorkerName = /^agentteams-worker-/.test(host);
  probes.push({
    probe: 'hostname', ok: true, source: 'declared', id: host,
    looks_like_worker: isWorkerName,
  });

  // ── 定夺：attested 优先，没有就退到 declared，都没有就 none ───────────────
  const att = probes.find(p => p.ok && p.source === 'attested');
  const dec = probes.find(p => p.ok && p.source === 'declared' && p.probe === 'env_matrix_user_id');

  const winner = att || dec || null;
  const unreachable = probes.some(p => p.probe === 'matrix_whoami' && p.unreachable);

  return {
    spec: SPEC,
    id: winner ? winner.id : null,
    device_id: att ? att.device_id : null,
    source: winner ? winner.source : 'none',
    // attested 是一个**布尔断言**，不是形容词。只有它为 true 才准发证。
    attested: !!att,
    // 「够不着」要单独出，别跟「没身份」混成一格——这正是 anchor.mjs 判决行
    // 把 pending 和 bitcoin 数成一格时犯的错。
    unreachable,
    runtime: process.env.AGENTTEAMS_RUNTIME || null,
    probes,
    at: new Date().toISOString(),
  };
}

/**
 * 把身份压成一个稳定的短指纹，用于「这两个身份是不是同一个」的比对与记账。
 * 不用原 user_id 直接比是因为它要进审计与学历，而 Matrix user id 在企业部署下
 * 可能带真实姓名——同 anchor.mjs 的排除规则：**列名字本身就是泄露**。
 */
export function identityFingerprint(id) {
  if (!id) return null;
  return crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 16);
}

/**
 * 比对必须是拿到观察之后的**第二步**（同取象 compare 的约定）。
 * 这个函数只做比对，不做观察——它拿不到网络，也不读环境变量。
 */
export function compareIdentity(observed, claimed) {
  const oid = observed?.id ?? null;
  const cid = claimed?.id ?? claimed ?? null;
  return {
    same: !!(oid && cid && oid === cid),
    observed_id: oid, claimed_id: cid,
    observed_source: observed?.source ?? 'none',
    // 观察到的是 declared 时，即使 same 为真也不构成证据——说明白，别让调用方误读
    usable_as_evidence: observed?.attested === true,
  };
}

/**
 * 供审计与学历落库的最小身份记录。
 *
 * ── `attested` 是个布尔，而签发强度不是（2026-08-12 实测暴露）────────────────
 *
 * 这个函数最初只落 `attested: true/false`。问题是：**把 MATRIX_HOMESERVER_URL 指向
 * 一个我自己起的服务器，一样得到 `attested: true`。** 于是学历里那条「已由平台签发」
 * 的记录，事后没有任何人能判断它到底有多硬——记录里根本没写是谁签的。
 *
 * 签发强度实际上有四级，而**代码分不出第 2 到第 4 级**（从里面看，homeserver 就是 homeserver）：
 *
 *   ① 同进程 mock ......................... 无意义
 *   ② 独立进程签发者，被测进程拿不到签发权 ... 判据里的 stub 就在这一级
 *   ③ 部署方运营、但 Worker 控制不了 ....... AgentTeams 自带的 Tuwunel
 *   ④ 第三方运营 .......................... 公共 homeserver（2026-08-12 实测：
 *                                            探了 8 个，全部关闭注册或要人机验证）
 *
 * 所以这里**不输出等级**——那会变成一句自封。改为如实记下 `homeserver` 主机名，
 * 把「这个签发者可信到什么程度」留给读账的人判断。同北桥「投影必须披露自己丢了什么」：
 * 我们给不出的结论就别给，但给不出的原因和原始材料必须在场。
 *
 * 记 host 不记完整 URL：路径与查询串可能带令牌，而 host 已经足够回答「谁签的」。
 */
export function identityRecord(observed) {
  const att = observed?.probes?.find(p => p.ok && p.source === 'attested');
  let host = null;
  if (att?.homeserver) {
    try { host = new URL(att.homeserver).host; } catch { host = null; }
  }
  return {
    fp: identityFingerprint(observed?.id),
    source: observed?.source ?? 'none',
    attested: observed?.attested === true,
    // 签发者是谁。attested=true 而 homeserver=null 的记录**不可审计**——
    // 它声称有人签过字，却没留下签字的是谁。
    homeserver: host,
    device_id: observed?.device_id ?? null,
    at: observed?.at ?? new Date().toISOString(),
  };
}
