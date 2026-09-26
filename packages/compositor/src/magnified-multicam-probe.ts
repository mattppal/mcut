import { applyCommand, createProject, type Crop, type Project } from '@mcut/timeline'
import { renderFrame } from './render-frame'

const WIDTH = 320
const HEIGHT = 180
const BLOCK = 32

interface Sharpness {
  video: number
  multicam: number
}

export interface MagnifiedReading {
  export: Sharpness
  halfPreview: Sharpness
  cropped: Sharpness
}

function checkerboard(square: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(WIDTH * 2, HEIGHT * 2)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  const image = ctx.createImageData(canvas.width, canvas.height)
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const v = (Math.floor(x / square) + Math.floor(y / square)) % 2 === 0 ? 255 : 0
      image.data.set([v, v, v, 255], (y * canvas.width + x) * 4)
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

const squares = { 1: checkerboard(1), 2: checkerboard(2) }

function withSource(): Project {
  const project = createProject({ width: WIDTH, height: HEIGHT })
  return applyCommand(project, {
    type: 'addAsset',
    asset: { id: 'a-cam', kind: 'video', src: 'blob:cam', durationMs: 5000, width: WIDTH * 2, height: HEIGHT * 2 },
  })
}

function video(crop?: Crop): Project {
  return applyCommand(withSource(), {
    type: 'addElement',
    trackId: 't-default',
    element: { id: 'e-v', type: 'video', assetId: 'a-cam', startMs: 0, durationMs: 5000, ...(crop ? { crop } : {}) },
  })
}

function multicam(crop?: Crop): Project {
  const project = applyCommand(withSource(), {
    type: 'saveLayout',
    layout: { id: 'l-cam', name: 'Camera', slots: [{ source: 'camera', rect: { x: 0, y: 0, w: 1, h: 1 } }] },
  })
  return applyCommand(project, {
    type: 'addElement',
    trackId: 't-default',
    element: {
      id: 'e-mc',
      type: 'multicam',
      startMs: 0,
      durationMs: 5000,
      sources: [{ key: 'camera', assetId: 'a-cam' }],
      angles: [{ atMs: 0, layoutId: 'l-cam' }],
      transform: { x: 0, y: 0, scaleX: 2, scaleY: 2, rotation: 0 },
      ...(crop ? { crop } : {}),
    },
  })
}

function spread(project: Project, renderScale: number, square: 1 | 2): number {
  const ctx = new OffscreenCanvas(WIDTH * renderScale, HEIGHT * renderScale).getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0)
  renderFrame(ctx, project, 1000, { source: { getFrame: () => squares[square] }, renderScale })
  const { data } = ctx.getImageData((ctx.canvas.width - BLOCK) / 2, (ctx.canvas.height - BLOCK) / 2, BLOCK, BLOCK)
  const reds = data.filter((_, i) => i % 4 === 0)
  const mean = reds.reduce((sum, v) => sum + v, 0) / reds.length
  return Math.round(Math.sqrt(reds.reduce((sum, v) => sum + (v - mean) ** 2, 0) / reds.length))
}

function magnifiedMulticamProbe(): MagnifiedReading {
  const center: Crop = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }
  return {
    export: { video: spread(video(), 1, 1), multicam: spread(multicam(), 1, 1) },
    halfPreview: { video: spread(video(), 0.5, 2), multicam: spread(multicam(), 0.5, 2) },
    cropped: { video: spread(video(center), 1, 1), multicam: spread(multicam(center), 1, 1) },
  }
}

declare global {
  var magnifiedMulticamProbe: () => MagnifiedReading
}

globalThis.magnifiedMulticamProbe = magnifiedMulticamProbe
