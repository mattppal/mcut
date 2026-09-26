import { applyCommand, createProject, type Crop, type Project, type Transform } from '@mcut/timeline'
import { renderFrame } from './render-frame'

const WIDTH = 320
const HEIGHT = 180
const BACKGROUND = '#172033'
const CROP = { x: 0.14, y: 0.12, w: 0.72, h: 0.74 }
const CAMERA = { x: 0.6, y: 0.6, w: 0.3, h: 0.3 }
const TILTED = { x: 12, y: -7, scaleX: 0.55, scaleY: 0.55, rotation: 15 }
const UPRIGHT = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }

export interface MulticamParity {
  cropped: number
  zoomed: number
  rotated: number
  preview: number
}

interface Scene {
  crop?: Crop
  zoomed?: boolean
  transform?: Transform
  renderScale?: number
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

function multicam(scene: Scene): Project {
  let project = createProject({ width: WIDTH, height: HEIGHT })
  for (const id of sources.keys()) {
    project = applyCommand(project, {
      type: 'addAsset',
      asset: { id, kind: 'video', src: `blob:${id}`, durationMs: 5000, width: WIDTH * 2, height: HEIGHT * 2 },
    })
  }
  const slots = [
    { source: 'screen', rect: { x: 0, y: 0, w: 1, h: 1 } },
    { source: 'camera', rect: CAMERA, cornerRadius: null, shadow: null, stroke: null },
  ]
  project = applyCommand(project, { type: 'saveLayout', layout: { id: 'l-pip', name: 'Screen and camera', slots } })
  const keyed = [
    { key: 'screen', assetId: 'a-screen' },
    { key: 'camera', assetId: 'a-camera' },
  ]
  project = applyCommand(project, {
    type: 'addElement',
    trackId: 't-default',
    element: {
      id: 'e-mc',
      type: 'multicam',
      startMs: 0,
      durationMs: 5000,
      sources: keyed,
      angles: [{ atMs: 0, layoutId: 'l-pip' }],
      transform: scene.transform ?? UPRIGHT,
      ...(scene.crop ? { crop: scene.crop } : {}),
    },
  })
  if (!scene.zoomed) return project
  return applyCommand(project, {
    type: 'addZoomRegion',
    elementId: 'e-mc',
    zoom: { atMs: 0, inMs: 100, holdMs: 2000, outMs: 100, scale: 2, focus: { x: 0.75, y: 0.5 }, motionBlur: 0 },
  })
}

function surface(renderScale: number): OffscreenCanvasRenderingContext2D {
  const ctx = new OffscreenCanvas(WIDTH * renderScale, HEIGHT * renderScale).getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0)
  return ctx
}

function composited(scene: Scene): Uint8ClampedArray {
  const renderScale = scene.renderScale ?? 1
  const ctx = surface(renderScale)
  renderFrame(ctx, multicam(scene), 1000, { source: { getFrame: (assetId) => sources.get(assetId) ?? null }, backgroundColor: BACKGROUND, renderScale })
  return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data
}

function drawnDirectly(scene: Scene): Uint8ClampedArray {
  const ctx = surface(scene.renderScale ?? 1)
  ctx.fillStyle = BACKGROUND
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  const { x, y, scaleX, scaleY, rotation } = scene.transform ?? UPRIGHT
  ctx.translate(WIDTH / 2 + x, HEIGHT / 2 + y)
  if (rotation) ctx.rotate((rotation * Math.PI) / 180)
  ctx.scale(scaleX, scaleY)
  const { crop } = scene
  if (crop) {
    ctx.beginPath()
    ctx.rect((-crop.w * WIDTH) / 2, (-crop.h * HEIGHT) / 2, crop.w * WIDTH, crop.h * HEIGHT)
    ctx.clip()
    ctx.translate((0.5 - crop.x - crop.w / 2) * WIDTH, (0.5 - crop.y - crop.h / 2) * HEIGHT)
  }
  if (scene.zoomed) {
    ctx.beginPath()
    ctx.rect(-WIDTH / 2, -HEIGHT / 2, WIDTH, HEIGHT)
    ctx.clip()
    ctx.translate(-WIDTH / 2, 0)
    ctx.scale(2, 2)
  }
  ctx.drawImage(screen, 0, 0, WIDTH * 2, HEIGHT * 2, -WIDTH / 2, -HEIGHT / 2, WIDTH, HEIGHT)
  ctx.drawImage(camera, 0, 0, WIDTH * 2, HEIGHT * 2, (CAMERA.x - 0.5) * WIDTH, (CAMERA.y - 0.5) * HEIGHT, CAMERA.w * WIDTH, CAMERA.h * HEIGHT)
  return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data
}

const maxChannelDelta = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => a.reduce((max, value, i) => Math.max(max, Math.abs(value - (b[i] ?? 0))), 0)

const parity = (scene: Scene): number => maxChannelDelta(composited(scene), drawnDirectly(scene))

function multicamParityProbe(): MulticamParity {
  return {
    cropped: parity({ crop: CROP }),
    zoomed: parity({ crop: CROP, zoomed: true }),
    rotated: parity({ transform: TILTED }),
    preview: parity({ crop: CROP, renderScale: 0.6 }),
  }
}

declare global {
  var multicamParityProbe: () => MulticamParity
}

globalThis.multicamParityProbe = multicamParityProbe
