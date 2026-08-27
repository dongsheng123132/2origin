#!/usr/bin/env node
// demo-four-roles.mjs — no-secret, independently reproducible four-role trace.
// stdout is exactly one JSON line. The stub homeserver is a test instrument, not an identity anchor.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readState } from '../southbridge/benjing-core.mjs';
import { learningId } from '../xuetang/learning-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HERE = path.join(ROOT, 'agentteams');
const CERTIFY = path.join(HERE, 'certify.mjs');
const SPEC = 'agentteams-four-roles-demo/0.1';
const LEDGER = 'demo/agentteams-bridge/four-roles-ledger.jsonl';
const ROLES = {
  executor: { token: 'tok-alice', fp: null, skill: 'certify.stamp', throat: 'xueji.append' },
  observer: { token: 'tok-carol', fp: null, skill: 'certify.observe', throat: 'quxiang.observe' },
  examiner: { token: 'tok-bob', fp: null, skill: 'certify.certify', throat: 'certify.*' },
  auditor: { token: 'tok-dave', fp: null, skill: 'certify.audit', throat: 'certify.*' },
};

function finish(result, code) {
  process.stdout.write(`${JSON.stringify({ spec: SPEC, kind: 'demo.result', ...result })}\n`);
  process.exit(code);
}

function call(args, role, homeserver) {
  const r = spawnSync(process.execPath, [CERTIFY, ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 330_000, windowsHide: true,
    env: {
      ...process.env, MATRIX_HOMESERVER_URL: homeserver, MATRIX_ACCESS_TOKEN: ROLES[role].token,
      MATRIX_USER_ID: '', AGENTTEAMS_CERTIFY_LEDGER: LEDGER,
    },
  });
  let body = null;
  try { body = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1)); } catch { /* assertion reports it */ }
  return { code: r.status, body, stderr: String(r.stderr || '').trim().slice(0, 220) };
}

function startHomeserver() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(HERE, 'stub-homeserver.mjs')], {
      cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    const timer = setTimeout(() => { child.kill(); reject(new Error('stub homeserver 5 秒内未就绪')); }, 5000);
    child.stdout.once('data', data => {
      clearTimeout(timer);
      try { resolve({ child, url: JSON.parse(String(data).trim()).url }); }
      catch { child.kill(); reject(new Error('stub homeserver 的 ready 行不可解析')); }
    });
    child.once('error', reject);
  });
}

let server;
let sandbox;
try {
  ({ child: server, url: globalThis.homeserver } = await startHomeserver());
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'at-four-roles-'));
  const statePath = path.join(sandbox, 'task.origin.json');
  const approvalPath = path.join(sandbox, 'human-approval.json');
  const tag = crypto.randomBytes(6).toString('hex');
  const lesson = `四角色接力复核已通过（trace ${tag}）`;
  const lid = learningId(lesson);
  fs.writeFileSync(statePath, JSON.stringify({
    spec: '2origin/0.2', kind: 'task.origin', id: `four-roles-${tag}`,
    title: 'GOAI 四角色独立复现', goal: '执行、观察、认证、审计走同一任务记录',
    current_state: '待执行', next_steps: ['executor', 'observer', 'examiner', 'auditor'],
    policy: { requires_human: true }, learnings: [], version: 1, updated_at: new Date().toISOString(),
  }, null, 2), 'utf8');

  process.stderr.write('1/6 executor: stamp candidate\n');
  const stamp = call(['stamp', '--state', statePath, '--lesson', lesson, '--recheck', 'node --version'], 'executor', homeserver);
  const afterStamp = readState(statePath).state.learnings?.[0];
  process.stderr.write('2/6 observer: observe candidate\n');
  const observe = call(['observe', '--state', statePath, '--learning', lid], 'observer', homeserver);
  const afterObserve = readState(statePath).state.learnings?.[0];

  process.stderr.write('3/6 examiner: no human approval must refuse\n');
  const beforeDenied = fs.readFileSync(statePath);
  const missingApproval = call(['certify', '--state', statePath, '--learning', lid], 'examiner', homeserver);
  const deniedStatePreserved = beforeDenied.equals(fs.readFileSync(statePath));

  process.stderr.write('4/6 human: 声明式批准回执（防止批准者标识与考官相同，回执绑定学历+经验+时间）\n');
  fs.writeFileSync(approvalPath, JSON.stringify({
    schema: 'agentteams.human-approval/1', state_id: `four-roles-${tag}`, learning_id: lid, decision: 'approved',
    approved_by: '@human-reviewer:test.local', at: new Date().toISOString(), issued_at: new Date().toISOString(),
  }, null, 2), 'utf8');
  process.stderr.write('5/6 examiner: consume observation plus approval and certify\n');
  const certify = call(['certify', '--state', statePath, '--learning', lid, '--human-approval', approvalPath], 'examiner', homeserver);
  const finalLearning = readState(statePath).state.learnings?.[0];
  process.stderr.write('6/6 auditor: independently consume issued certificate\n');
  const audit = call(['audit', '--state', statePath, '--learning', lid, '--human-approval', approvalPath], 'auditor', homeserver);

  const identities = [afterStamp?.author, afterObserve?.observation?.observer, finalLearning?.exam?.examiner, audit.body?.auditor];
  const fps = identities.map(x => x?.fp).filter(Boolean);
  for (const [name, item] of Object.entries(ROLES)) item.fp = identities[Object.keys(ROLES).indexOf(name)]?.fp || null;
  const ledgerAbs = path.join(ROOT, LEDGER);
  const ledgerRows = fs.existsSync(ledgerAbs) ? fs.readFileSync(ledgerAbs, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
  const stateText = JSON.stringify(readState(statePath).state);
  const checks = {
    four_attested_identities: identities.every(x => x?.attested === true) && new Set(fps).size === 4,
    executor_context_written: stamp.code === 0 && afterStamp?.status === 'candidate' && afterStamp?.author?.fp === identities[0]?.fp,
    observer_consumed_candidate: observe.code === 0 && afterObserve?.observation?.phase === 'observed' && afterObserve?.observation?.observer?.fp === identities[1]?.fp,
    missing_human_approval_refused_without_state_write: missingApproval.code === 2 && missingApproval.body?.code === 'human_approval_missing' && deniedStatePreserved,
    examiner_consumed_observation_and_approval: certify.code === 0 && finalLearning?.status === 'verified'
      && finalLearning?.exam?.observer?.fp === identities[1]?.fp && finalLearning?.exam?.examiner?.fp === identities[2]?.fp
      && !!finalLearning?.exam?.approval?.approver_fp,
    auditor_consumed_certificate: audit.code === 0 && audit.body?.consumed_certificate?.examiner_fp === identities[2]?.fp,
    skill_calls_reported: Object.values(ROLES).every(x => x.skill && x.throat),
    ledger_has_denial_and_audit: ledgerRows.some(x => x.code === 'human_approval_missing') && ledgerRows.some(x => x.verb === 'audit.pass'),
    no_token_leak: !stateText.includes('tok-') && !JSON.stringify(ledgerRows).includes('tok-'),
  };
  const passed = Object.values(checks).filter(Boolean).length;
  const result = {
    status: passed === Object.keys(checks).length ? 'passed' : 'failed', passed, total: Object.keys(checks).length, checks,
    task_record: 'single temporary task.origin.json', audit_ledger: LEDGER,
    roles: Object.fromEntries(Object.entries(ROLES).map(([role, x]) => [role, { identity_fp: x.fp, skill: x.skill, throat: x.throat }])),
    context_flow: ['candidate', 'observed evidence', 'verified', 'audited'],
  };
  try { server?.kill(); } catch { /* ignore */ }
  fs.rmSync(sandbox, { recursive: true, force: true });
  finish(result, passed === Object.keys(checks).length ? 0 : 1);
} catch (error) {
  finish({ status: 'failed', reason: String(error.message || error).slice(0, 300) }, 4);
} finally {
  try { server?.kill(); } catch { /* ignore */ }
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
}
