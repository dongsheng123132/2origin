#!/usr/bin/env node
// 自动发布器 AutoPublish —— 影核协议 post.publish 动作的 CLI 执行器。
//
// 一个动作（post.publish），多个执行器：
//   ① CLI（本文件）— 登录态检测 / dry-run 预览 / 发布任务编排
//   ② 浏览器执行器（Hermes browser 工具）— 实际填入并点发布
//   ③ 未来：各平台官方 API（x-api / weibo api / wechat mp api）
//
// 用法：
//   node tools/autopublish/publish.mjs check <platform>     # 登录态检测（无头）
//   node tools/autopublish/publish.mjs preview <platform> <content|@file>
//   node tools/autopublish/publish.mjs run <platform> <content|@file> [--thread]
//
// platform: x | weibo | wechat-mp
//
// 设计原则（影核协议）：
//   - 动作语义唯一：post.publish 就是「把文本发出去」，不关心哪个平台
//   - 执行器可替换：CLI 检测 → 浏览器发布 → 未来 API 直发，同一动作
//   - 可验证：dry-run 只检测登录态并预览，不产生任何对外可见内容

import { readFileSync, existsSync } from 'node:fs'

const USAGE = `自动发布器 AutoPublish —— 影核协议 post.publish 动作执行器

  node tools/autopublish/publish.mjs check <platform>       登录态检测（无头，不发内容）
  node tools/autopublish/publish.mjs preview <platform> <text|@file>   预览（检测+展示）
  node tools/autopublish/publish.mjs run <platform> <text|@file>       正式发布（引导浏览器）

platform: x | weibo | wechat-mp
内容：直接传文本，或用 @文件路径（UTF-8）

示例：
  node tools/autopublish/publish.mjs check x
  node tools/autopublish/publish.mjs run x "@推文1.txt"
`

const [cmd, platform, contentArg] = process.argv.slice(2)

if (!cmd || !platform || (['preview', 'run'].includes(cmd) && !contentArg)) {
  process.stdout.write(USAGE)
  process.exit(cmd ? 2 : 0)
}

if (!['x', 'weibo', 'wechat-mp'].includes(platform)) {
  console.error(`未知平台 ${platform}（x / weibo / wechat-mp）`)
  process.exit(2)
}

const PLATFORMS = {
  x: {
    name: 'X (推特)',
    url: 'https://x.com/home',
    login_hint: '页面出现「正发生/Composer 发帖框」= 已登录；出现「使用手机继续/登录」= 未登录',
  },
  weibo: {
    name: '微博',
    url: 'https://weibo.com',
    login_hint: '页面出现发布框/首页信息流 = 已登录；出现「登录/扫码」= 未登录',
  },
  'wechat-mp': {
    name: '微信公众号',
    url: 'https://mp.weixin.qq.com',
    login_hint: '页面出现草稿箱/后台 = 已登录；出现「扫码登录」= 未登录',
  },
}

/** 读取内容：@前缀读文件，否则用原文。 */
function loadContent(arg) {
  if (arg.startsWith('@')) {
    const p = arg.slice(1)
    if (!existsSync(p)) { console.error(`文件不存在：${p}`); process.exit(2) }
    return readFileSync(p, 'utf8').trim()
  }
  return arg
}

/** 内容分段（X 单推 ≤280 字符；线程模式自动切分）。 */
function splitForX(text) {
  const lines = text.split(/\n+/).filter((l) => l.trim())
  const parts = []
  let cur = ''
  for (const line of lines) {
    if (cur && (cur + '\n' + line).length > 260) { parts.push(cur); cur = line }
    else cur = cur ? cur + '\n' + line : line
  }
  if (cur) parts.push(cur)
  return parts
}

const p = PLATFORMS[platform]

// ── check：登录态检测指引（无头，不碰浏览器登录凭据）──
if (cmd === 'check') {
  console.log(`${p.name} 登录态检查指引：`)
  console.log(`  1. 浏览器打开 ${p.url}`)
  console.log(`  2. 判断：${p.login_hint}`)
  console.log('  3. 已登录 → 告诉我「已登录」，我直接用浏览器执行器发布')
  console.log('  4. 未登录 → 你在浏览器完成登录（凭据只经你手），登录后告诉我')
  console.log('\nstatus: pending-user-browser')
  process.exit(0)
}

// ── preview：内容预览 + 分段（不发）──
if (cmd === 'preview') {
  const text = loadContent(contentArg)
  console.log(`${p.name} 预览（dry-run，不会发布）：`)
  console.log('')
  if (platform === 'x') {
    const parts = splitForX(text)
    console.log(`正文 ${text.length} 字符 → 将分为 ${parts.length} 条推文：`)
    parts.forEach((s, i) => console.log(`  [${i + 1}/${parts.length}] ${s.length}字 ${s.slice(0, 60)}${s.length > 60 ? '…' : ''}`))
  } else {
    console.log(`正文 ${text.length} 字符：`)
    console.log(text.slice(0, 300) + (text.length > 300 ? '…' : ''))
  }
  console.log('\nstatus: preview')
  process.exit(0)
}

// ── run：正式发布 ──
if (cmd === 'run') {
  const text = loadContent(contentArg)
  console.log(`${p.name} 正式发布：`)
  console.log(`  内容：${text.length} 字符（${platform === 'x' ? splitForX(text).length + ' 条推文' : '单条'}）`)
  console.log('  执行器：浏览器（Hermes browser 工具）')
  console.log('  步骤：检测登录态 → 填入内容 → 点发布 → 提取 URL')
  console.log('')
  console.log('⚠ 请先确认：浏览器里该平台已登录（我可以先跑 check）。')
  console.log('  确认后回复「发布」，我执行浏览器发布；或先「check」验登录态。')
  console.log('\nstatus: awaiting-browser-executor')
  process.exit(0)
}
