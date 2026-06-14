/**
 * mcut agentic editing — an LLM drives the editor through the same
 * zod-validated commands the UI dispatches.
 *
 *   bun start                       # replays a recorded agent session (no key needed)
 *   AI_GATEWAY_API_KEY=... bun start   # a real model edits live (Vercel AI Gateway)
 *   MCUT_AGENT_MODEL=anthropic/claude-sonnet-4-5 bun start   # pick the model
 *
 * The whole integration is the ~15 lines in `commandTools()`: every mcut
 * command definition becomes an AI SDK tool mechanically — its description is
 * the tool description, its zod payload schema is the tool input schema, and
 * `execute` is one `engine.dispatch`. Keyframes, presets, trims, splits: if
 * the editor can do it, the agent can do it, with the engine's validation
 * (typed CommandErrors) as guardrails.
 */

import { generateText, stepCountIs, tool } from 'ai'
import {
  createAssetId,
  createElementId,
  createProject,
  EditorEngine,
  getKeyframes,
  getAnimatedValue,
  listCommands,
  summarizeProject,
  type AnyCommand,
} from '@mcut/timeline'

// ---------------------------------------------------------------------------
// 1. A small composition: a photo and a title
// ---------------------------------------------------------------------------

const engine = new EditorEngine({
  project: createProject({ name: 'agentic-demo', width: 1920, height: 1080, fps: 30 }),
})

const photoAssetId = createAssetId()
engine.dispatch({
  type: 'addAsset',
  asset: {
    id: photoAssetId,
    kind: 'image',
    src: 'https://example.com/landscape.jpg',
    name: 'landscape.jpg',
    width: 2400,
    height: 1600,
  },
})

const photoId = createElementId()
const titleId = createElementId()
const trackId = engine.project.tracks[0]!.id
engine.dispatch({
  type: 'addElement',
  trackId,
  element: { id: photoId, type: 'image', startMs: 0, durationMs: 6000, assetId: photoAssetId },
})
engine.dispatch({ type: 'addTrack', id: 't-overlays', name: 'Overlays' })
engine.dispatch({
  type: 'addElement',
  trackId: 't-overlays',
  element: {
    id: titleId,
    type: 'text',
    startMs: 500,
    durationMs: 5000,
    text: 'Golden Hour',
    style: { fontSize: 132, fontWeight: 800 },
  },
})

console.log('— project before the agent —\n' + summarizeProject(engine.project) + '\n')

// ---------------------------------------------------------------------------
// 2. Every editor command becomes an AI tool, mechanically
// ---------------------------------------------------------------------------

function commandTools() {
  return Object.fromEntries(
    listCommands().map((command) => [
      command.type,
      tool({
        description: command.description,
        inputSchema: command.payloadSchema as never,
        execute: async (input: Record<string, unknown>) => {
          try {
            engine.dispatch({ type: command.type, ...input })
            return { ok: true }
          } catch (error) {
            // Typed CommandErrors go back to the model so it can correct itself.
            return { ok: false, error: error instanceof Error ? error.message : String(error) }
          }
        },
      }),
    ]),
  )
}

const PROMPT =
  'Animate this composition: arm opacity on the "Golden Hour" title and fade it in over ' +
  'the first 600ms with an ease-out curve, give the landscape photo a gentle ken-burns ' +
  'for its whole duration, and fade the title out over its last 500ms.'

// ---------------------------------------------------------------------------
// 3. Live agent (any model via the AI Gateway) or recorded replay
// ---------------------------------------------------------------------------

const liveModel = process.env.AI_GATEWAY_API_KEY
  ? (process.env.MCUT_AGENT_MODEL ?? 'openai/gpt-5-mini')
  : null

if (liveModel) {
  console.log(`— live agent (${liveModel}) —`)
  const result = await generateText({
    model: liveModel,
    system:
      'You are a video-editing agent operating an mcut project through editor commands. ' +
      'Times are integer milliseconds; keyframe timeMs is element-local (0 = clip start). ' +
      'Current project state:\n' +
      summarizeProject(engine.project),
    prompt: PROMPT,
    tools: commandTools(),
    stopWhen: stepCountIs(12),
  })
  console.log(`model finished after ${result.steps.length} step(s): ${result.text}\n`)
} else {
  console.log('— no AI_GATEWAY_API_KEY: replaying a recorded agent session —')
  // These are real tool calls captured from a live run of the prompt above;
  // the replay goes through the exact same dispatch path a model would use.
  const recorded: AnyCommand[] = [
    { type: 'setKeyframe', elementId: titleId, property: 'opacity', timeMs: 0, value: 0, easing: 'easeOut' },
    { type: 'setKeyframe', elementId: titleId, property: 'opacity', timeMs: 600, value: 1 },
    { type: 'applyAnimationPreset', elementId: photoId, preset: 'ken-burns', options: { intensity: 0.8 } },
    { type: 'setKeyframe', elementId: titleId, property: 'opacity', timeMs: 4500, value: 1, easing: 'easeIn' },
    { type: 'setKeyframe', elementId: titleId, property: 'opacity', timeMs: 5000, value: 0 },
  ]
  for (const command of recorded) {
    engine.dispatch(command)
    console.log(`  dispatched ${command.type} (${JSON.stringify(command).slice(0, 100)}…)`)
  }
  console.log()
}

// ---------------------------------------------------------------------------
// 4. Inspect what the agent built
// ---------------------------------------------------------------------------

console.log('— project after the agent —\n' + summarizeProject(engine.project) + '\n')

const title = engine.project.tracks.flatMap((t) => t.elements).find((e) => e.id === titleId)!
console.log('— title opacity curve —')
console.log(
  '  keyframes:',
  getKeyframes(title, 'opacity')
    .map((k) => `${k.timeMs}ms=${k.value}${k.easing ? ` (${typeof k.easing === 'string' ? k.easing : 'bezier'})` : ''}`)
    .join(', '),
)
for (const probeMs of [500, 800, 1100, 3000, 5250, 5500]) {
  const value = getAnimatedValue(title, 'opacity', probeMs)
  console.log(`  opacity @ ${probeMs}ms (timeline) = ${value.toFixed(3)}`)
}

await Bun.write('out/project.json', JSON.stringify(engine.toJSON(), null, 2))
console.log('\nSaved out/project.json — load it in the editor (`bun dev` → /editor) to scrub the result.')
