#!/usr/bin/env node
// challenge-stats.mjs —— 白鼓挑战公开数字的唯一来源（2026-08-27 会审共识：数字脚本生成，不手写）
//
//   node scripts/challenge-stats.mjs [--out website/stats.json] [--out-zh website/zh/stats.json]
//
// 生成口径（诚实边界）：
//   - chapters_verified = outline.jsonl 里出现的不同章号数（正式章，五道门禁通过才进 outline）
//   - words             = 各正式章正文实际字符数（去空白）之和——不是模型自报字数
//   - drafts            = narrative/chapters 里存在但 outline 没有的章（人工草稿，未过门禁）
//   - drift_rate        = null（只在重跑 ShadowBench-W 连续写作协议后填值，标注 run id 与日期）
//   - cadence           = 章提交时间线（git log 自动提取，停更区间由此可见）
// 输出两个文件：website/stats.json（EN 用）与 website/zh/stats.json（ZH 用，同内容），challenge 页 fetch 渲染。

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const SERIALS = [
  { id: 'yueluo', title: '月落渡口', pkg: 'novels/月落渡口.origin', genre: '悬疑志怪', gitPath: 'novels/月落渡口.origin' },
  { id: 'rules', title: '规则怪谈·无限层', pkg: 'adapters/story/rk/pkg.origin', genre: '规则怪谈', gitPath: 'adapters/story/rk' },
  { id: 'zs', title: 'The Slots（实验）', pkg: 'adapters/story/zs/pkg.origin', genre: '英文试验', gitPath: 'adapters/story/zs' },
]

function dedupe(arr) {
  const seen = new Set()
  const out = []
  for (const x of arr) { if (!seen.has(x)) { seen.add(x); out.push(x) } }
  return out
}

function chapterStats(pkgDirRel) {
  const pkgDir = join(ROOT, pkgDirRel)
  const outlinePath = join(pkgDir, 'narrative', 'chapters', 'outline.jsonl')
  const chDir = join(pkgDir, 'narrative', 'chapters')
  if (!existsSync(outlinePath)) return null
  const rows = readFileSync(outlinePath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const chapters = dedupe(rows.map((r) => r.chapter)).sort((a, b) => a - b)
  let words = 0
  for (const c of chapters) {
    const f = join(chDir, `ch${String(c).padStart(2, '0')}.txt`)
    if (existsSync(f)) words += readFileSync(f, 'utf8').replace(/\s/g, '').length
  }
  // drafts = 文件存在但 outline 无条目
  const files = existsSync(chDir) ? readdirSync(chDir).filter((f) => /^ch\d+\.txt$/.test(f)) : []
  const drafts = files.filter((f) => {
    const n = Number(f.match(/^ch(\d+)\.txt$/)[1])
    return !chapters.includes(n)
  })
  const last = rows[rows.length - 1]
  return {
    chapters_verified: chapters.length,
    chapter_list: chapters,
    words,
    drafts: drafts.map((f) => ({ file: f })),
    last_chapter: last ? last.chapter : null,
    last_at: last ? last.at : null,
  }
}

function cadence() {
  // 章提交时间线：git log 里触碰串行正文目录的提交
  try {
    const out = execFileSync('git', ['log', '--format=%H|%ad|%s', '--date=iso', '--', 'novels/月落渡口.origin/narrative', 'adapters/story/rk/pkg.origin/narrative', 'adapters/story/zs/pkg.origin/narrative'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
    return out.trim().split('\n').filter(Boolean).map((l) => {
      const [sha, at, ...rest] = l.split('|')
      return { sha: sha.slice(0, 8), at, subject: rest.join('|').slice(0, 60) }
    })
  } catch (e) {
    return []
  }
}

const out = {
  generated_at: new Date().toISOString(),
  commit: (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim().slice(0, 8) } catch { return null } })(),
  serials: SERIALS.map((s) => ({ id: s.id, title: s.title, genre: s.genre, ...chapterStats(s.pkg) })).filter((s) => s.chapters_verified !== null),
  totals: null,
  drift_rate: null, // 重测后填 { value, run, date }——无编号的裸数字禁止上墙
  cadence: cadence(),
}
out.totals = {
  chapters_verified: out.serials.reduce((a, s) => a + s.chapters_verified, 0),
  words: out.serials.reduce((a, s) => a + s.words, 0),
}

const args = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt }
const outPath = opt('out', join(ROOT, 'website', 'stats.json'))
const outPathZh = opt('out-zh', join(ROOT, 'website', 'zh', 'stats.json'))
const json = JSON.stringify(out, null, 2)
writeFileSync(outPath, json)
writeFileSync(outPathZh, json)
console.log('stats.json 已生成：')
console.log(JSON.stringify({
  generated_at: out.generated_at,
  commit: out.commit,
  totals: out.totals,
  serials: out.serials.map((s) => ({ id: s.id, chapters_verified: s.chapters_verified, words: s.words, drafts: s.drafts.length, last_chapter: s.last_chapter })),
  drift_rate: out.drift_rate,
  cadence_commits: out.cadence.length,
}, null, 2))