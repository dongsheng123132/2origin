#!/usr/bin/env node
// runtime.mjs — AgentTeams on WSL lifecycle CLI
// stdout: exactly one runtime.result JSON line. stderr: human diagnostics.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

export const SPEC = 'agentteams-runtime/0.1';
const execFileAsync = promisify(execFile);
const PIN_FILE = '/tmp/shadowos-agentteams-pin.pid';

function positiveInt(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} 必须是正整数`);
  return n;
}

export function buildConfig(env = process.env) {
  const containers = String(env.AT_CONTAINERS || 'agentteams-controller,agentteams-manager,agentteams-dashboard')
    .split(',').map(x => x.trim()).filter(Boolean);
  if (!containers.length || containers.some(x => !/^[A-Za-z0-9_.-]+$/.test(x))) {
    throw new Error('AT_CONTAINERS 只允许逗号分隔的 Docker 容器名');
  }
  const endpoints = [
    { name: 'matrix', url: env.AT_MATRIX_URL || 'http://127.0.0.1:18080/_matrix/client/versions' },
    { name: 'manager', url: env.AT_MANAGER_URL || 'http://127.0.0.1:18888/' },
    { name: 'dashboard', url: env.AT_DASHBOARD_URL || 'http://127.0.0.1:13000/' },
  ];
  for (const endpoint of endpoints) {
    let parsed;
    try { parsed = new URL(endpoint.url); } catch { throw new Error(`${endpoint.name} URL 不合法`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${endpoint.name} URL 只允许 http/https`);
  }
  return {
    distro: String(env.AT_WSL_DISTRO || 'Ubuntu'),
    containers,
    endpoints,
    commandTimeoutMs: positiveInt(env.AT_COMMAND_TIMEOUT_MS, 20_000, 'AT_COMMAND_TIMEOUT_MS'),
    startTimeoutMs: positiveInt(env.AT_START_TIMEOUT_MS, 45_000, 'AT_START_TIMEOUT_MS'),
    httpTimeoutMs: positiveInt(env.AT_HTTP_TIMEOUT_MS, 5_000, 'AT_HTTP_TIMEOUT_MS'),
  };
}

export function parseArgs(argv) {
  let command = 'health';
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--help' || arg === '-h') command = 'help';
    else if (!arg.startsWith('-') && command === 'health') command = arg;
    else throw new Error(`未知参数 ${arg}`);
  }
  if (command === 'status') command = 'health';
  if (!['start', 'health', 'stop', 'help'].includes(command)) throw new Error(`未知命令 ${command}`);
  return { command, dryRun };
}

function compactError(value, limit = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function publicUrl(value) {
  const url = new URL(value);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function execCapture(file, args, timeoutMs) {
  try {
    const { stdout = '', stderr = '' } = await execFileAsync(file, args, {
      encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024,
    });
    return { code: 0, stdout: String(stdout), stderr: String(stderr) };
  } catch (error) {
    return {
      code: Number.isInteger(error?.code) ? error.code : (error?.killed ? 124 : 1),
      stdout: String(error?.stdout || ''), stderr: String(error?.stderr || ''),
      error: compactError(error?.message),
    };
  }
}

// ── pin 探测：**三态，不是二值** ───────────────────────────────────────────
//
// 这台机器上 wsl.exe 无论成功失败都会往 stderr 吐一串
//   wsl: Failed to translate 'E:\U-Claw\resources\cli'
// ——那是它映射不到的 Windows PATH 盘符，与 pin 死活毫无关系。
// 旧写法 `error: compactError(r.stderr)` 把这串告警和真信号（cat: …pin.pid 不存在）
// 搅在一起，于是**「pin 没起」和「wsl 自己跑不起来」长得一模一样**。
// 那正是本仓库反复在修的那条：仪器自己的失效不许冒充被测对象的属性
// （学堂经验 L-8eaac9b426c4 说的就是这个）。
//
// 所以拆成三态：
//   alive: true            —— 探到了，活着
//   alive: false           —— **探到了**，确实没起（这是一次有效观察）
//   alive: null            —— 探不动（wsl 自己的问题），**不构成关于 pin 的任何证据**
// PATH 告警单独放 path_warnings，只出条数与样例，不混进 error。
export const PIN_PATH_WARNING = /^wsl:\s*Failed to translate\s/i;

export function classifyPin(r) {
  const lines = String(r.stderr || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const warnings = lines.filter(l => PIN_PATH_WARNING.test(l));
  const real = lines.filter(l => !PIN_PATH_WARNING.test(l));
  const pathWarnings = warnings.length
    ? { count: warnings.length, sample: warnings[0].slice(0, 120) }
    : null;

  // 探到了：wsl 跑通并给出了可判读的 stdout。
  if (r.code === 0) {
    return { alive: r.stdout.trim() === 'alive', probe: 'ok', error: null, path_warnings: pathWarnings };
  }
  // 退出码非 0 但 shell 给出了真实诊断（如 cat: …: No such file）＝ 探到了，只是没起。
  // 判据是「除 PATH 告警之外还剩下东西」，而不是「有没有 stderr」——后者永远为真。
  if (real.length) {
    return { alive: false, probe: 'ok', error: null, detail: compactError(real.join(' ')), path_warnings: pathWarnings };
  }
  // 剩下的才是仪器失效：wsl 没跑起来，我们对 pin 一无所知。
  return {
    alive: null, probe: 'failed',
    error: compactError(r.error || `wsl 退出码 ${r.code}，除 PATH 告警外无诊断输出`),
    path_warnings: pathWarnings,
  };
}

function realDependencies(config) {
  const wslExe = process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\wsl.exe` : 'wsl.exe';
  const wsl = script => execCapture(wslExe, ['-d', config.distro, '-u', 'root', '--', 'sh', '-lc', script], config.commandTimeoutMs);
  const pinCheckScript = `test -r ${PIN_FILE} && kill -0 "$(cat ${PIN_FILE})" 2>/dev/null && printf alive`;
  return {
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    async pinStatus() {
      const r = await wsl(pinCheckScript);
      return classifyPin(r);
    },
    async startPin() {
      if (process.platform !== 'win32') return { ok: false, error: 'start 目前只支持 Windows + WSL2' };
      await wsl(`rm -f ${PIN_FILE}`);
      const script = `umask 077; printf '%s\\n' "$$" > ${PIN_FILE}; exec sleep infinity`;
      try {
        const child = spawn(wslExe, ['-d', config.distro, '-u', 'root', '--', 'sh', '-lc', script], {
          detached: true, stdio: 'ignore', windowsHide: true,
        });
        child.unref();
        return { ok: true, windows_pid: child.pid };
      } catch (error) {
        return { ok: false, error: compactError(error?.message) };
      }
    },
    async stopPin() {
      const r = await wsl(`if test -r ${PIN_FILE}; then pid="$(cat ${PIN_FILE})"; kill "$pid" 2>/dev/null || true; rm -f ${PIN_FILE}; fi`);
      return { ok: r.code === 0, error: r.code === 0 ? null : compactError(r.stderr || r.error) };
    },
    async dockerInfo() {
      const r = await wsl(`docker info --format '{{.ServerVersion}}'`);
      return { ok: r.code === 0 && Boolean(r.stdout.trim()), version: r.stdout.trim() || null, error: r.code === 0 ? null : compactError(r.stderr || r.error) };
    },
    async inspectContainers() {
      const names = config.containers.join(' ');
      const r = await wsl(`docker inspect --format '{{.Name}}|{{.State.Status}}|{{.RestartCount}}' ${names}`);
      if (r.code !== 0) return { ok: false, states: [], error: compactError(r.stderr || r.error) };
      const states = r.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => {
        const [rawName, status, restartCount] = line.split('|');
        return { name: String(rawName || '').replace(/^\//, ''), status, restart_count: Number(restartCount || 0) };
      });
      return { ok: states.length === config.containers.length, states, error: states.length === config.containers.length ? null : '容器数量不完整' };
    },
    async startContainers() {
      const r = await wsl(`docker start ${config.containers.join(' ')}`);
      return { ok: r.code === 0, error: r.code === 0 ? null : compactError(r.stderr || r.error) };
    },
    async stopContainers() {
      const r = await wsl(`docker stop --time 15 ${config.containers.join(' ')}`);
      return { ok: r.code === 0, error: r.code === 0 ? null : compactError(r.stderr || r.error) };
    },
    async probeHttp(endpoint) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.httpTimeoutMs);
      const started = Date.now();
      try {
        const response = await fetch(endpoint.url, { signal: controller.signal, redirect: 'manual' });
        return { name: endpoint.name, url: publicUrl(endpoint.url), ok: response.status >= 200 && response.status < 400, status: response.status, latency_ms: Date.now() - started };
      } catch (error) {
        return { name: endpoint.name, url: publicUrl(endpoint.url), ok: false, status: null, latency_ms: Date.now() - started, error: compactError(error?.message) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export async function healthSnapshot(deps, config) {
  const [pin, docker, containers, endpoints] = await Promise.all([
    deps.pinStatus(), deps.dockerInfo(), deps.inspectContainers(),
    Promise.all(config.endpoints.map(endpoint => deps.probeHttp(endpoint))),
  ]);
  const allContainers = containers.ok && containers.states.length === config.containers.length
    && containers.states.every(x => x.status === 'running');
  const allEndpoints = endpoints.every(x => x.ok);
  const healthy = pin.alive === true && docker.ok && allContainers && allEndpoints;
  // 探不动 ≠ 不健康。前者是我们**没看见**，后者是我们**看见了坏**。
  // 混成一格，运维就无法区分「去把 pin 起起来」和「先修 wsl 再谈」。
  const undetermined = pin.alive === null || pin.probe === 'failed';
  return {
    healthy,
    undetermined,
    pin,
    docker,
    containers: { ok: allContainers, states: containers.states, error: containers.error || null },
    endpoints,
  };
}

async function waitUntil(check, timeoutMs, deps, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() <= deadline) {
    last = await check();
    if (last.ok) return last;
    await deps.sleep(intervalMs);
  }
  return last || { ok: false, error: 'timeout' };
}

export async function runCommand(command, { dryRun = false, config, deps }) {
  if (command === 'help') {
    return { exitCode: 0, result: { spec: SPEC, kind: 'runtime.result', verb: 'help', status: 'done', usage: 'node agentteams/runtime.mjs <start|health|stop> [--dry-run]' } };
  }
  if (dryRun) {
    return { exitCode: 0, result: { spec: SPEC, kind: 'runtime.result', verb: command, status: 'dry_run', plan: command === 'start'
      ? ['ensure dedicated WSL pin', 'wait for Docker', 'start three AgentTeams containers', 'probe three HTTP endpoints']
      : command === 'stop' ? ['stop three AgentTeams containers', 'stop dedicated WSL pin'] : ['read pin, Docker, containers and HTTP endpoints'] } };
  }
  if (command === 'health') {
    const evidence = await healthSnapshot(deps, config);
    // 退出码三分：0=健康　3=看见了坏　4=探不动（仪器失效，不构成关于被测对象的判断）。
    // 把 4 并进 3 就等于让「wsl 坏了」冒充「服务挂了」——那是本仓库明令禁止的那件事。
    const exitCode = evidence.healthy ? 0 : (evidence.undetermined ? 4 : 3);
    const status = evidence.healthy ? 'healthy' : (evidence.undetermined ? 'undetermined' : 'unhealthy');
    return { exitCode, result: { spec: SPEC, kind: 'runtime.result', verb: 'health', status, evidence } };
  }
  if (command === 'start') {
    let pin = await deps.pinStatus();
    let pinAction = 'already_running';
    if (!pin.alive) {
      const started = await deps.startPin();
      if (!started.ok) return { exitCode: 4, result: { spec: SPEC, kind: 'runtime.result', verb: 'start', status: 'failed', stage: 'pin', error: started.error } };
      pinAction = 'started';
      pin = await waitUntil(async () => {
        const current = await deps.pinStatus();
        return { ...current, ok: current.alive };
      }, Math.min(config.startTimeoutMs, 10_000), deps);
      if (!pin.ok) return { exitCode: 4, result: { spec: SPEC, kind: 'runtime.result', verb: 'start', status: 'failed', stage: 'pin_ready', error: pin.error || 'pin 未就绪' } };
    }
    const docker = await waitUntil(() => deps.dockerInfo(), config.startTimeoutMs, deps, 750);
    if (!docker.ok) return { exitCode: 4, result: { spec: SPEC, kind: 'runtime.result', verb: 'start', status: 'failed', stage: 'docker', error: docker.error } };
    let containers = await deps.inspectContainers();
    if (!containers.ok) return { exitCode: 4, result: { spec: SPEC, kind: 'runtime.result', verb: 'start', status: 'failed', stage: 'inspect', error: containers.error } };
    let containerAction = 'already_running';
    if (containers.states.some(x => x.status !== 'running')) {
      const started = await deps.startContainers();
      if (!started.ok) return { exitCode: 4, result: { spec: SPEC, kind: 'runtime.result', verb: 'start', status: 'failed', stage: 'containers', error: started.error } };
      containerAction = 'started';
    }
    const ready = await waitUntil(async () => {
      const evidence = await healthSnapshot(deps, config);
      return { ok: evidence.healthy, evidence };
    }, config.startTimeoutMs, deps, 750);
    if (!ready.ok) return { exitCode: 4, result: { spec: SPEC, kind: 'runtime.result', verb: 'start', status: 'failed', stage: 'health', actions: { pin: pinAction, containers: containerAction }, evidence: ready.evidence } };
    return { exitCode: 0, result: { spec: SPEC, kind: 'runtime.result', verb: 'start', status: 'done', actions: { pin: pinAction, containers: containerAction }, evidence: ready.evidence } };
  }
  const containerStop = await deps.stopContainers();
  const pinStop = await deps.stopPin();
  const ok = containerStop.ok && pinStop.ok;
  return { exitCode: ok ? 0 : 4, result: { spec: SPEC, kind: 'runtime.result', verb: 'stop', status: ok ? 'done' : 'partial_failure', actions: { containers: containerStop, pin: pinStop } } };
}

export async function cli(argv = process.argv.slice(2), env = process.env) {
  let parsed;
  let config;
  try { parsed = parseArgs(argv); config = buildConfig(env); }
  catch (error) {
    return { exitCode: 1, result: { spec: SPEC, kind: 'runtime.result', verb: 'usage', status: 'failed', error: compactError(error?.message) } };
  }
  return runCommand(parsed.command, { dryRun: parsed.dryRun, config, deps: realDependencies(config) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { exitCode, result } = await cli();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(exitCode);
}
