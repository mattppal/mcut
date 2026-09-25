import { expect, test } from 'bun:test'
import { largestFace, letterboxSize, writeYunetInput, type YunetOutputs } from './yunet'

interface SyntheticFace {
  stride: 8 | 16 | 32
  row: number
  col: number
  cls: number
  obj: number
  bbox: [number, number, number, number]
}

function yunetOutputs(faces: SyntheticFace[]): YunetOutputs {
  const outputs: Record<string, { data: Float32Array }> = {}
  for (const stride of [8, 16, 32] as const) {
    const cols = 640 / stride
    const cls = new Float32Array(cols * cols)
    const obj = new Float32Array(cols * cols)
    const bbox = new Float32Array(cols * cols * 4)
    for (const face of faces.filter((candidate) => candidate.stride === stride)) {
      const i = face.row * cols + face.col
      cls[i] = face.cls
      obj[i] = face.obj
      bbox.set(face.bbox, i * 4)
    }
    outputs[`cls_${stride}`] = { data: cls }
    outputs[`obj_${stride}`] = { data: obj }
    outputs[`bbox_${stride}`] = { data: bbox }
  }
  return outputs
}

const landscape = { width: 640, height: 360 }

test('letterboxSize fits the longer side to 640', () => {
  expect(letterboxSize(1920, 1080)).toEqual({ width: 640, height: 360 })
  expect(letterboxSize(1080, 1920)).toEqual({ width: 360, height: 640 })
})

test('writeYunetInput writes BGR planes with a 640 pixel row stride', () => {
  const input = new Float32Array(3 * 640 * 640)
  const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255])
  writeYunetInput(rgba, { width: 2, height: 2 }, input)
  const plane = 640 * 640
  expect([input[0], input[1], input[640], input[641]]).toEqual([30, 60, 90, 120])
  expect([input[plane], input[plane + 1], input[plane + 640], input[plane + 641]]).toEqual([20, 50, 80, 110])
  expect([input[2 * plane], input[2 * plane + 1], input[2 * plane + 640], input[2 * plane + 641]]).toEqual([10, 40, 70, 100])
})

test('largestFace keeps confident faces, suppresses overlaps, and returns the largest in source fractions', () => {
  const face = largestFace(
    yunetOutputs([
      { stride: 32, row: 3, col: 5, cls: 0.9, obj: 0.9, bbox: [0.5, 0.25, Math.log(2), Math.log(3)] },
      { stride: 16, row: 6, col: 10, cls: 0.8, obj: 0.8, bbox: [1, 0.5, Math.log(5), Math.log(7)] },
      { stride: 8, row: 10, col: 60, cls: 0.95, obj: 0.95, bbox: [0, 0, Math.log(4), Math.log(4)] },
      { stride: 8, row: 30, col: 20, cls: 0.5, obj: 0.7, bbox: [0, 0, Math.log(30), Math.log(30)] },
    ]),
    landscape,
  )
  expect(face?.x).toBeCloseTo(0.225, 5)
  expect(face?.y).toBeCloseTo(56 / 360, 5)
  expect(face?.w).toBeCloseTo(0.1, 5)
  expect(face?.h).toBeCloseTo(96 / 360, 5)
})

test('largestFace clamps a box that reaches into the letterbox padding and returns null without a face', () => {
  const face = largestFace(yunetOutputs([{ stride: 32, row: 10, col: 10, cls: 0.9, obj: 0.9, bbox: [0, 0, Math.log(2), Math.log(4)] }]), landscape)
  expect(face?.x).toBeCloseTo(288 / 640, 5)
  expect(face?.y).toBeCloseTo(256 / 360, 5)
  expect(face?.w).toBeCloseTo(64 / 640, 5)
  expect(face?.h).toBeCloseTo(1 - 256 / 360, 5)
  expect(largestFace(yunetOutputs([]), landscape)).toBeNull()
})
