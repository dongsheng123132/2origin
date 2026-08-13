#!/usr/bin/env node
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const spec = JSON.parse(readFileSync(join(HERE, 'benchmark.json'), 'utf8'))
const observationDir = join(HERE, 'artifacts', 'observations')
const clipDir = join(HERE, 'artifacts', 'clips')
mkdirSync(clipDir, { recursive: true })

for (const scenario of spec.scenarios) {
  for (const q of scenario.questions) {
    const input = join(observationDir, scenario.observation_file)
    const output = join(clipDir, `${q.id}.mp4`)
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-t', String(q.checkpoint_s), '-map', '0:v:0', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output]
    const run = spawnSync('ffmpeg', args, { stdio: 'inherit' })
    if (run.status !== 0) process.exit(run.status ?? 1)
    console.log(`${q.id}\t0-${q.checkpoint_s}s\t${output}`)
  }
}
