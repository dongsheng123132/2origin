#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { projectBeliefs } from './reducer.mjs'

const [fixturePath, scenarioId, atText] = process.argv.slice(2)
if (!fixturePath || !scenarioId || atText === undefined) {
  console.error('usage: node adapters/embodied/replay.mjs <fixture.json> <scenario-id> <at-seconds>')
  process.exit(2)
}

try {
  const fixture = JSON.parse(readFileSync(resolve(fixturePath), 'utf8'))
  const scenario = fixture.scenarios?.find((item) => item.id === scenarioId)
  if (!scenario) throw new Error(`scenario not found: ${scenarioId}`)
  const projection = projectBeliefs({
    objects: fixture.objects,
    places: fixture.places,
    sources: scenario.sources,
    events: scenario.events,
    at: Number(atText),
  })
  process.stdout.write(`${JSON.stringify(projection, null, 2)}\n`)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
