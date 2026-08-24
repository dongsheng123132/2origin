#!/usr/bin/env node
// Provision three short-lived Matrix identities for the local AgentTeams demo.
// Secrets are discovered from the local controller container, used in memory,
// and never printed. Result JSON contains only non-reversible fingerprints.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SPEC = 'agentteams-identity-provision/0.1';
const roles = ['sos-author', 'sos-observer', 'sos-examiner'];
const distro = process.env.AT_WSL_DISTRO || 'Ubuntu';
const homeserver = process.env.MATRIX_HOMESERVER_URL || 'http://127.0.0.1:18080';
const tokenDir = process.env.AT_TOKEN_DIR
  || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Temp', 'at-tokens');

function fail(stage, error, exitCode = 4) {
  process.stdout.write(`${JSON.stringify({ spec: SPEC, kind: 'provision.result', status: 'failed', stage, error })}\n`);
  process.exit(exitCode);
}

function controllerEnv() {
  const r = spawnSync('wsl.exe', [
    '-d', distro, '--', 'docker', 'inspect', 'agentteams-controller',
    '--format', '{{range .Config.Env}}{{println .}}{{end}}',
  ], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  if (r.status !== 0) fail('controller_env', String(r.stderr || 'docker inspect failed').trim());
  return Object.fromEntries(String(r.stdout).split(/\r?\n/).filter(Boolean).map((line) => {
    const i = line.indexOf('=');
    return i < 0 ? [line, ''] : [line.slice(0, i), line.slice(i + 1)];
  }));
}

async function register(asToken, localpart) {
  const endpoints = [
    '/_matrix/client/v3/register',
    '/_matrix/client/r0/register',
  ];
  let last = null;
  for (const endpoint of endpoints) {
    const res = await fetch(`${homeserver}${endpoint}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${asToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        type: 'm.login.application_service',
        username: localpart,
        inhibit_login: false,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.access_token && body.user_id) return body;
    last = { status: res.status, errcode: body.errcode, error: body.error };
    if (res.status !== 404) break;
  }
  throw new Error(`Matrix register rejected: ${JSON.stringify(last)}`);
}

function atomicSecretWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${value}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
}

const env = controllerEnv();
const asToken = process.env.AGENTTEAMS_MATRIX_APPSERVICE_AS_TOKEN
  || env.AGENTTEAMS_MATRIX_APPSERVICE_AS_TOKEN;
if (!asToken) fail('appservice_token', 'controller does not expose an appservice token', 3);

const nonce = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
const evidence = [];
try {
  for (const role of roles) {
    const identity = await register(asToken, `${role}-${nonce}`);
    atomicSecretWrite(path.join(tokenDir, `${role}.token`), identity.access_token);
    evidence.push({
      role,
      identity_fp: crypto.createHash('sha256').update(identity.user_id).digest('hex').slice(0, 12),
      issuer: new URL(homeserver).host,
    });
  }
} catch (error) {
  fail('matrix_register', error.message);
}

process.stdout.write(`${JSON.stringify({
  spec: SPEC,
  kind: 'provision.result',
  status: 'done',
  token_dir: tokenDir,
  identities: evidence,
  secrets_printed: false,
})}\n`);
