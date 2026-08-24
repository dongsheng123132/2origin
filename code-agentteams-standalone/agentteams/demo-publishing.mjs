#!/usr/bin/env node
// demo-publishing.mjs — executable publishing-review trace using three attested identities.
// stdout is one demo.result JSON line; human trace goes to stderr; tokens never enter output.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readState } from '../southbridge/benjing-core.mjs';
import { learningId } from '../xuetang/learning-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = 'agentteams-publishing-demo/0.1';
const CERTIFY = path.join(ROOT, 'agentteams/certify.mjs');
const HS = process.env.MATRIX_HOMESERVER_URL || 'http://127.0.0.1:18080';
const TOKDIR = process.env.AT_TOKEN_DIR || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Temp', 'at-tokens');
const LEDGER = process.env.AT_PUBLISHING_LEDGER || 'demo/agentteams-bridge/publishing-demo-ledger.jsonl';
const CHECKER = 'demo/book-project/verify-book.mjs';

function finish(result, code) {
  process.stdout.write(`${JSON.stringify({ spec: SPEC, kind: 'demo.result', ...result })}\n`);
  process.exit(code);
}

function token(role) {
  const p = path.join(TOKDIR, `${role}.token`);
  if (!fs.existsSync(p)) finish({ status: 'instrument_unavailable', reason: `missing identity token file for ${role}` }, 3);
  return fs.readFileSync(p, 'utf8').trim();
}

function invoke(args, role) {
  const r = spawnSync(process.execPath, [CERTIFY, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 300_000,
    windowsHide: true,
    env: {
      ...process.env,
      MATRIX_HOMESERVER_URL: HS,
      MATRIX_ACCESS_TOKEN: token(role),
      MATRIX_USER_ID: '',
      AGENTTEAMS_CERTIFY_LEDGER: LEDGER,
    },
  });
  let body = null;
  try { body = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop()); } catch { /* reported by caller */ }
  return { code: r.status, body, stderr: String(r.stderr || '').trim().slice(0, 300) };
}

async function preflight() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${HS}/_matrix/client/versions`, { signal: controller.signal });
    if (!response.ok) finish({ status: 'instrument_unavailable', reason: `homeserver HTTP ${response.status}` }, 3);
  } catch (error) {
    finish({ status: 'instrument_unavailable', reason: `homeserver unreachable: ${String(error.message || error).slice(0, 160)}` }, 3);
  } finally { clearTimeout(timer); }
}

await preflight();
const checkerAbs = path.join(ROOT, CHECKER);
if (!fs.existsSync(checkerAbs)) finish({ status: 'instrument_unavailable', reason: `checker missing: ${CHECKER}` }, 3);

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'at-publishing-'));
const statePath = path.join(sandbox, 'task.origin.json');
const runTag = crypto.randomBytes(6).toString('hex');
const lesson = `出版社教材付印前一致性审稿已通过真实检查器（trace ${runTag}）`;
const lid = learningId(lesson);
const initial = {
  spec: '2origin/0.2', kind: 'task.origin', id: `publishing-${runTag}`,
  title: '出版社教材一致性审稿', goal: '用三身份证据链核验付印前一致性',
  current_state: '待审稿', next_steps: ['Executor 登记', 'Sensor 取象', 'Examiner 发证'],
  learnings: [], version: 1, updated_at: new Date().toISOString(),
};
fs.writeFileSync(statePath, `${JSON.stringify(initial, null, 2)}\n`, 'utf8');

try {
  process.stderr.write('1/5 Executor: 登记 candidate，不得自封 verified\n');
  const stamp = invoke(['stamp', '--state', statePath, '--lesson', lesson, '--recheck', `node ${CHECKER}`, '--expect-exit', '0'], 'sos-author');
  const beforePremature = fs.readFileSync(statePath);

  process.stderr.write('2/5 Examiner: 无第三方观察时尝试审批，必须拒绝且状态零改动\n');
  const premature = invoke(['certify', '--state', statePath, '--learning', lid], 'sos-examiner');
  const afterPremature = fs.readFileSync(statePath);
  const refusalPreserved = beforePremature.equals(afterPremature);

  process.stderr.write('3/5 Sensor: 独立运行真实教材一致性检查器，只产出观察\n');
  const observe = invoke(['observe', '--state', statePath, '--learning', lid], 'sos-observer');

  process.stderr.write('4/5 Examiner: 只读观察发证，不执行检查命令\n');
  const certify = invoke(['certify', '--state', statePath, '--learning', lid], 'sos-examiner');

  process.stderr.write('5/5 Replay: 同一观察二次发证必须拒绝\n');
  const replay = invoke(['certify', '--state', statePath, '--learning', lid], 'sos-examiner');

  const finalState = readState(statePath).state;
  const learning = finalState.learnings?.find(x => (x.id || learningId(x.lesson)) === lid);
  const identities = [learning?.author, learning?.exam?.observer, learning?.exam?.examiner];
  const fingerprints = identities.map(x => x?.fp).filter(Boolean);
  const serializedState = JSON.stringify(finalState);
  const noTokenLeak = !serializedState.includes('access_token')
    && !serializedState.includes(token('sos-author'))
    && !serializedState.includes(token('sos-observer'))
    && !serializedState.includes(token('sos-examiner'));
  const checks = {
    executor_candidate_written: stamp.code === 0,
    approval_without_observation_refused: premature.code === 2 && refusalPreserved,
    sensor_observation_passed: observe.code === 0 && observe.body?.result === 'pass',
    examiner_certified: certify.code === 0 && learning?.status === 'verified',
    evidence_replay_refused: replay.code === 2,
    identities_attested_and_distinct: identities.every(x => x?.attested === true) && new Set(fingerprints).size === 3,
    separation_strength_recorded: learning?.exam?.separation_strength === 'attested_both',
    no_token_in_state: noTokenLeak,
  };
  const passed = Object.values(checks).filter(Boolean).length;
  const ok = passed === Object.keys(checks).length;
  const result = {
    status: ok ? 'passed' : 'failed',
    scenario: 'publishing-textbook-consistency-review',
    checker: CHECKER,
    passed,
    total: Object.keys(checks).length,
    checks,
    trace: [
      { role: 'executor', action: 'stamp', result: stamp.body?.write?.status || null, identity_fp: learning?.author?.fp || null },
      { role: 'examiner', action: 'premature_certify', result: premature.body?.reason || premature.body?.status || (premature.code === 2 ? 'refused' : `exit_${premature.code}`), state_preserved: refusalPreserved },
      { role: 'sensor', action: 'observe', result: observe.body?.result || null, identity_fp: learning?.exam?.observer?.fp || null },
      { role: 'examiner', action: 'certify', result: certify.body?.decision || null, identity_fp: learning?.exam?.examiner?.fp || null },
      { role: 'examiner', action: 'replay', result: replay.body?.reason || replay.body?.status || (replay.code === 2 ? 'refused' : `exit_${replay.code}`) },
    ],
    final: { learning_id: lid, status: learning?.status || null, separation_strength: learning?.exam?.separation_strength || null },
    audit_ledger: LEDGER,
  };
  fs.rmSync(sandbox, { recursive: true, force: true });
  finish(result, ok ? 0 : 1);
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
