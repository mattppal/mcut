import type { FaceBox } from './face-detector-protocol'

export const YUNET_INPUT_SIZE = 640

const STRIDES = [8, 16, 32] as const
const SCORE_THRESHOLD = 0.6
const NMS_IOU_THRESHOLD = 0.3

export interface FrameSize {
  width: number
  height: number
}

export type YunetOutputs = Readonly<Record<string, { readonly data: unknown }>>

interface Candidate extends FaceBox {
  score: number
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

export function letterboxSize(width: number, height: number): FrameSize {
  const scale = YUNET_INPUT_SIZE / Math.max(width, height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function writeYunetInput(rgba: Uint8ClampedArray, frame: FrameSize, input: Float32Array): void {
  const plane = YUNET_INPUT_SIZE * YUNET_INPUT_SIZE
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const pixel = (y * frame.width + x) * 4
      const target = y * YUNET_INPUT_SIZE + x
      input[target] = rgba[pixel + 2] ?? 0
      input[plane + target] = rgba[pixel + 1] ?? 0
      input[2 * plane + target] = rgba[pixel] ?? 0
    }
  }
}

function outputData(outputs: YunetOutputs, name: string): Float32Array {
  const data = outputs[name]?.data
  if (!(data instanceof Float32Array)) throw new Error(`YuNet returned no float output named ${name}`)
  return data
}

function candidates(outputs: YunetOutputs): Candidate[] {
  const found: Candidate[] = []
  for (const stride of STRIDES) {
    const cls = outputData(outputs, `cls_${stride}`)
    const obj = outputData(outputs, `obj_${stride}`)
    const bbox = outputData(outputs, `bbox_${stride}`)
    const cols = YUNET_INPUT_SIZE / stride
    for (const [i, classScore] of cls.entries()) {
      const score = Math.sqrt(clamp01(classScore) * clamp01(obj[i] ?? 0))
      if (score < SCORE_THRESHOLD) continue
      const w = Math.exp(bbox[i * 4 + 2] ?? 0) * stride
      const h = Math.exp(bbox[i * 4 + 3] ?? 0) * stride
      const cx = ((i % cols) + (bbox[i * 4] ?? 0)) * stride
      const cy = (Math.floor(i / cols) + (bbox[i * 4 + 1] ?? 0)) * stride
      found.push({ score, x: cx - w / 2, y: cy - h / 2, w, h })
    }
  }
  return found
}

function iou(a: FaceBox, b: FaceBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return 0
  return (w * h) / (a.w * a.h + b.w * b.h - w * h)
}

function suppressOverlaps(found: Candidate[]): Candidate[] {
  const kept: Candidate[] = []
  for (const candidate of found.sort((a, b) => b.score - a.score)) {
    if (kept.every((face) => iou(face, candidate) <= NMS_IOU_THRESHOLD)) kept.push(candidate)
  }
  return kept
}

function normalize(box: FaceBox, frame: FrameSize): FaceBox {
  const left = clamp01(box.x / frame.width)
  const top = clamp01(box.y / frame.height)
  const right = clamp01((box.x + box.w) / frame.width)
  const bottom = clamp01((box.y + box.h) / frame.height)
  return { x: left, y: top, w: right - left, h: bottom - top }
}

export function largestFace(outputs: YunetOutputs, frame: FrameSize): FaceBox | null {
  let largest: FaceBox | null = null
  for (const face of suppressOverlaps(candidates(outputs))) {
    if (largest === null || face.w * face.h > largest.w * largest.h) largest = face
  }
  return largest === null ? null : normalize(largest, frame)
}
