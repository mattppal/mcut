'use client'

import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  getElementOBB,
  getHandles,
  hitTestHandles,
  hitTestOBB,
  isWebGPUSupported,
  layoutTextBlock,
  measureWith,
  renderFrame,
  renderFrameWith,
  WebGPUBackend,
  type HandleId,
  type OBB,
  type RenderFrameOptions,
} from '@mcut/compositor'
import { getActiveMediaItems } from '@mcut/media'
import {
  getElement,
  getGroupedElementIds,
  hasKeyframes,
  isElementActiveAt,
  resolveAnimatedElement,
  type AnimatableProperty,
  type EditorEngine,
  type ElementId,
  type PlaybackState,
  type Project,
  type TextBox,
  type TimelineElement,
  type Transform,
} from '@mcut/timeline'
import { useEditorContext } from './context'
import { applyBoxResize, applyMove, applyResize, applyRotate, type GesturePoint } from './gestures'
import { usePlaybackLoop } from './use-playback-loop'

export type PreviewQuality = 'auto' | 'full' | number

export interface PlayerCanvasProps {
  className?: string
  interactive?: boolean
  background?: string
  hiddenElementIds?: ReadonlySet<string>
  onElementDoubleClick?: (elementId: ElementId) => void
  quality?: PreviewQuality
  renderer?: 'canvas2d' | 'webgpu'
}

type Renderer = NonNullable<PlayerCanvasProps['renderer']>
type ResizeHandle = Exclude<HandleId, 'rotate'>
type TransformableElement = Extract<TimelineElement, { transform: Transform }>

interface GestureFeedback {
  guideVertical: boolean
  guideHorizontal: boolean
  label: string | null
}

interface GestureBase {
  elementId: ElementId
  elementIds: ElementId[]
  baseTransform: Transform
  baseOBB: OBB
  start: GesturePoint
  feedback: GestureFeedback | null
}

type GestureState = GestureBase &
  (
    | { kind: 'move' }
    | { kind: 'rotate' }
    | { kind: 'resize'; handle: ResizeHandle; preserveAspect: boolean }
    | {
        kind: 'box-resize'
        handle: ResizeHandle
        baseBox: TextBox & { height: number; hadHeight: boolean }
      }
  )

interface GestureStep {
  transform: Transform
  box: TextBox | null
  feedback: GestureFeedback
}

interface RenderTarget {
  canvas: HTMLCanvasElement
  gpu: WebGPUSlot
  paintedKey: PaintKey | null
}

interface OverlayView {
  project: Project
  timeMs: number
  interactive: boolean
  selectedIds: readonly ElementId[]
  gesture: GestureState | null
}

const CENTER_SNAP_PX = 10
const DISPLAY_WIDTH_QUANTUM_PX = 64
const PROJECT_RESOLUTION_SCALE = 1
const NO_GUIDES = { guideVertical: false, guideHorizontal: false }

const GESTURE_PROPERTIES: Array<[AnimatableProperty, keyof Transform]> = [
  ['position.x', 'x'],
  ['position.y', 'y'],
  ['scale.x', 'scaleX'],
  ['scale.y', 'scaleY'],
  ['rotation', 'rotation'],
]

function applyGestureTransform(engine: EditorEngine, elementId: ElementId, transform: Transform, timelineMs: number): void {
  const element = getElement(engine.project, elementId)
  if (!element || !('transform' in element)) return
  const propertiesWithKeyframes = GESTURE_PROPERTIES.filter(([property]) => hasKeyframes(element, property))
  if (propertiesWithKeyframes.length === 0) {
    engine.dispatch({ type: 'updateElement', elementId, patch: { transform } })
    return
  }
  const localMs = Math.max(0, Math.round(timelineMs - element.startMs))
  const staticTransform = { ...element.transform }
  for (const [property, key] of GESTURE_PROPERTIES) {
    if (hasKeyframes(element, property)) {
      engine.dispatch({
        type: 'setKeyframe',
        elementId,
        property,
        timeMs: localMs,
        value: transform[key],
      })
    } else {
      staticTransform[key] = transform[key]
    }
  }
  engine.dispatch({ type: 'updateElement', elementId, patch: { transform: staticTransform } })
}

function visualGroupElementIds(project: Project, elementId: ElementId): ElementId[] {
  return getGroupedElementIds(project, elementId).filter((id) => {
    const element = getElement(project, id)
    return Boolean(element && 'transform' in element)
  })
}

let measureContext: CanvasRenderingContext2D | null = null

function elementOBB(project: Project, element: TimelineElement): OBB | null {
  return getElementOBB(project, element, {
    getAssetSize: (assetId) => {
      const asset = project.assets[assetId]
      return asset?.width && asset?.height ? { width: asset.width, height: asset.height } : null
    },
    measureText: (text, style, box, runs) => {
      measureContext ??= document.createElement('canvas').getContext('2d')
      if (!measureContext) return { width: 0, height: 0 }
      const layout = layoutTextBlock(measureWith(measureContext), text, style, {
        box,
        ...(runs ? { runs } : {}),
      })
      return { width: layout.width, height: layout.height }
    },
  })
}

function selectedTransformable(project: Project, selectedIds: readonly ElementId[], timeMs: number): TransformableElement | null {
  for (const id of selectedIds) {
    const element = getElement(project, id)
    if (element && isElementActiveAt(element, timeMs) && 'transform' in element) return element
  }
  return null
}

function topmostElementAt(project: Project, point: GesturePoint, timeMs: number): { element: TransformableElement; obb: OBB } | null {
  for (const track of project.tracks.toReversed()) {
    if (track.hidden || track.locked) continue
    for (const raw of track.elements.toReversed()) {
      if (!isElementActiveAt(raw, timeMs) || !('transform' in raw)) continue
      const element = resolveAnimatedElement(raw, timeMs)
      const obb = elementOBB(project, element)
      if (obb && hitTestOBB(obb, point.x, point.y)) return { element, obb }
    }
  }
  return null
}

function gestureAt(project: Project, selectedIds: readonly ElementId[], point: GesturePoint, timeMs: number, handleHitSize: number): GestureState | null {
  const selected = selectedTransformable(project, selectedIds, timeMs)
  if (selected) {
    const element = resolveAnimatedElement(selected, timeMs)
    const obb = elementOBB(project, element)
    const handle = obb ? hitTestHandles(obb, point.x, point.y, handleHitSize) : null
    if (obb && handle) {
      const base: GestureBase = {
        elementId: element.id,
        elementIds: visualGroupElementIds(project, element.id),
        baseTransform: element.transform,
        baseOBB: obb,
        start: point,
        feedback: null,
      }
      if (handle === 'rotate') return { ...base, kind: 'rotate' }
      if (element.type === 'text' && element.box) {
        return {
          ...base,
          kind: 'box-resize',
          handle,
          baseBox: {
            ...element.box,
            height: element.box.height ?? obb.height / element.transform.scaleY,
            hadHeight: element.box.height !== undefined,
          },
        }
      }
      return { ...base, kind: 'resize', handle, preserveAspect: Boolean(element.groupId) }
    }
  }
  const hit = topmostElementAt(project, point, timeMs)
  if (!hit) return null
  return {
    kind: 'move',
    elementId: hit.element.id,
    elementIds: visualGroupElementIds(project, hit.element.id),
    baseTransform: hit.element.transform,
    baseOBB: hit.obb,
    start: point,
    feedback: null,
  }
}

function resolveGesture(gesture: GestureState, point: GesturePoint, altKey: boolean, screenToProject: number): GestureStep {
  switch (gesture.kind) {
    case 'move': {
      const moved = applyMove(gesture.baseTransform, gesture.start, point)
      const threshold = CENTER_SNAP_PX * screenToProject
      const guideVertical = !altKey && Math.abs(moved.x) < threshold
      const guideHorizontal = !altKey && Math.abs(moved.y) < threshold
      return {
        transform: { ...moved, x: guideVertical ? 0 : moved.x, y: guideHorizontal ? 0 : moved.y },
        box: null,
        feedback: { guideVertical, guideHorizontal, label: null },
      }
    }
    case 'rotate': {
      const transform = applyRotate(gesture.baseTransform, gesture.baseOBB, gesture.start, point)
      return {
        transform,
        box: null,
        feedback: { ...NO_GUIDES, label: `${transform.rotation.toFixed(1)}°` },
      }
    }
    case 'resize': {
      const transform = applyResize(gesture.baseTransform, gesture.baseOBB, gesture.handle, gesture.start, point, gesture.preserveAspect)
      const width = (gesture.baseOBB.width / gesture.baseTransform.scaleX) * transform.scaleX
      const height = (gesture.baseOBB.height / gesture.baseTransform.scaleY) * transform.scaleY
      return {
        transform,
        box: null,
        feedback: { ...NO_GUIDES, label: `${Math.round(width)}×${Math.round(height)}` },
      }
    }
    case 'box-resize': {
      const result = applyBoxResize(gesture.baseTransform, gesture.baseOBB, gesture.handle, point, 12 * screenToProject)
      const resizesHeight = gesture.handle.includes('n') || gesture.handle.includes('s')
      const height = Math.max(1, Math.round(result.displayHeight / gesture.baseTransform.scaleY))
      return {
        transform: result.transform,
        box: {
          width: Math.max(1, Math.round(result.displayWidth / gesture.baseTransform.scaleX)),
          overflow: gesture.baseBox.overflow,
          ...(gesture.baseBox.hadHeight || resizesHeight ? { height } : {}),
        },
        feedback: {
          ...NO_GUIDES,
          label: `${Math.round(result.displayWidth)}×${Math.round(result.displayHeight)}`,
        },
      }
    }
  }
}

class WebGPUSlot {
  private entry: { key: string; backend: WebGPUBackend | null } | null = null
  private readonly canvas: HTMLCanvasElement
  private readonly onUnavailable: () => void

  constructor(canvas: HTMLCanvasElement, onUnavailable: () => void) {
    this.canvas = canvas
    this.onUnavailable = onUnavailable
  }

  backendFor(width: number, height: number): WebGPUBackend | null {
    const key = `${width}x${height}`
    if (this.entry?.key === key) return this.entry.backend
    this.release()
    const created: { key: string; backend: WebGPUBackend | null } = { key, backend: null }
    this.entry = created
    void WebGPUBackend.create({ canvas: this.canvas, width, height }).then((backend) => {
      if (this.entry === created) created.backend = backend
      else backend.dispose()
    }, this.onUnavailable)
    return null
  }

  release(): void {
    this.entry?.backend?.dispose()
    this.entry = null
  }
}

function getRenderScale(project: Project, quality: PreviewQuality, container: HTMLElement | null): number {
  if (quality === 'full') return PROJECT_RESOLUTION_SCALE
  if (typeof quality === 'number') {
    const shortSide = Math.min(project.width, project.height)
    return shortSide > 0 ? Math.min(PROJECT_RESOLUTION_SCALE, quality / shortSide) : PROJECT_RESOLUTION_SCALE
  }
  const displayWidth = (container?.clientWidth ?? 0) * (window.devicePixelRatio || 1)
  if (displayWidth <= 0 || project.width <= 0) return PROJECT_RESOLUTION_SCALE
  const quantizedDisplayWidth = Math.ceil(displayWidth / DISPLAY_WIDTH_QUANTUM_PX) * DISPLAY_WIDTH_QUANTUM_PX
  return Math.min(PROJECT_RESOLUTION_SCALE, quantizedDisplayWidth / project.width)
}

function renderPreview(target: RenderTarget, renderer: Renderer, project: Project, timeMs: number, scale: number, options: RenderFrameOptions): boolean {
  const { canvas } = target
  const width = Math.max(1, Math.round(project.width * scale))
  const height = Math.max(1, Math.round(project.height * scale))
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  const frameOptions = { ...options, renderScale: scale }
  if (renderer === 'webgpu' && isWebGPUSupported()) {
    const backend = target.gpu.backendFor(project.width, project.height)
    if (!backend) return false
    renderFrameWith(backend, project, timeMs, frameOptions)
    return true
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  renderFrame(ctx, project, timeMs, frameOptions)
  return true
}

type PaintKey = readonly unknown[]

function samePaintKey(a: PaintKey | null, b: PaintKey): boolean {
  return a !== null && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
}

function drawOverlay(overlay: HTMLCanvasElement | null, container: HTMLElement | null, view: OverlayView): void {
  if (!overlay || !container) return
  const dpr = window.devicePixelRatio || 1
  const width = Math.max(1, Math.round(container.clientWidth * dpr))
  const height = Math.max(1, Math.round(container.clientHeight * dpr))
  if (overlay.width !== width) overlay.width = width
  if (overlay.height !== height) overlay.height = height
  const ctx = overlay.getContext('2d')
  if (!ctx) return

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, width, height)
  if (!view.interactive) return

  const { project, timeMs } = view
  const selected = selectedTransformable(project, view.selectedIds, timeMs)
  if (!selected) return
  const obb = elementOBB(project, resolveAnimatedElement(selected, timeMs))
  if (!obb) return

  const scale = width / project.width
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  const px = (value: number) => value / scale

  ctx.save()
  ctx.translate(obb.cx, obb.cy)
  ctx.rotate((obb.rotation * Math.PI) / 180)
  ctx.strokeStyle = '#3b82f6'
  ctx.lineWidth = px(1.5)
  ctx.setLineDash([px(6), px(4)])
  ctx.strokeRect(-obb.width / 2, -obb.height / 2, obb.width, obb.height)
  ctx.restore()

  ctx.setLineDash([])
  for (const handle of getHandles(obb)) {
    const size = px(handle.id === 'rotate' ? 10 : 8)
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = px(1.5)
    if (handle.id === 'rotate') {
      ctx.beginPath()
      ctx.arc(handle.x, handle.y, size / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    } else {
      ctx.fillRect(handle.x - size / 2, handle.y - size / 2, size, size)
      ctx.strokeRect(handle.x - size / 2, handle.y - size / 2, size, size)
    }
  }

  const feedback = view.gesture?.feedback
  if (!feedback) return
  if (feedback.guideVertical || feedback.guideHorizontal) {
    ctx.strokeStyle = '#e879f9'
    ctx.lineWidth = px(1)
    ctx.setLineDash([px(5), px(4)])
    ctx.beginPath()
    if (feedback.guideVertical) {
      ctx.moveTo(project.width / 2, 0)
      ctx.lineTo(project.width / 2, project.height)
    }
    if (feedback.guideHorizontal) {
      ctx.moveTo(0, project.height / 2)
      ctx.lineTo(project.width, project.height / 2)
    }
    ctx.stroke()
    ctx.setLineDash([])
  }
  if (feedback.label) {
    const fontPx = px(11)
    ctx.font = `${fontPx}px ui-monospace, monospace`
    const metrics = ctx.measureText(feedback.label)
    const padding = px(5)
    const labelY = obb.cy + obb.height / 2 + px(18)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
    ctx.beginPath()
    ctx.roundRect(obb.cx - metrics.width / 2 - padding, labelY - fontPx / 2 - padding, metrics.width + padding * 2, fontPx + padding * 2, px(4))
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(feedback.label, obb.cx, labelY)
    ctx.textAlign = 'left'
  }
}

export function PlayerCanvas({ renderer = 'webgpu', ...props }: PlayerCanvasProps) {
  return <PlayerCanvasView key={renderer} renderer={renderer} {...props} />
}

function PlayerCanvasView({
  className,
  interactive = true,
  background,
  quality = 'auto',
  hiddenElementIds,
  onElementDoubleClick,
  renderer,
}: Omit<PlayerCanvasProps, 'renderer'> & { renderer: Renderer }) {
  const { engine, pool } = useEditorContext()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [target, setTarget] = useState<RenderTarget | null>(null)
  const [webgpuUnavailable, setWebgpuUnavailable] = useState(false)
  const [gesture, setGesture] = useState<GestureState | null>(null)
  const effectiveRenderer: Renderer = renderer === 'webgpu' && !webgpuUnavailable ? 'webgpu' : 'canvas2d'

  const attachRenderCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return
    const attached: RenderTarget = {
      canvas,
      gpu: new WebGPUSlot(canvas, () => setWebgpuUnavailable(true)),
      paintedKey: null,
    }
    setTarget(attached)
    return () => {
      attached.gpu.release()
      setTarget((current) => (current === attached ? null : current))
    }
  }, [])

  usePlaybackLoop(engine, {
    clock: (frameTimeMs) => pool.audio.clockTimeMs(frameTimeMs),
    onFrame: (project, playback) => {
      pool.sync(getActiveMediaItems(project, playback.currentTimeMs), { isPlaying: playback.isPlaying, playbackRate: playback.playbackRate })
      pool.audio.sync(project, playback)
      const container = containerRef.current
      const scale = getRenderScale(project, quality, container)
      const paintKey: PaintKey = [
        project,
        playback.currentTimeMs,
        scale,
        container?.clientWidth,
        container?.clientHeight,
        window.devicePixelRatio,
        pool.frameVersion,
        document.fonts.size,
        document.fonts.status,
        effectiveRenderer,
        background,
        hiddenElementIds,
        interactive,
        engine.selection.elementIds,
        gesture,
      ]
      if (target) {
        if (!playback.isPlaying && samePaintKey(target.paintedKey, paintKey)) return
        const painted = renderPreview(target, effectiveRenderer, project, playback.currentTimeMs, scale, {
          source: pool,
          ...(background ? { backgroundColor: background } : {}),
          ...(hiddenElementIds && hiddenElementIds.size > 0 ? { skipElementIds: hiddenElementIds } : {}),
        })
        target.paintedKey = painted ? paintKey : null
      }
      drawOverlay(overlayCanvasRef.current, container, {
        project,
        timeMs: playback.currentTimeMs,
        interactive,
        selectedIds: engine.selection.elementIds,
        gesture,
      })
    },
  })

  const toProjectPoint = (event: { clientX: number; clientY: number }): GesturePoint | null => {
    const overlay = overlayCanvasRef.current
    const project = engine.project
    if (!overlay) return null
    const rect = overlay.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    return {
      x: ((event.clientX - rect.left) / rect.width) * project.width,
      y: ((event.clientY - rect.top) / rect.height) * project.height,
    }
  }

  const screenToProject = (): number => {
    const overlay = overlayCanvasRef.current
    if (!overlay) return 1
    const rect = overlay.getBoundingClientRect()
    return rect.width === 0 ? 1 : engine.project.width / rect.width
  }

  const closeGesture = () => {
    setGesture(null)
    engine.endTransaction()
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return
    const point = toProjectPoint(event)
    if (!point) return
    const project = engine.project
    const next = gestureAt(project, engine.selection.elementIds, point, engine.playback.state.currentTimeMs, 10 * screenToProject())
    if (!next) {
      engine.clearSelection()
      return
    }
    if (next.kind === 'move') engine.select(getGroupedElementIds(project, next.elementId))
    setGesture(next)
    engine.beginTransaction()
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleDoubleClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!interactive || !onElementDoubleClick) return
    const point = toProjectPoint(event)
    if (!point) return
    const hit = topmostElementAt(engine.project, point, engine.playback.state.currentTimeMs)
    if (hit) onElementDoubleClick(hit.element.id)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!gesture) return
    const point = toProjectPoint(event)
    if (!point) return
    const step = resolveGesture(gesture, point, event.altKey, screenToProject())
    const timeMs = engine.playback.state.currentTimeMs
    try {
      if (step.box) {
        applyGestureTransform(engine, gesture.elementId, step.transform, timeMs)
        engine.dispatch({
          type: 'updateElement',
          elementId: gesture.elementId,
          patch: { box: step.box },
        })
      } else {
        for (const elementId of gesture.elementIds) {
          applyGestureTransform(engine, elementId, step.transform, timeMs)
        }
      }
    } catch {
      closeGesture()
      return
    }
    setGesture({ ...gesture, feedback: step.feedback })
  }

  const endGesture = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!gesture) return
    closeGesture()
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        aspectRatio: 'var(--mcut-aspect, 16 / 9)',
        width: '100%',
      }}
      data-mcut-player=""
    >
      {/* A canvas keeps its first context kind for life (https://html.spec.whatwg.org/multipage/canvas.html#dom-canvas-getcontext), so the renderer keys it. */}
      <canvas key={effectiveRenderer} ref={attachRenderCanvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <canvas
        ref={overlayCanvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          touchAction: 'none',
          cursor: interactive ? 'default' : undefined,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  )
}
