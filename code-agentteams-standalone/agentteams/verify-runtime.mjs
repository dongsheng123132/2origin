#!/usr/bin/env node
import { buildConfig, parseArgs, runCommand, classifyPin } from './runtime.mjs';

const results = [];
async function t(id, name, fn) {
  try {
    const detail = await fn();
    results.push({ id, name, ok: detail === true, detail: detail === true ? '' : String(detail) });
  } catch (error) { results.push({ id, name, ok: false, detail: error.stack || error.message }); }
}

function fixture(overrides = {}) {
  const calls = [];
  const state = {
    pin: true, docker: true, running: true, endpoints: true,
    ...overrides,
  };
  const deps = {
    sleep: async () => {},
    pinStatus: async () => ({ alive: state.pin }),
    startPin: async () => { calls.push('startPin'); state.pin = true; return { ok: true }; },
    stopPin: async () => { calls.push('stopPin'); state.pin = false; return { ok: true }; },
    dockerInfo: async () => ({ ok: state.docker, version: state.docker ? '29.7.2' : null, error: state.docker ? null : 'offline' }),
    inspectContainers: async () => ({ ok: true, states: ['agentteams-controller','agentteams-manager','agentteams-dashboard'].map(name => ({ name, status: state.running ? 'running' : 'exited', restart_count: 0 })) }),
    startContainers: async () => { calls.push('startContainers'); state.running = true; return { ok: true }; },
    stopContainers: async () => { calls.push('stopContainers'); state.running = false; return { ok: true }; },
    probeHttp: async endpoint => ({ name: endpoint.name, url: endpoint.url, ok: state.endpoints, status: state.endpoints ? 200 : null }),
  };
  return { deps, calls, state };
}

const config = buildConfig({});

await t('R1', '参数解析：status 是 health 别名，dry-run 可组合', async () => {
  const p = parseArgs(['status', '--dry-run']);
  return p.command === 'health' && p.dryRun === true || JSON.stringify(p);
});

await t('R2', '【反向】容器名含 shell 元字符必须在执行前拒绝', async () => {
  try { buildConfig({ AT_CONTAINERS: 'ok;rm,-bad' }); return '没有拒绝'; }
  catch { return true; }
});

await t('R3', 'health 不是只看 Docker：HTTP 任一失败即 unhealthy/exit 3', async () => {
  const f = fixture({ endpoints: false });
  const r = await runCommand('health', { config, deps: f.deps });
  return r.exitCode === 3 && r.result.status === 'unhealthy' || JSON.stringify(r.result);
});

await t('R4', 'start 幂等：全健康时不重复启动 pin 或容器', async () => {
  const f = fixture();
  const r = await runCommand('start', { config, deps: f.deps });
  return r.exitCode === 0 && f.calls.length === 0 && r.result.actions.pin === 'already_running' || `${JSON.stringify(r.result)} calls=${f.calls}`;
});

await t('R5', 'start 能恢复 pin 与已停止容器，再以四层健康为准', async () => {
  const f = fixture({ pin: false, running: false });
  const r = await runCommand('start', { config, deps: f.deps });
  return r.exitCode === 0 && f.calls.join(',') === 'startPin,startContainers' && r.result.evidence.healthy || `${JSON.stringify(r.result)} calls=${f.calls}`;
});

await t('R6', '【反向】Docker 不可达时 start 失败在 docker，不伪报容器坏', async () => {
  const f = fixture({ docker: false });
  const r = await runCommand('start', { config: { ...config, startTimeoutMs: 1 }, deps: f.deps });
  return r.exitCode === 4 && r.result.stage === 'docker' || JSON.stringify(r.result);
});

await t('R7', 'stop 顺序固定：先停业务容器，再停专属 pin', async () => {
  const f = fixture();
  const r = await runCommand('stop', { config, deps: f.deps });
  return r.exitCode === 0 && f.calls.join(',') === 'stopContainers,stopPin' || `${JSON.stringify(r.result)} calls=${f.calls}`;
});

await t('R8', 'dry-run 零副作用且公开动作计划', async () => {
  const f = fixture();
  const r = await runCommand('stop', { dryRun: true, config, deps: f.deps });
  return r.result.status === 'dry_run' && f.calls.length === 0 && r.result.plan.length === 2 || JSON.stringify(r.result);
});

// ── R9~R13：pin 探测三态（仪器失效不许冒充被测对象属性）──────────────────
// 这台机器上 wsl.exe 无论成败都吐一串 "wsl: Failed to translate 'X:\…'"，
// 旧写法把它整个塞进 pin.error，于是「pin 没起」与「wsl 坏了」长得一模一样。
const PATH_NOISE = [
  "wsl: Failed to translate 'E:\\U-Hermes\\data\\home\\bin'",
  "wsl: Failed to translate 'H:\\U-Claw\\resources\\cli'",
].join('\n');

await t('R9', 'pin 活着时判 alive（PATH 告警不影响判决）', async () => {
  const p = classifyPin({ code: 0, stdout: 'alive', stderr: PATH_NOISE });
  return (p.alive === true && p.probe === 'ok' && p.error === null) || JSON.stringify(p);
});

await t('R10', '【反向】只有 PATH 告警、没有真诊断 ⇒ 判「探不动」而不是「没起」', async () => {
  const p = classifyPin({ code: 1, stdout: '', stderr: PATH_NOISE });
  if (p.alive === false) return '把仪器失效判成了「pin 没起」——这正是本判据要拦的';
  // 注意用 !!p.error：写成 `… && p.error` 会返回那个字符串而不是 true，判据当场自伤（踩过）
  return (p.alive === null && p.probe === 'failed' && !!p.error) || JSON.stringify(p);
});

await t('R11', '有真诊断时判「确实没起」，且那是一次有效观察（不算仪器失效）', async () => {
  const p = classifyPin({ code: 1, stdout: '',
    stderr: `${PATH_NOISE}\ncat: /tmp/shadowos-agentteams-pin.pid: No such file or directory` });
  return (p.alive === false && p.probe === 'ok' && p.error === null
    && /No such file/.test(p.detail || '')) || JSON.stringify(p);
});

await t('R12', '【反向】PATH 告警绝不许泄进 error/detail，只出计数与一条样例', async () => {
  for (const r of [{ code: 0, stdout: 'alive', stderr: PATH_NOISE },
                   { code: 1, stdout: '', stderr: PATH_NOISE },
                   { code: 1, stdout: '', stderr: `${PATH_NOISE}\ncat: nope` }]) {
    const p = classifyPin(r);
    const leaked = /Failed to translate/.test(String(p.error || '') + String(p.detail || ''));
    if (leaked) return `PATH 告警泄进了 error/detail: ${JSON.stringify(p)}`;
    if (!p.path_warnings || p.path_warnings.count !== 2) return `告警计数不对: ${JSON.stringify(p.path_warnings)}`;
  }
  return true;
});

await t('R13', '【反向】探不动必须与「看见了坏」用不同退出码（4 vs 3）', async () => {
  const f1 = fixture(); f1.deps.pinStatus = async () => classifyPin({ code: 1, stdout: '', stderr: PATH_NOISE });
  const r1 = await runCommand('health', { config, deps: f1.deps });
  const f2 = fixture({ pin: false }); f2.deps.pinStatus = async () =>
    classifyPin({ code: 1, stdout: '', stderr: `${PATH_NOISE}\ncat: nope` });
  const r2 = await runCommand('health', { config, deps: f2.deps });
  if (r1.exitCode === r2.exitCode) return `探不动与看见坏共用退出码 ${r1.exitCode}——分不出「去起 pin」和「先修 wsl」`;
  return (r1.exitCode === 4 && r1.result.status === 'undetermined'
    && r2.exitCode === 3 && r2.result.status === 'unhealthy')
    || `探不动=${r1.exitCode}/${r1.result.status}　看见坏=${r2.exitCode}/${r2.result.status}`;
});

for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.id.padEnd(4)} ${r.name}${r.ok ? '' : `\n     ${r.detail}`}`);
const pass = results.filter(x => x.ok).length;
console.log(`\n═══ AgentTeams runtime 一致性验证（${pass}/${results.length}）═══`);
process.exit(pass === results.length ? 0 : 1);
