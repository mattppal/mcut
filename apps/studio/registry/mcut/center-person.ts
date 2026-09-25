'use client'

import { centerPersonOptionsSchema, planCenterPerson, type FaceSample } from '@mcut/editor'
import { createLocalFaceDetector } from '@mcut/media'
import {
  assertNever,
  elementIdSchema,
  getElementLocation,
  type AssetRef,
  type EditorEngine,
  type ElementId,
  type MulticamElement,
  type MulticamSource,
  type Project,
  type TimelineElement,
  type VideoElement,
} from '@mcut/timeline'
import { toast } from 'sonner'
import { z } from 'zod'
import type { ActionContext } from './action-registry'
import { ortWasmPaths } from './ort-wasm'

const centerPersonInputSchema = z.strictObject({
  elementId: elementIdSchema.optional(),
  source: z.string().min(1).optional(),
  ...centerPersonOptionsSchema.shape,
})

type CenterPersonInput = z.output<typeof centerPersonInputSchema>

type ReframeElement = VideoElement | MulticamElement

type DetectFaces = (src: string) => Promise<readonly FaceSample[]>

interface CenterPersonTarget {
  element: ReframeElement
  source: MulticamSource | undefined
  asset: AssetRef
}

interface CenterPersonResult {
  target: { elementId: ElementId; source?: string; assetId: string; assetName?: string }
  samples: number
  keys: number
  sourceRange: { startMs: number; endMs: number }
  filled: boolean
}

const PROGRESS_TOAST_ID = 'mcut-center-person'

const PROGRESS_LABEL = {
  model: (percent: number) => `Downloading face model… ${percent}% (one-time, cached after this)`,
  detect: (percent: number) => `Finding the person… ${percent}%`,
}

let detector: ReturnType<typeof createLocalFaceDetector> | null = null

async function detectFacesOnDevice(src: string): Promise<readonly FaceSample[]> {
  const paths = ortWasmPaths()
  detector ??= createLocalFaceDetector({
    ...(paths === null ? {} : { ortWasmPaths: paths }),
    onProgress: ({ phase, progress }) => {
      toast.loading(PROGRESS_LABEL[phase](Math.round(progress * 100)), { id: PROGRESS_TOAST_ID })
    },
  })
  toast.loading(PROGRESS_LABEL.detect(0), { id: PROGRESS_TOAST_ID })
  try {
    return await detector.detect(src)
  } finally {
    toast.dismiss(PROGRESS_TOAST_ID)
  }
}

const isReframeElement = (element: TimelineElement): element is ReframeElement => element.type === 'video' || element.type === 'multicam'

export function selectedReframeElement(engine: EditorEngine): ReframeElement | undefined {
  for (const elementId of engine.selection.elementIds) {
    const element = getElementLocation(engine.project, elementId)?.element
    if (element && isReframeElement(element)) return element
  }
  return undefined
}

function pickElement(engine: EditorEngine, elementId: ElementId | undefined): ReframeElement {
  if (elementId === undefined) {
    const selected = selectedReframeElement(engine)
    if (!selected) throw new Error('Select a video or multicam clip, or pass its elementId.')
    return selected
  }
  const element = getElementLocation(engine.project, elementId)?.element
  if (!element) throw new Error(`No element "${elementId}" in the project.`)
  if (!isReframeElement(element)) throw new Error(`Center person follows a face in a video or multicam clip, and "${elementId}" is ${element.type}.`)
  return element
}

function pickSource(project: Project, element: MulticamElement, key: string | undefined): MulticamSource {
  const source =
    key === undefined
      ? (element.sources.find((s) => s.key === 'camera') ?? element.sources.find((s) => project.assets[s.assetId]?.kind === 'video'))
      : element.sources.find((s) => s.key === key)
  if (source) return source
  const keys = element.sources.map((s) => s.key).join(', ')
  throw new Error(
    key === undefined
      ? `Multicam "${element.id}" has no video source to follow, only ${keys}.`
      : `Multicam "${element.id}" has no source "${key}", only ${keys}.`,
  )
}

function videoAsset(project: Project, assetId: string): AssetRef {
  const asset = project.assets[assetId]
  if (asset?.kind !== 'video') throw new Error(`Asset "${assetId}" is not a video, so it has no face to follow.`)
  return asset
}

function resolveTarget(engine: EditorEngine, input: CenterPersonInput): CenterPersonTarget {
  const element = pickElement(engine, input.elementId)
  switch (element.type) {
    case 'video':
      if (input.source !== undefined) throw new Error(`source picks a multicam angle, and "${element.id}" is a video clip.`)
      return { element, source: undefined, asset: videoAsset(engine.project, element.assetId) }
    case 'multicam': {
      const source = pickSource(engine.project, element, input.source)
      return { element, source, asset: videoAsset(engine.project, source.assetId) }
    }
    default:
      return assertNever(element)
  }
}

export async function centerPerson(engine: EditorEngine, input: CenterPersonInput, detect: DetectFaces = detectFacesOnDevice): Promise<CenterPersonResult> {
  const { element, source, asset } = resolveTarget(engine, input)
  const samples = await detect(asset.src)
  const plan = planCenterPerson(engine.project, { elementId: element.id, source: source?.key }, samples, input)
  engine.transact(() => {
    for (const command of plan) engine.dispatch(command)
  })
  const keys = plan[0].track ?? []
  return {
    target: { elementId: element.id, ...(source ? { source: source.key } : {}), assetId: asset.id, ...(asset.name ? { assetName: asset.name } : {}) },
    samples: samples.length,
    keys: keys.length,
    sourceRange: { startMs: keys[0]?.sourceMs ?? 0, endMs: keys.at(-1)?.sourceMs ?? 0 },
    filled: plan.some((command) => command.type === 'updateElement'),
  }
}

function parseCenterPersonInput(value: unknown): CenterPersonInput {
  const parsed = centerPersonInputSchema.safeParse(value ?? {})
  if (parsed.success) return parsed.data
  throw new Error(z.prettifyError(parsed.error))
}

export async function runCenterPersonAction({ engine, input, throwOnError }: ActionContext): Promise<CenterPersonResult | undefined> {
  if (throwOnError) return await centerPerson(engine, parseCenterPersonInput(input))
  try {
    await centerPerson(engine, parseCenterPersonInput(input))
    toast.success('Person centered')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not center the person')
  }
  return undefined
}
