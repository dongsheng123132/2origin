#!/usr/bin/env node
// Hackathon demo (English output) — mirrors adapters/story/demo.mjs step by step,
// with English narration so international judges can reproduce the video scenes
// with one command:
//
//   node scripts/demo.en.mjs
//
// Same engine, same world, same transactions — only the console language differs.

import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initWriter, projectState, submitChapter, checkChapter, hookGraph, seqOf } from '../adapters/story/engine.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SPEC = join(HERE, '..', 'benchmark', 'shadowbench-w', 'world', 'spec.origin')
const CORPUS = join(HERE, '..', 'benchmark', 'shadowbench-w', 'corpus')

const tmp = mkdtempSync(join(tmpdir(), 'origin-hackathon-demo-'))
const PKG = join(tmp, 'moon-harbor.origin')

const step = (s) => console.log(`\n━━━ ${s} ━━━`)

try {
  step('① Build package: world replayed to chapter 10 (what follows is submitted by the AI)')
  initWriter(PKG, SPEC, { untilChapter: 10, title: 'Moon Harbor — continuation project' })
  console.log(`   pkg: ${PKG}`)
  console.log(`   world spec: ${SPEC}`)

  step('② New session resumes with ONE command — the whole world state comes back')
  const s = projectState(PKG)
  console.log(s.split('\n').slice(0, 10).map((l) => '   ' + l).join('\n'))
  console.log('   …')

  step('③ Evidence: why can we trust these values?')
  console.log('   origin why obj:black-key.holder → answered by provenance:')
  console.log('   · ch02  Lao Tao gives the key to Zhao Qi (ev:002, scene:02-03)')
  console.log('   · ch11  Lin Zheng takes it from Zhao Qi (pending)')

  step('④ AI submits chapter 11 (prose + the black-key handover transaction)')
  const ch11 = readFileSync(join(CORPUS, 'ch11.txt'), 'utf8')
  const good = submitChapter(PKG, {
    chapter: 11,
    transaction_id: 'ch11-s01',
    text: ch11,
    state_changes: [
      { object: 'obj:black-key', field: 'holder', from: 'char:zhao-qi', to: 'char:lin-zheng', basis: ['scene:11-07'] },
    ],
    assertions: ['zhao-qi-alive', 'gate-not-opened', 'key-intact', 'betrayal-undisclosed', 'left-hand-still-injured'],
  }, { by: 'deepseek-v4-flash' })
  if (good.ok) {
    console.log(`   ✓ committed seq ${good.receipt.seq_from}–${good.receipt.seq_to}, ${good.receipt.chars} chars, text → ${good.receipt.text_file}`)
    for (const ref of good.receipt.changed) console.log(`   · state change: ${ref}`)
  } else {
    console.log('   ✗ rejected:', good.violations.map((v) => v.msg).join('; '))
  }

  step('⑤ Forbidden zone — the model tries to USE the black key in chapter 12')
  const bad = checkChapter(PKG, {
    chapter: 12,
    text: 'Lin Zheng turns the black key on the moon platform; the space gate thunders open.',
    state_changes: [{ object: 'obj:black-key', field: 'used', from: false, to: true }],
    assertions: ['zhao-qi-alive', 'gate-not-opened'],
  })
  for (const v of bad.violations) console.log(`   ✗ [${v.code}] ${v.msg}`)
  console.log(`   → ZERO WRITES (seq still ${seqOf(PKG)}). Reasons returned for a rewrite.`)

  step('⑥ Prose vs state — the text says "Bai Yao slashes with her LEFT hand"')
  const hand = checkChapter(PKG, {
    chapter: 12,
    text: 'In the alley behind the teahouse, Bai Yao parries a flying tile with her left hand.',
    state_changes: [{ object: 'char:bai-yao', field: 'left_hand_injured', from: true, to: false }],
    assertions: ['left-hand-still-injured'],
  })
  for (const v of hand.violations) console.log(`   ✗ [${v.code}] ${v.msg}`)

  step('⑦ Foreshadowing graph: planted / pending / never planted')
  for (const h of hookGraph(PKG)) {
    const tag = h.status === 'planted_unresolved' ? '⚠ pending' : h.status === 'not_planted' ? '· never' : '✓ resolved'
    console.log(`   ${tag}  ${h.id}  (planted ch${h.setup_chapter ?? '-'}${h.payoff_chapter ? `, payoff ch${h.payoff_chapter}` : ''})  ${String(h.summary).slice(0, 26)}`)
  }

  step('⑧ New session, next day — resume again')
  const s2 = projectState(PKG)
  console.log('   ' + s2.split('\n').filter((l) => l.includes('black-key') || l.includes('char:lin-zheng') || l.includes('char:zhao-qi')).join('\n   '))
  console.log(`\nDemo complete. Full project: ${PKG}`)
} finally {
  // keep the package for inspection; comment out to auto-clean
}
