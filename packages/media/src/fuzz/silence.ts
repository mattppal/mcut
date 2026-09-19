import { planSilenceCuts, type SilenceWindow } from '@mcut/editor'
import { EditorEngine, createAssetId, createElementId, createProject } from '@mcut/timeline'
import { analyzeAudioSamples, type AudioActivity } from '../audio-activity'
import type { ManifestFixture } from './fixtures'
import type { Violation } from './invariants'

export const GAP_TOLERANCE_MS = 100
const PHANTOM_SILENCE_MS = 300

export async function decodeMonoPcm(path: string, sampleRate: number): Promise<Float32Array> {
  const args = ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', path]
  args.push('-f', 'f32le', '-ac', '1', '-ar', String(sampleRate), '-')
  const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  const [pcm, stderr, code] = await Promise.all([new Response(proc.stdout).arrayBuffer(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`ffmpeg could not decode ${path}\n${stderr}`)
  return new Float32Array(pcm)
}

const spans = (windows: readonly SilenceWindow[]): string => windows.map((window) => `${window.startMs} to ${window.endMs}`).join(', ') || 'none'

const within = (window: SilenceWindow, gap: SilenceWindow): boolean =>
  Math.abs(window.startMs - gap.startMs) <= GAP_TOLERANCE_MS && Math.abs(window.endMs - gap.endMs) <= GAP_TOLERANCE_MS

export function missingGaps(gaps: readonly SilenceWindow[], windows: readonly SilenceWindow[], invariant: string): Violation[] {
  return gaps
    .filter((gap) => !windows.some((window) => within(window, gap)))
    .map((gap) => ({
      invariant,
      detail: `gap ${gap.startMs} to ${gap.endMs} ms has no match within ${GAP_TOLERANCE_MS} ms among ${spans(windows)}`,
    }))
}

export function phantomSilences(gaps: readonly SilenceWindow[], windows: readonly SilenceWindow[]): Violation[] {
  return windows
    .filter((window) => window.endMs - window.startMs >= PHANTOM_SILENCE_MS && !gaps.some((gap) => within(window, gap)))
    .map((window) => ({
      invariant: 'no-phantom-silence',
      detail: `silence ${window.startMs} to ${window.endMs} ms matches no recipe gap (${spans(gaps)})`,
    }))
}

export function planCutsFromActivity(fixture: ManifestFixture, activity: AudioActivity): SilenceWindow[] {
  const durationMs = fixture.recipe.durationMs
  const engine = new EditorEngine({ project: createProject({ id: 'p-media-fuzz' }) })
  const assetId = createAssetId()
  const elementId = createElementId()
  engine.dispatch({
    type: 'addAsset',
    asset: { id: assetId, kind: 'audio', src: fixture.file, name: fixture.file, durationMs },
  })
  engine.dispatch({
    type: 'addElement',
    trackId: 't-default',
    element: { id: elementId, type: 'audio', startMs: 0, durationMs, trimStartMs: 0, assetId },
  })
  const words = activity.soundWindows.map(({ startMs, endMs }) => ({ startMs, endMs }))
  const plan = planSilenceCuts(engine.project, elementId, { words }, { minGapMs: 300, paddingMs: 0, trimEnds: false })
  return plan.silences
}

export interface SilenceScore {
  activity: AudioActivity
  cuts: SilenceWindow[]
  violations: Violation[]
}

export function scoreSilence(fixture: ManifestFixture, samples: Float32Array, sampleRate: number): SilenceScore {
  const gaps = fixture.recipe.silenceGaps
  const activity = analyzeAudioSamples(samples, sampleRate)
  const cuts = planCutsFromActivity(fixture, activity)
  return {
    activity,
    cuts,
    violations: [
      ...missingGaps(gaps, activity.silenceWindows, 'activity-finds-gaps'),
      ...phantomSilences(gaps, activity.silenceWindows),
      ...missingGaps(gaps, cuts, 'planner-cuts-gaps'),
    ],
  }
}
