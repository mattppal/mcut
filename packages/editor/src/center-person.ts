import { z } from 'zod'
import { assertNever, getElementLocation, type CommandOfType, type Crop, type ElementId, type Project, type VideoElement } from '@mcut/timeline'
import { OperatorError } from './operators'

export interface FaceSample {
  sourceMs: number
  box: { x: number; y: number; w: number; h: number } | null
}

export const centerPersonOptionsSchema = z.object({
  aspect: z
    .number()
    .positive()
    .default(9 / 16)
    .describe('Output width over height, such as 0.5625 for vertical 9:16 video. Default 9/16.'),
  smoothing: z
    .number()
    .min(0)
    .max(1)
    .default(0.5)
    .describe('How calmly the framing follows the face, from 0 for a tight follow to 1 for a steady frame. Default 0.5.'),
  fill: z
    .boolean()
    .optional()
    .describe(
      'Video only. true scales the clip to fill the frame and centers it, false keeps its size and position. By default it fills only when the crop aspect is within 1% of the project aspect, since a clip at another aspect is likely picture in picture.',
    ),
})

export type CenterPersonOptions = z.infer<typeof centerPersonOptionsSchema>

interface Key {
  sourceMs: number
  x: number
  y: number
}

interface Motion {
  omega: number
  dead: number
}

const SUBSTEPS = 10
const TOLERANCE = 0.004
const FILL_ASPECT_TOLERANCE = 0.01

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000

function faceCenters(samples: readonly FaceSample[]): Key[] {
  const ordered = [...samples].sort((a, b) => a.sourceMs - b.sourceMs)
  const firstBox = ordered.find((sample) => sample.box !== null)?.box
  if (!firstBox) throw new OperatorError('invalid-payload', `no face in ${samples.length} samples; pick a clip where a person faces the camera`)
  const centerOf = (box: NonNullable<FaceSample['box']>) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 })
  let held = centerOf(firstBox)
  const centers: Key[] = []
  for (const sample of ordered) {
    const sourceMs = Math.max(0, Math.round(sample.sourceMs))
    const previous = centers.at(-1)
    if (previous && sourceMs <= previous.sourceMs) continue
    if (sample.box) held = centerOf(sample.box)
    centers.push({ sourceMs, ...held })
  }
  return centers
}

function spring(centers: readonly Key[], axis: 'x' | 'y', motion: Motion, window: number): Key[] {
  const first = centers[0]
  if (!first) return []
  let position = first[axis]
  let velocity = 0
  let goal = position
  let previousMs = first.sourceMs
  const out: Key[] = []
  for (const center of centers) {
    if (Math.abs(center[axis] - goal) > motion.dead) goal = center[axis]
    const h = (center.sourceMs - previousMs) / 1000 / SUBSTEPS
    previousMs = center.sourceMs
    for (let step = 0; step < SUBSTEPS; step++) {
      velocity += (motion.omega * motion.omega * (goal - position) - 2 * motion.omega * velocity) * h
      position += velocity * h
    }
    out.push({ ...center, [axis]: Math.min(1 - window / 2, Math.max(window / 2, position)) })
  }
  return out
}

function splitIndex(segment: readonly Key[]): number {
  const first = segment[0]
  const last = segment.at(-1)
  if (!first || !last) return -1
  let worst = -1
  let worstError = TOLERANCE
  for (const [index, key] of segment.entries()) {
    const t = (key.sourceMs - first.sourceMs) / (last.sourceMs - first.sourceMs)
    const error = Math.max(Math.abs(key.x - (first.x + (last.x - first.x) * t)), Math.abs(key.y - (first.y + (last.y - first.y) * t)))
    if (error > worstError) {
      worst = index
      worstError = error
    }
  }
  return worst
}

function simplify(keys: readonly Key[]): Key[] {
  const kept = new Set<Key>()
  const segments: Array<readonly Key[]> = [keys]
  for (let segment = segments.pop(); segment; segment = segments.pop()) {
    const first = segment[0]
    const last = segment.at(-1)
    if (!first || !last) continue
    kept.add(first).add(last)
    const split = splitIndex(segment)
    if (split > 0) segments.push(segment.slice(0, split + 1), segment.slice(split))
  }
  return keys.filter((key) => kept.has(key))
}

function smoothTrack(centers: readonly Key[], motion: Motion, window: { w: number; h: number }): Key[] {
  const smoothed = spring(spring(centers, 'x', motion, window.w), 'y', motion, window.h)
  return simplify(smoothed).map((key) => ({ sourceMs: key.sourceMs, x: round4(key.x), y: round4(key.y) }))
}

interface Size {
  width: number
  height: number
}

function videoSize(project: Project, element: VideoElement): Size {
  const asset = project.assets[element.assetId]
  if (!asset) throw new OperatorError('unknown-asset', `no asset "${element.assetId}" for element "${element.id}"`)
  const { width, height } = asset
  if (width === undefined || height === undefined) {
    throw new OperatorError('unsupported', `asset "${asset.id}" has no width and height; probe the media before centering`)
  }
  return { width, height }
}

function centeredCrop({ width, height }: Size, aspect: number): Crop {
  const w = Math.min(1, (height * aspect) / width)
  const h = Math.min(1, width / aspect / height)
  return { x: round4((1 - w) / 2), y: round4((1 - h) / 2), w: round4(w), h: round4(h) }
}

function fillFrame(project: Project, element: VideoElement, cropped: Size, fill: boolean | undefined): Array<CommandOfType<'updateElement'>> {
  const aspectMatches = Math.abs(cropped.width / cropped.height / (project.width / project.height) - 1) <= FILL_ASPECT_TOLERANCE
  if (!(fill ?? aspectMatches)) return []
  const scale = round4(Math.max(project.width / cropped.width, project.height / cropped.height))
  return [{ type: 'updateElement', elementId: element.id, patch: { transform: { ...element.transform, x: 0, y: 0, scaleX: scale, scaleY: scale } } }]
}

export function planCenterPerson(
  project: Project,
  target: { elementId: ElementId; source?: string },
  samples: readonly FaceSample[],
  options: CenterPersonOptions,
): [CommandOfType<'setReframe'>, ...Array<CommandOfType<'updateElement'>>] {
  const element = getElementLocation(project, target.elementId)?.element
  if (!element) throw new OperatorError('unknown-element', `no element "${target.elementId}" in project`)
  const motion = { omega: 5 - 4 * options.smoothing, dead: 0.01 + 0.03 * options.smoothing }
  switch (element.type) {
    case 'video': {
      const size = videoSize(project, element)
      const crop = centeredCrop(size, options.aspect)
      return [
        { type: 'setReframe', elementId: element.id, source: target.source, track: smoothTrack(faceCenters(samples), motion, crop), crop },
        ...fillFrame(project, element, { width: size.width * crop.w, height: size.height * crop.h }, options.fill),
      ]
    }
    case 'multicam':
      return [{ type: 'setReframe', elementId: element.id, source: target.source, track: smoothTrack(faceCenters(samples), motion, { w: 0, h: 0 }) }]
    case 'audio':
    case 'image':
    case 'text':
    case 'caption':
      throw new OperatorError('invalid-payload', `center person follows a face in a video or multicam, not "${element.type}"`)
    default:
      return assertNever(element)
  }
}
