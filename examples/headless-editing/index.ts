/**
 * mcut headless walkthrough — the whole engine, no browser required.
 *
 *   bun start            (from examples/headless-editing)
 *
 * Builds a small two-track composition through the serializable command
 * API, demonstrates undo/redo and transactions, applies word-timed
 * captions from a transcript, exports SRT/VTT, and round-trips the
 * project through JSON. Everything here is exactly what the editor UI
 * (and, later, an AI copilot) calls under the hood.
 */

import {
  createAssetId,
  createElementId,
  createProject,
  createTrackId,
  EditorEngine,
  getProjectDurationMs,
  listCommands,
} from '@mcut/timeline'
import { buildApplyCaptionsCommand, toSrt, toVtt, type TranscriptResult } from '@mcut/transcription'

const log = (label: string, value?: unknown) =>
  console.log(`\n— ${label}${value === undefined ? '' : `\n${JSON.stringify(value, null, 2)}`}`)

// ---------------------------------------------------------------------------
// 1. An engine over a fresh 1080p/30fps project
// ---------------------------------------------------------------------------

const engine = new EditorEngine({
  project: createProject({ name: 'headless-demo', width: 1920, height: 1080, fps: 30 }),
})

log('created project', { name: engine.project.name, tracks: engine.project.tracks.length })

// ---------------------------------------------------------------------------
// 2. Register an asset and lay out two tracks
//    (In a browser, @mcut/media's createAssetFromFile() probes real files;
//    headless, we declare the metadata ourselves.)
// ---------------------------------------------------------------------------

const assetId = createAssetId()
engine.dispatch({
  type: 'addAsset',
  asset: {
    id: assetId,
    kind: 'video',
    src: 'https://example.com/interview.mp4',
    name: 'interview.mp4',
    durationMs: 12_000,
    width: 1920,
    height: 1080,
  },
})

const videoTrackId = engine.project.tracks[0]!.id // every new project has Track 1
const overlayTrackId = createTrackId()
engine.dispatch({ type: 'addTrack', id: overlayTrackId, name: 'Overlays' })

const clipId = createElementId()
engine.dispatch({
  type: 'addElement',
  trackId: videoTrackId,
  element: {
    id: clipId,
    type: 'video',
    startMs: 0,
    durationMs: 8000,
    assetId,
    trimStartMs: 2000, // skip the first two seconds of the source
  },
})

const titleId = createElementId()
engine.dispatch({
  type: 'addElement',
  trackId: overlayTrackId,
  element: {
    id: titleId,
    type: 'text',
    startMs: 500,
    durationMs: 2500,
    text: 'mcut: headless demo',
    style: { fontSize: 110, color: '#facc15' },
    transform: { y: -360 },
  },
})

log('composition', {
  durationMs: getProjectDurationMs(engine.project),
  tracks: engine.project.tracks.map((t) => `${t.name}: ${t.elements.length} element(s)`),
})

// ---------------------------------------------------------------------------
// 3. Edit: split the clip at 4s, nudge the right half, then undo/redo
// ---------------------------------------------------------------------------

const rightHalfId = createElementId()
engine.dispatch({ type: 'splitElement', elementId: clipId, atMs: 4000, rightElementId: rightHalfId })
engine.dispatch({ type: 'moveElement', elementId: rightHalfId, startMs: 4500 })

log('after split + move', engine.project.tracks[0]!.elements.map((e) => ({
  id: e.id,
  startMs: e.startMs,
  durationMs: e.durationMs,
  trimStartMs: 'trimStartMs' in e ? e.trimStartMs : undefined,
})))

engine.undo()
engine.undo()
log('after 2× undo (split + move reverted)', {
  clips: engine.project.tracks[0]!.elements.length,
  canRedo: engine.canRedo(),
})
engine.redo()
engine.redo()

// A transaction coalesces a whole drag gesture into ONE history entry:
engine.transact(() => {
  for (const startMs of [4400, 4300, 4200]) {
    engine.dispatch({ type: 'moveElement', elementId: rightHalfId, startMs })
  }
})
engine.undo() // one undo reverts the whole gesture
log('transaction = one undo step', {
  rightHalfStartsAt: engine.project.tracks[0]!.elements.at(-1)!.startMs,
})

// ---------------------------------------------------------------------------
// 4. Captions: transcript → grouped, word-timed caption elements
//    (Real flow: @mcut/media extracts WAV → a TranscriptionProvider returns
//    this exact shape. See @mcut/transcription-assemblyai / -ai-sdk.)
// ---------------------------------------------------------------------------

const transcript: TranscriptResult = {
  text: 'Welcome to mcut. Every edit is a serializable command, so an AI agent can drive the editor too.',
  language: 'en',
  durationMs: 8000,
  words: [
    { text: 'Welcome', startMs: 200, endMs: 580, confidence: 0.99 },
    { text: 'to', startMs: 600, endMs: 720, confidence: 0.99 },
    { text: 'mcut.', startMs: 760, endMs: 1300, confidence: 0.97 },
    { text: 'Every', startMs: 1800, endMs: 2120, confidence: 0.99 },
    { text: 'edit', startMs: 2160, endMs: 2480, confidence: 0.98 },
    { text: 'is', startMs: 2520, endMs: 2640, confidence: 0.99 },
    { text: 'a', startMs: 2680, endMs: 2740, confidence: 0.99 },
    { text: 'serializable', startMs: 2780, endMs: 3560, confidence: 0.96 },
    { text: 'command,', startMs: 3600, endMs: 4140, confidence: 0.98 },
    { text: 'so', startMs: 4500, endMs: 4680, confidence: 0.99 },
    { text: 'an', startMs: 4720, endMs: 4840, confidence: 0.99 },
    { text: 'AI', startMs: 4880, endMs: 5160, confidence: 0.98 },
    { text: 'agent', startMs: 5200, endMs: 5560, confidence: 0.98 },
    { text: 'can', startMs: 5600, endMs: 5800, confidence: 0.99 },
    { text: 'drive', startMs: 5840, endMs: 6160, confidence: 0.98 },
    { text: 'the', startMs: 6200, endMs: 6320, confidence: 0.99 },
    { text: 'editor', startMs: 6360, endMs: 6800, confidence: 0.98 },
    { text: 'too.', startMs: 6840, endMs: 7200, confidence: 0.97 },
  ],
  segments: [],
}

engine.dispatch(buildApplyCaptionsCommand(transcript, { maxChars: 32 }))

const captionTrack = engine.project.tracks.at(-1)!
log('captions applied', captionTrack.elements.map((e) => e.type === 'caption' && {
  text: e.text,
  startMs: e.startMs,
  words: e.words?.length,
}))

await Bun.write('out/captions.srt', toSrt(transcript))
await Bun.write('out/captions.vtt', toVtt(transcript))

// ---------------------------------------------------------------------------
// 5. Persistence: the project is plain JSON, validated on load
// ---------------------------------------------------------------------------

await Bun.write('out/project.json', JSON.stringify(engine.toJSON(), null, 2))
const restored = EditorEngine.fromJSON(JSON.parse(await Bun.file('out/project.json').text()))
log('JSON round-trip', {
  // zod normalizes key order on load, so compare structurally:
  equal: Bun.deepEquals(restored.toJSON(), engine.toJSON(), true),
  files: ['out/project.json', 'out/captions.srt', 'out/captions.vtt'],
})

// ---------------------------------------------------------------------------
// 6. The AI seam: every command is a self-describing, zod-validated tool
// ---------------------------------------------------------------------------

log('registered commands (each schema doubles as an AI tool definition)')
for (const command of listCommands()) {
  console.log(`  ${command.type.padEnd(16)} ${command.description.split('\n')[0]}`)
}

console.log('\nDone. The generated project.json can be loaded by any app built on the mcut SDK.')
