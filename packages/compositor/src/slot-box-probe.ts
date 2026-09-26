import { applyCommand, createProject, getElement, type Crop, type Project } from '@mcut/timeline'
import { getSlotBoxes } from './multicam'
import { renderFrame } from './render-frame'

const WIDTH = 320
const HEIGHT = 180
const PIP = { x: 0.65, y: 0.6, w: 0.25, h: 0.3 }

type Edges = [left: number, top: number, right: number, bottom: number]

export interface SlotBoxReading {
  drawn: Edges | null
  reported: Edges | null
}

interface Scene {
  crop?: Crop
  zoomed?: boolean
}

function solid(color: string): OffscreenCanvas {
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  return canvas
}

const sources = new Map([
  ['a-screen', solid('#16a3a0')],
  ['a-camera', solid('#ff00ff')],
])

function multicam(scene: Scene): Project {
  let project = createProject({ width: WIDTH, height: HEIGHT })
  for (const id of sources.keys()) {
    project = applyCommand(project, { type: 'addAsset', asset: { id, kind: 'video', src: `blob:${id}`, durationMs: 5000, width: WIDTH, height: HEIGHT } })
  }
  const slots = [
    { source: 'screen', rect: { x: 0, y: 0, w: 1, h: 1 } },
    { source: 'camera', rect: PIP, cornerRadius: null, shadow: null, stroke: null },
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

function drawnEdges(project: Project): Edges | null {
  const ctx = new OffscreenCanvas(WIDTH, HEIGHT).getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  renderFrame(ctx, project, 1000, { source: { getFrame: (assetId) => sources.get(assetId) ?? null }, backgroundColor: '#172033' })
  const { data } = ctx.getImageData(0, 0, WIDTH, HEIGHT)
  let edges: Edges | null = null
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4
      if ((data[i] ?? 0) < 200 || (data[i + 1] ?? 255) > 60 || (data[i + 2] ?? 0) < 200) continue
      edges = edges ? [Math.min(edges[0], x), Math.min(edges[1], y), Math.max(edges[2], x + 1), Math.max(edges[3], y + 1)] : [x, y, x + 1, y + 1]
    }
  }
  return edges
}

function reportedEdges(project: Project): Edges | null {
  const element = getElement(project, 'e-mc')
  if (element?.type !== 'multicam') throw new Error('no multicam e-mc')
  const camera = getSlotBoxes(project, element, 1000).find(({ sourceKey }) => sourceKey === 'camera')
  if (!camera) return null
  const { cx, cy, width, height } = camera.obb
  const round = (value: number) => Math.round(value * 1000) / 1000
  return [round(cx - width / 2), round(cy - height / 2), round(cx + width / 2), round(cy + height / 2)]
}

const reading = (scene: Scene): SlotBoxReading => {
  const project = multicam(scene)
  return { drawn: drawnEdges(project), reported: reportedEdges(project) }
}

function slotBoxProbe(): Record<'resting' | 'zoomed' | 'croppedZoomed', SlotBoxReading> {
  return {
    resting: reading({}),
    zoomed: reading({ zoomed: true }),
    croppedZoomed: reading({ crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, zoomed: true }),
  }
}

declare global {
  var slotBoxProbe: () => Record<'resting' | 'zoomed' | 'croppedZoomed', SlotBoxReading>
}

globalThis.slotBoxProbe = slotBoxProbe
