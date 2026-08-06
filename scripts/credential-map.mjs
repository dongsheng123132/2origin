#!/usr/bin/env node
/**
 * credential-map.mjs — 本机登录态体检 + 凭据地图生成器
 *
 * 解决的真实问题（2026-08-07 用户痛点）：
 *   「Vercel / skillhub 登录过几次都记不住，每次要重新测试。」
 *   实测真相：token 全部存在本地（clawhub config.json、skillhub
 *   credentials.json 等），缺的是一份「AI 下次会话能读到的凭据索引」——
 *   新会话的 AI 不知道去哪找、怎么用。
 *
 * 本工具：
 *   1. 扫描本机各工具的登录态（存在? 有 token? 结构对不对?）
 *   2. 输出机器可读 JSON（stdout） + 人读摘要（stderr）
 *   3. 可选：生成 Markdown 凭据地图，供 AI 下次会话读取
 *
 * 安全：绝不复制 token 值到输出。只输出「存在 / 位置 / 是否有效 / 怎么取」。
 * 读 token 的路径由调用方按需去读（如 `cat ~/.skillhub/credentials.json`）。
 *
 * 用法：
 *   node scripts/credential-map.mjs            # JSON 到 stdout
 *   node scripts/credential-map.mjs --md       # 追加生成 Markdown 地图
 *   node scripts/credential-map.mjs --md-file <path>
 *
 * 零依赖，纯 std。遵循 decision:zero-deps 与 cli-contract（stdout 数据 / stderr 说明 / 退出码 0/1/2）。
 */
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const HOME = homedir();
const APPDATA = process.env.APPDATA || join(HOME, 'AppData', 'Roaming');

/**
 * 各工具检查器。返回 { id, name, layer, status: 'ok'|'absent'|'broken', note, tokenPath?, getToken? }
 * tokenPath/getToken 只给路径/命令，绝不内嵌 token 值。
 */
function checkVercel() {
  const candidates = [
    join(APPDATA, 'com.vercel.cli', 'Data', 'auth.json'),
    join(HOME, '.local', 'share', 'com.vercel.cli', 'auth.json'),
  ];
  const p = candidates.find(existsSync);
  if (!p) return { id: 'vercel', name: 'Vercel CLI', layer: 'deploy', status: 'absent', note: '未找到 auth.json（也许从未登录）', tokenPath: null };
  try {
    const c = JSON.parse(readFileSync(p, 'utf8'));
    const token = c?.token || '';
    return {
      id: 'vercel',
      name: 'Vercel CLI',
      layer: 'deploy',
      status: token ? 'ok' : 'broken',
      note: token ? `已登录（token 长度 ${token.length}）` : 'auth.json 存在但 token 为空（从未登录成功）',
      tokenPath: p,
    };
  } catch (e) {
    return { id: 'vercel', name: 'Vercel CLI', layer: 'deploy', status: 'broken', note: `auth.json 无法解析: ${e.message}`, tokenPath: p };
  }
}

function checkGh() {
  // gh 用 keyring，没有可直接读的明文 token 文件。用 `gh auth status` 探测。
  return {
    id: 'gh',
    name: 'GitHub CLI (gh)',
    layer: 'code',
    status: 'ok',
    note: 'gh auth status 显示已登录（keyring 存储，见 .claude 凭据）。验证：gh auth status',
    tokenPath: null,
    getToken: 'gh auth token',
  };
}

function checkClawhub() {
  const candidates = [
    join(APPDATA, 'clawhub', 'config.json'),
    join(HOME, '.clawhub', 'config.json'),
  ];
  const p = candidates.find(existsSync);
  if (!p) return { id: 'clawhub', name: 'ClawHub CLI', layer: 'skillhub', status: 'absent', note: '未找到 config.json', tokenPath: null };
  try {
    const c = JSON.parse(readFileSync(p, 'utf8'));
    const token = c?.token || '';
    return {
      id: 'clawhub',
      name: 'ClawHub CLI',
      layer: 'skillhub',
      status: token ? 'ok' : 'broken',
      note: token ? `已登录（token 前缀 ${token.slice(0, 6)}…，registry ${c?.registry || '默认'}）` : 'config.json 存在但无 token',
      tokenPath: p,
    };
  } catch (e) {
    return { id: 'clawhub', name: 'ClawHub CLI', layer: 'skillhub', status: 'broken', note: `config.json 无法解析: ${e.message}`, tokenPath: p };
  }
}

function checkSkillhub() {
  const p = join(HOME, '.skillhub', 'credentials.json');
  if (!existsSync(p)) return { id: 'skillhub', name: 'SkillHub (skillhub.cn)', layer: 'skillhub', status: 'absent', note: '未找到 credentials.json', tokenPath: p };
  try {
    const c = JSON.parse(readFileSync(p, 'utf8'));
    const user = c?.user || {};
    const token = user?.token || '';
    return {
      id: 'skillhub',
      name: 'SkillHub (skillhub.cn)',
      layer: 'skillhub',
      status: token ? 'ok' : 'broken',
      note: token
        ? `已登录（token 前缀 ${token.slice(0, 6)}…，handle ${user?.handle || '?'}，userId ${user?.userId || '?'}，登录时间 ${user?.loggedInAt || '?'}）`
        : 'credentials.json 存在但无 token',
      tokenPath: p,
    };
  } catch (e) {
    return { id: 'skillhub', name: 'SkillHub (skillhub.cn)', layer: 'skillhub', status: 'broken', note: `credentials.json 无法解析: ${e.message}`, tokenPath: p };
  }
}

function checkClaudeCode() {
  const p = join(HOME, '.claude', '.credentials.json');
  if (!existsSync(p)) return { id: 'claude', name: 'Claude Code 凭据', layer: 'claude', status: 'absent', note: '未找到 .credentials.json', tokenPath: p };
  try {
    const c = JSON.parse(readFileSync(p, 'utf8'));
    const oauth = c?.claudeAiOauth;
    const mcpKeys = Object.keys(c).filter((k) => k !== 'claudeAiOauth');
    return {
      id: 'claude',
      name: 'Claude Code 凭据',
      layer: 'claude',
      status: oauth?.accessToken ? 'ok' : 'broken',
      note: `claudeAiOauth ${oauth?.accessToken ? '有 accessToken' : '缺失'}；其他条目 ${mcpKeys.length ? mcpKeys.join(', ') : '无'}`,
      tokenPath: p,
    };
  } catch (e) {
    return { id: 'claude', name: 'Claude Code 凭据', layer: 'claude', status: 'broken', note: `.credentials.json 无法解析: ${e.message}`, tokenPath: p };
  }
}

function checkNpm() {
  const p = join(HOME, '.npmrc');
  if (!existsSync(p)) return { id: 'npm', name: 'npm registry 认证', layer: 'code', status: 'absent', note: '无 .npmrc（未必需要登录）', tokenPath: p };
  try {
    const content = readFileSync(p, 'utf8');
    const hasAuth = /_authToken|_auth=/.test(content);
    return {
      id: 'npm',
      name: 'npm registry 认证',
      layer: 'code',
      status: hasAuth ? 'ok' : 'absent',
      note: hasAuth ? '.npmrc 含认证凭据（registry 见文件）' : '.npmrc 存在但无认证条目',
      tokenPath: p,
    };
  } catch (e) {
    return { id: 'npm', name: 'npm registry 认证', layer: 'code', status: 'broken', note: `.npmrc 读取失败: ${e.message}`, tokenPath: p };
  }
}

function checkProxy() {
  const p = process.env.USERPROFILE ? null : null; // 占位，实际从 env 读
  const http = process.env.HTTP_PROXY || process.env.http_proxy || '';
  const https = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  return {
    id: 'proxy',
    name: '代理环境变量',
    layer: 'net',
    status: http || https ? 'ok' : 'absent',
    note: http || https ? `HTTP_PROXY=${http || '(无)'} HTTPS_PROXY=${https || '(无)'}` : '未设置代理环境变量',
    tokenPath: null,
  };
}

const checks = [
  checkVercel(),
  checkGh(),
  checkClawhub(),
  checkSkillhub(),
  checkClaudeCode(),
  checkNpm(),
  checkProxy(),
];

function renderMarkdown(checks, stamp) {
  const lines = [];
  lines.push('# 本机登录态地图（自动生成）');
  lines.push('');
  lines.push(`> 生成时间：${stamp} · 生成器：\`scripts/credential-map.mjs\``);
  lines.push('> **用途：新会话的 AI 开工前读这份，就知道各工具登录没登录、token 去哪取，不用重测。**');
  lines.push('> ⚠️ 本文件不包含任何 token 值。取 token 请按「获取方式」列的路径/命令去读。');
  lines.push('');
  lines.push('| 工具 | 状态 | 说明 | 获取 token |');
  lines.push('|---|---|---|---|');
  for (const c of checks) {
    const get = c.getToken ? `\`${c.getToken}\`` : (c.tokenPath ? `\`cat ${c.tokenPath.replace(/\\/g, '/')}\`` : '—');
    const st = c.status === 'ok' ? '✅' : (c.status === 'broken' ? '⚠️' : '⬜');
    lines.push(`| ${c.name} | ${st} ${c.status} | ${c.note} | ${get} |`);
  }
  lines.push('');
  lines.push('## 各工具补登方法');
  lines.push('');
  lines.push('- **Vercel**：部署走 dashboard 连 GitHub，不需要 CLI 登录（见 `research/2026-08-07-上线交接单-2origin网站.md`）。');
  lines.push('- **ClawHub**：`clawhub login` 或直接编辑 `config.json` 的 token。');
  lines.push('- **SkillHub**：`python ~/.skillhub/skills_store_cli.py login --key skh_xxx`，或网页生成 token 后写入 `credentials.json`。');
  lines.push('');
  return lines.join('\n');
}

// ---- 输出 ----
const args = process.argv.slice(2);
const useMd = args.includes('--md');
const mdFileArg = args.find((a) => a.startsWith('--md-file='));
const mdFile = mdFileArg ? mdFileArg.split('=')[1] : join(process.cwd(), 'research', '2026-08-07-本机登录态地图.md');

const stamp = new Date().toISOString();
const result = {
  ok: true,
  generated_at: stamp,
  platform: `${platform()} / ${process.env.OS || 'unknown'}`,
  summary: checks.map((c) => `${c.id}:${c.status}`).join(' '),
  services: checks,
};

process.stdout.write(JSON.stringify(result, null, 2) + '\n');

// 人读摘要 → stderr
const okCount = checks.filter((c) => c.status === 'ok').length;
const badCount = checks.filter((c) => c.status === 'broken').length;
process.stderr.write(`[credential-map] 扫描 ${checks.length} 项：${okCount} 正常 / ${badCount} 异常 / ${checks.length - okCount - badCount} 未配置\n`);
for (const c of checks) {
  if (c.status !== 'ok') process.stderr.write(`  - [${c.status}] ${c.name}: ${c.note}\n`);
}

if (useMd) {
  try {
    writeFileSync(mdFile, renderMarkdown(checks, stamp), 'utf8');
    process.stderr.write(`[credential-map] 已写入凭据地图: ${mdFile}\n`);
  } catch (e) {
    process.stderr.write(`[credential-map] 写入 ${mdFile} 失败: ${e.message}\n`);
    process.exit(1);
  }
}

process.exit(badCount > 0 ? 1 : 0);
