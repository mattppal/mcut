import { expect, test } from 'bun:test'
import { listToolDefinitions } from './commands'
import { commandOverrides, generatePlan } from './fuzz/plan'
import { runCommandPlan, type FuzzCommand } from './fuzz/run-commands'
import type { Project } from './model'

const SEQUENCES = 1000
const LENGTH = 60
const MULTICAM_COMMANDS = [
  'splitElement',
  'trimElement',
  'trimEdge',
  'rippleTrim',
  'rollEdit',
  'slipElement',
  'setElementSpeed',
  'setTimeMap',
  'updateElement',
  'addEffect',
  'setTransition',
  'setKeyframe',
  'detachAudio',
  'applyAnimationPreset',
  'removeElement',
  'moveElement',
]

const targetsMulticam = (project: Project, command: FuzzCommand) =>
  project.tracks.some((track) => track.elements.some((element) => element.id === command.elementId && element.type === 'multicam'))

test(`the ${SEQUENCES} fuzz sequences change a multicam with every media clip command`, () => {
  const tools = listToolDefinitions()
  const changed = new Set<string>()
  for (let seed = 1; seed <= SEQUENCES; seed++) {
    const plan = generatePlan({ seed, tools, length: LENGTH, overrides: commandOverrides })
    runCommandPlan(plan, {
      onApplied: (command, before, after) => {
        if (after !== before && targetsMulticam(before, command)) changed.add(command.type)
      },
    })
  }
  expect(MULTICAM_COMMANDS.filter((type) => changed.has(type))).toEqual(MULTICAM_COMMANDS)
}, 120_000)
