#!/usr/bin/env node
// selfcheck.mjs — no-secret package self-check.
// stdout is exactly one JSON line; child diagnostics are summarized on stderr.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = 'agentteams-selfcheck/0.1';

function parseArgs(argv) {
  const out = { dryRun: false, live: false };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--live') out.live = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`未知参数 ${arg}`);
  }
  return out;
}

function summary(value, max = 240) {
  const lines = String(value || '').trim().split(/\r?\n/).filter(Boolean);
  const line = [...lines].reverse().find(x => /[（(]\d+\s*\/\s*\d+[）)]|通过\s+\d+\s*\/\s*\d+/.test(x)) || lines.at(-1) || '';
  return line.slice(0, max);
}

function runCheck(check) {
  const r = spawnSync(process.execPath, check.args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: check.timeoutMs || 180_000,
    windowsHide: true,
    env: { ...process.env, MATRIX_ACCESS_TOKEN: '', MATRIX_USER_ID: '' },
  });
  const ok = r.status === check.expectExit;
  process.stderr.write(`${ok ? 'PASS' : 'FAIL'} ${check.id}: ${check.label}\n`);
  if (!ok) process.stderr.write(`  exit=${r.status} stdout=${summary(r.stdout)} stderr=${summary(r.stderr)}\n`);
  return {
    id: check.id,
    label: check.label,
    ok,
    exit_code: r.status,
    expected_exit: check.expectExit,
    verdict: summary(r.stdout),
    ...(r.error ? { error: String(r.error.message || r.error).slice(0, 240) } : {}),
  };
}

let args;
try { args = parseArgs(process.argv.slice(2)); }
catch (error) {
  process.stdout.write(`${JSON.stringify({ spec: SPEC, kind: 'selfcheck.result', status: 'usage_error', error: error.message })}\n`);
  process.exit(1);
}

const checks = [
  { id: 'runtime-contract', label: '运行控制契约与故障注入', args: ['agentteams/verify-runtime.mjs'], expectExit: 0 },
  { id: 'certification-gate', label: '三身份发证闸门与反向用例', args: ['agentteams/verify-agentteams.mjs'], expectExit: 0 },
  { id: 'runtime-plan', label: '启动计划可解析且无副作用', args: ['agentteams/runtime.mjs', 'start', '--dry-run'], expectExit: 0 },
];
if (args.live) checks.push({ id: 'runtime-live', label: 'WSL/Docker/容器/HTTP 四层在线', args: ['agentteams/runtime.mjs', 'health'], expectExit: 0, timeoutMs: 30_000 });

if (args.help || args.dryRun) {
  process.stdout.write(`${JSON.stringify({
    spec: SPEC,
    kind: 'selfcheck.result',
    status: args.help ? 'help' : 'dry_run',
    usage: 'node agentteams/selfcheck.mjs [--dry-run] [--live]',
    requires_secrets: false,
    checks: checks.map(({ id, label, args: command }) => ({ id, label, command: [process.execPath, ...command] })),
  })}\n`);
  process.exit(0);
}

const results = checks.map(runCheck);
const passed = results.filter(x => x.ok).length;
const ok = passed === results.length;
process.stdout.write(`${JSON.stringify({
  spec: SPEC,
  kind: 'selfcheck.result',
  status: ok ? 'passed' : 'failed',
  requires_secrets: false,
  live: args.live,
  passed,
  total: results.length,
  checks: results,
})}\n`);
process.exit(ok ? 0 : 1);
