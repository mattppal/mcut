import { applyCommand, createProject, getActiveLayout, getElement, type Project } from '@mcut/timeline'
import { renderFrame } from './render-frame'

const WIDTH = 320
const HEIGHT = 180
const RAMP_MS = 300
const HOLD_MS = 1200

export interface ZoomBlurReading {
  grey: number
  cameraMaxShift: number
}

function paint(width: number, height: number, draw: (ctx: OffscreenCanvasRenderingContext2D) => void): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  draw(ctx)
  return canvas
}

const frames = new Map<string, CanvasImageSource>([
  [
    'a-screen',
    paint(WIDTH, HEIGHT, (ctx) => {
      ctx.fillStyle = 'rgb(100, 100, 100)'
      ctx.fillRect(0, 0, WIDTH, HEIGHT)
    }),
  ],
  [
    'a-cam',
    paint(256, 144, (ctx) => {
      for (let x = 0; x < 256; x++) {
        ctx.fillStyle = `rgb(${x}, ${255 - x}, 128)`
        ctx.fillRect(x, 0, 1, 144)
      }
    }),
  ],
])

function zoomedMulticam(): Project {
  let project = createProject({ width: WIDTH, height: HEIGHT, fps: 30 })
  const base = project.tracks[0]?.id ?? 't-default'
  project = applyCommand(project, {
    type: 'addAsset',
    asset: { id: 'a-screen', kind: 'video', src: 'blob:screen', durationMs: 5000, width: WIDTH, height: HEIGHT },
  })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-cam', kind: 'video', src: 'blob:cam', durationMs: 5000, width: 256, height: 144 } })
  project = applyCommand(project, {
    type: 'addElement',
    trackId: base,
    element: { type: 'video', id: 'e-screen', assetId: 'a-screen', startMs: 0, durationMs: 5000 },
  })
  project = applyCommand(project, { type: 'addTrack' })
  const top = project.tracks[1]?.id ?? base
  project = applyCommand(project, { type: 'addElement', trackId: top, element: { type: 'video', id: 'e-cam', assetId: 'a-cam', startMs: 0, durationMs: 5000 } })
  project = applyCommand(project, { type: 'createMulticam', elementIds: ['e-screen', 'e-cam'], multicamId: 'e-mc' })
  return applyCommand(project, { type: 'addZoomRegion', elementId: 'e-mc', zoom: { preset: 'subtlePunchIn', source: 'screen', atMs: 0 } })
}

function renderAt(project: Project, timeMs: number, samples: number): Uint8ClampedArray {
  const ctx = new OffscreenCanvas(WIDTH, HEIGHT).getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  renderFrame(ctx, project, timeMs, { source: { getFrame: (assetId) => frames.get(assetId) ?? null }, motionBlurSamples: samples })
  return ctx.getImageData(0, 0, WIDTH, HEIGHT).data
}

function cameraInterior(project: Project) {
  const element = getElement(project, 'e-mc')
  if (element?.type !== 'multicam') throw new Error('no multicam element')
  const slot = getActiveLayout(project, element, RAMP_MS)?.slots.find((s) => s.source === 'camera')
  if (!slot) throw new Error('no camera slot')
  const { x, y, w, h } = slot.rect
  return {
    x0: Math.ceil((x + w * 0.2) * WIDTH),
    x1: Math.floor((x + w * 0.8) * WIDTH),
    y0: Math.ceil((y + h * 0.2) * HEIGHT),
    y1: Math.floor((y + h * 0.8) * HEIGHT),
  }
}

function zoomBlurProbe(samples: number): ZoomBlurReading {
  const project = zoomedMulticam()
  const ramp = renderAt(project, RAMP_MS, samples)
  const still = renderAt(project, HOLD_MS, samples)
  const offset = (x: number, y: number) => (y * WIDTH + x) * 4
  const { x0, x1, y0, y1 } = cameraInterior(project)
  let cameraMaxShift = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      for (let channel = 0; channel < 3; channel++) {
        const i = offset(x, y) + channel
        cameraMaxShift = Math.max(cameraMaxShift, Math.abs((ramp[i] ?? 0) - (still[i] ?? 0)))
      }
    }
  }
  return { grey: ramp[offset(Math.round(WIDTH * 0.3), Math.round(HEIGHT * 0.5))] ?? -1, cameraMaxShift }
}

declare global {
  var zoomBlurProbe: (samples: number) => ZoomBlurReading
}

globalThis.zoomBlurProbe = zoomBlurProbe
