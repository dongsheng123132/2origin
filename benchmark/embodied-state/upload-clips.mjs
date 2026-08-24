#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const spec = JSON.parse(readFileSync(join(HERE, 'benchmark.json'), 'utf8'))
const output = join(HERE, 'local-sources.json')
const existing = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : { model: 'qwen3.5-omni-plus', clips: {} }
const cli = process.platform === 'win32' ? process.execPath : 'bl'
const cliPrefix = process.platform === 'win32' ? [join(process.env.APPDATA, 'npm', 'node_modules', 'bailian-cli', 'dist', 'bailian.mjs')] : []

for (const scenario of spec.scenarios) {
  for (const q of scenario.questions) {
    if (existing.clips[q.id]?.url) { console.log(`reuse ${q.id}`); continue }
    const path = join(HERE, 'artifacts', 'clips', `${q.id}.mp4`)
    const run = spawnSync(cli, [...cliPrefix, 'file', 'upload', '--file', path, '--model', existing.model, '--output', 'json', '--non-interactive', '--timeout', '300'], { encoding: 'utf8' })
    if (run.status !== 0) {
      process.stderr.write(run.stderr ?? run.error?.stack ?? `bl exited ${run.status}\n`)
      process.exit(run.status ?? 1)
    }
    const parsed = JSON.parse(run.stdout)
    existing.clips[q.id] = { url: parsed.url, checkpoint_s: q.checkpoint_s, expires_in: parsed.expires_in }
    writeFileSync(output, JSON.stringify(existing, null, 2) + '\n')
    console.log(`uploaded ${q.id}`)
  }
}
console.log(`OK ${Object.keys(existing.clips).length} clips -> ${output}`)
