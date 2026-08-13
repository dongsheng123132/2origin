#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const spec = JSON.parse(readFileSync(join(HERE, 'benchmark.json'), 'utf8'))
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const sourceDir = arg('source-dir')
const outDir = arg('out-dir', join(HERE, 'artifacts', 'observations'))
if (!sourceDir) {
  console.error('Usage: node render-observations.mjs --source-dir <directory> [--out-dir <directory>]')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })
const sourceById = new Map(spec.sources.map((s) => [s.id, s]))

for (const scenario of spec.scenarios) {
  const source = sourceById.get(scenario.source)
  const input = join(sourceDir, source.file)
  const output = join(outDir, scenario.observation_file)
  if (!existsSync(input)) { console.error(`Missing ${input}`); process.exit(1) }
  const tr = scenario.observation_transform
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input]
  if (tr.kind === 'digital_occlusion') {
    const [x, y, w, h] = tr.rect_px
    const [start, end] = tr.interval_s
    args.push('-vf', `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=black@1:t=fill:enable='between(t,${start},${end})'`)
  }
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output)
  console.log(`render ${scenario.id} -> ${output}`)
  const run = spawnSync('ffmpeg', args, { stdio: 'inherit' })
  if (run.status !== 0) process.exit(run.status ?? 1)
}
console.log(`OK rendered ${spec.scenarios.length} robot-observation videos`)
