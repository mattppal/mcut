import type { TimeMap } from '@mcut/timeline'
import { renderStretchOffline } from './signalsmith-offline'
import { valueAt } from './value-at'

export interface ConstantSpeed {
  rate: number
  sourceStartOffsetMs: number
  sourceSpanMs: number
}

export function constantSpeedOf(timeMap: TimeMap | undefined): ConstantSpeed | null {
  const [from, to, ...rest] = timeMap ?? []
  if (!from || !to || rest.length > 0) return null
  if (from.timeMs !== 0) return null
  if (from.easing !== undefined && from.easing !== 'linear') return null
  const sourceSpanMs = to.value - from.value
  const outputMs = to.timeMs - from.timeMs
  if (sourceSpanMs <= 0 || outputMs <= 0) return null
  return { rate: sourceSpanMs / outputMs, sourceStartOffsetMs: from.value, sourceSpanMs }
}

export interface StereoData {
  left: Float32Array
  right: Float32Array
  sampleRate: number
}

export async function stretchStereo(data: StereoData, tempo: number): Promise<StereoData> {
  const inputFrames = data.left.length
  const expectedFrames = Math.max(1, Math.round(inputFrames / tempo))
  const rendered = await renderStretchOffline([data.left, data.right], data.sampleRate, tempo, expectedFrames)
  return { left: valueAt(rendered, 0), right: valueAt(rendered, 1), sampleRate: data.sampleRate }
}
