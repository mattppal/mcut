import { applyCommand, createProject, type Project } from '@mcut/timeline'
import { renderFrame } from './render-frame'

const WIDTH = 320
const HEIGHT = 180
const BACKGROUND = '#172033'
const CROP = { x: 0.14, y: 0.12, w: 0.72, h: 0.74 }
const CAMERA = { x: 0.6, y: 0.6, w: 0.3, h: 0.3 }

export interface CropParity {
  cropped: number
  zoomed: number
}

function diagonals(color: string): OffscreenCanvas {
  const canvas = new OffscreenCanvas(WIDTH * 2, HEIGHT * 2)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = '#f8fafc'
  ctx.lineWidth = 5
  for (let x = -canvas.height; x < canvas.width; x += 37) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x + canvas.height, canvas.height)
    ctx.stroke()
  }
  return canvas
}

const screen = diagonals('#16a3a0')
const camera = diagonals('#f2475b')
const sources = new Map([
  ['a-screen', screen],
  ['a-camera', camera],
])

function croppedMulticam(zoomed: boolean): Project {
  let project = createProject({ width: WIDTH, height: HEIGHT })
  for (const id of sources.keys()) {
    project = applyCommand(project, {
      type: 'addAsset',
      asset: { id, kind: 'video', src: `blob:${id}`, durationMs: 5000, width: WIDTH * 2, height: HEIGHT * 2 },
    })
  }
  const slots = [
    { source: 'screen', rect: { x: 0, y: 0, w: 1, h: 1 } },
    { source: 'camera', rect: CAMERA },
  ]
  project = applyCommand(project, { type: 'saveLayout', layout: { id: 'l-pip', name: 'Screen and camera', slots } })
  const keyed = [
    { key: 'screen', assetId: 'a-screen' },
    { key: 'camera', assetId: 'a-camera' },
  ]
  project = applyCommand(project, {
    type: 'addElement',
    trackId: 't-default',
    element: { id: 'e-mc', type: 'multicam', startMs: 0, durationMs: 5000, sources: keyed, angles: [{ atMs: 0, layoutId: 'l-pip' }], crop: CROP },
  })
  if (!zoomed) return project
  return applyCommand(project, {
    type: 'addZoomRegion',
    elementId: 'e-mc',
    zoom: { atMs: 0, inMs: 100, holdMs: 2000, outMs: 100, scale: 2, focus: { x: 0.75, y: 0.5 }, motionBlur: 0 },
  })
}

function surface(): OffscreenCanvasRenderingContext2D {
  const ctx = new OffscreenCanvas(WIDTH, HEIGHT).getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  return ctx
}

function composited(zoomed: boolean): Uint8ClampedArray {
  const ctx = surface()
  renderFrame(ctx, croppedMulticam(zoomed), 1000, { source: { getFrame: (assetId) => sources.get(assetId) ?? null }, backgroundColor: BACKGROUND })
  return ctx.getImageData(0, 0, WIDTH, HEIGHT).data
}

function drawnDirectly(zoomed: boolean): Uint8ClampedArray {
  const ctx = surface()
  ctx.fillStyle = BACKGROUND
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  const box = { w: CROP.w * WIDTH, h: CROP.h * HEIGHT }
  ctx.translate(WIDTH / 2, HEIGHT / 2)
  ctx.beginPath()
  ctx.rect(-box.w / 2, -box.h / 2, box.w, box.h)
  ctx.clip()
  ctx.translate((0.5 - CROP.x - CROP.w / 2) * WIDTH, (0.5 - CROP.y - CROP.h / 2) * HEIGHT)
  if (zoomed) {
    ctx.beginPath()
    ctx.rect(-WIDTH / 2, -HEIGHT / 2, WIDTH, HEIGHT)
    ctx.clip()
    ctx.translate(-WIDTH / 2, 0)
    ctx.scale(2, 2)
  }
  ctx.drawImage(screen, 0, 0, WIDTH * 2, HEIGHT * 2, -WIDTH / 2, -HEIGHT / 2, WIDTH, HEIGHT)
  ctx.drawImage(camera, 0, 0, WIDTH * 2, HEIGHT * 2, (CAMERA.x - 0.5) * WIDTH, (CAMERA.y - 0.5) * HEIGHT, CAMERA.w * WIDTH, CAMERA.h * HEIGHT)
  return ctx.getImageData(0, 0, WIDTH, HEIGHT).data
}

const maxChannelDelta = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => a.reduce((max, value, i) => Math.max(max, Math.abs(value - (b[i] ?? 0))), 0)

function multicamParityProbe(): CropParity {
  return {
    cropped: maxChannelDelta(composited(false), drawnDirectly(false)),
    zoomed: maxChannelDelta(composited(true), drawnDirectly(true)),
  }
}

declare global {
  var multicamParityProbe: () => CropParity
}

globalThis.multicamParityProbe = multicamParityProbe
