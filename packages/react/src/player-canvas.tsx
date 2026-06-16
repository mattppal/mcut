'use client'

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
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
  type SizeHelpers,
} from '@mcut/compositor'
import { getActiveMediaItems } from '@mcut/media'
import {
  getElement,
  getProjectDurationMs,
  hasKeyframes,
  isElementActiveAt,
  resolveAnimatedElement,
  type AnimatableProperty,
  type EditorEngine,
  type ElementId,
  type Project,
  type TextBox,
  type TimelineElement,
  type Transform,
} from '@mcut/timeline'
import { useEditorContext } from './context'
import { applyBoxResize, applyMove, applyResize, applyRotate, type GesturePoint } from './gestures'

/**
 * Preview raster resolution. `'auto'` renders at the displayed size,
 * a number caps the project's short side (720 ≈ 720p), `'full'` always
 * rasters at full project resolution. Every mode is capped at project
 * resolution — CSS scales the canvas to fit either way.
 */
export type PreviewQuality = 'auto' | 'full' | number

export interface PlayerCanvasProps {
  className?: string
  /** Enable canvas selection/move/resize/rotate. Default true. */
  interactive?: boolean
  /** Project background color. Default black. */
  background?: string
  /**
   * Elements left out of the render — e.g. a text element while a DOM
   * inline editor overlays it (renderFrame's skipElementIds).
   */
  hiddenElementIds?: ReadonlySet<string>
  /** Double-click on an element (topmost hit). Hosts use it to open editors. */
  onElementDoubleClick?: (elementId: ElementId) => void
  /**
   * Preview raster resolution; `'auto'` (default) matches the displayed
   * size. A 4K project in an ~800px pane rasters ~20× fewer pixels per
   * frame than `'full'`, which is usually the difference between smooth
   * and dropped playback on big projects.
   */
  quality?: PreviewQuality
  /**
   * Compositor backend. `'webgpu'` renders through the WebGPU pass
   * pipeline (requires `navigator.gpu`; falls back to canvas2d when
   * unavailable or when device initialization fails). Default `'webgpu'`.
   */
  renderer?: 'canvas2d' | 'webgpu'
}

interface GestureState {
  kind: 'move' | 'resize' | 'box-resize' | 'rotate'
  elementId: ElementId
  baseTransform: Transform
  baseOBB: OBB
  baseBox: (TextBox & { height: number; hadHeight: boolean }) | null
  handle: Exclude<HandleId, 'rotate'> | null
  start: GesturePoint
}

interface GestureFeedback {
  /** Element snapped to the canvas center on this axis: draw the guide. */
  guideVertical: boolean
  guideHorizontal: boolean
  /** Live readout ("1280×720", "45.0°") drawn under the element. */
  label: string | null
}

/** Snap-to-center threshold in screen px while moving an element. */
const CENTER_SNAP_PX = 10

const GESTURE_PROPERTIES: Array<[AnimatableProperty, keyof Transform]> = [
  ['position.x', 'x'],
  ['position.y', 'y'],
  ['scale.x', 'scaleX'],
  ['scale.y', 'scaleY'],
  ['rotation', 'rotation'],
]

/**
 * Apply a gesture's transform: armed properties (Premiere stopwatch on)
 * auto-key at the playhead; unarmed properties patch the static transform.
 * Runs inside the gesture transaction, so a whole drag is one undo entry.
 */
function applyGestureTransform(
  engine: EditorEngine,
  elementId: ElementId,
  transform: Transform,
  timelineMs: number,
): void {
  const element = getElement(engine.project, elementId)
  if (!element || !('transform' in element)) return
  const armed = GESTURE_PROPERTIES.filter(([property]) => hasKeyframes(element, property))
  if (armed.length === 0) {
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

/**
 * The preview player: renders the project through the shared compositor on
 * every animation frame, advances the playback clock, keeps the media pool
 * in sync, and hosts the selection overlay (drag / resize / rotate).
 */
/**
 * The raster scale for one preview frame: displayed size for `'auto'`
 * (quantized so sub-pixel layout jitter doesn't reallocate the canvas),
 * short-side cap for numeric presets, 1 for `'full'`. Never upscales
 * beyond project resolution.
 */
function getRenderScale(
  project: Project,
  quality: PreviewQuality,
  container: HTMLElement | null,
): number {
  if (quality === 'full') return 1
  if (typeof quality === 'number') {
    const shortSide = Math.min(project.width, project.height)
    return shortSide > 0 ? Math.min(1, quality / shortSide) : 1
  }
  const displayWidth = (container?.clientWidth ?? 0) * (window.devicePixelRatio || 1)
  if (displayWidth <= 0 || project.width <= 0) return 1
  return Math.min(1, (Math.ceil(displayWidth / 64) * 64) / project.width)
}

export function PlayerCanvas({
  className,
  interactive = true,
  background,
  quality = 'auto',
  hiddenElementIds,
  onElementDoubleClick,
  renderer = 'webgpu',
}: PlayerCanvasProps) {
  const { engine, pool } = useEditorContext()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const renderCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const gpuRef = useRef<{ key: string; backend: WebGPUBackend | null; pending: boolean } | null>(
    null,
  )
  const [webgpuUnavailable, setWebgpuUnavailable] = useState(false)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const measureCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const gestureRef = useRef<GestureState | null>(null)
  const feedbackRef = useRef<GestureFeedback>({
    guideVertical: false,
    guideHorizontal: false,
    label: null,
  })

  const sizeHelpers = (project: Project): SizeHelpers => ({
    getAssetSize: (assetId) => {
      const asset = project.assets[assetId]
      return asset?.width && asset?.height ? { width: asset.width, height: asset.height } : null
    },
    measureText: (text, style, box, runs) => {
      if (!measureCtxRef.current) {
        measureCtxRef.current = document.createElement('canvas').getContext('2d')
      }
      const ctx = measureCtxRef.current
      if (!ctx) return { width: 0, height: 0 }
      const layout = layoutTextBlock(measureWith(ctx), text, style, {
        box,
        ...(runs ? { runs } : {}),
      })
      return { width: layout.width, height: layout.height }
    },
  })

  const obbFor = (project: Project, element: TimelineElement): OBB | null =>
    getElementOBB(project, element, sizeHelpers(project))

  const effectiveRenderer = renderer === 'webgpu' && !webgpuUnavailable ? 'webgpu' : 'canvas2d'

  useEffect(() => {
    if (renderer === 'canvas2d') setWebgpuUnavailable(false)
  }, [renderer])

  // ---- render loop ---------------------------------------------------------

  useEffect(() => {
    let raf = 0
    let lastNow = performance.now()

    const loop = () => {
      const now = performance.now()
      const playback = engine.playback.state
      let project = engine.project

      if (playback.isPlaying) {
        const durationMs = getProjectDurationMs(project)
        const next = playback.currentTimeMs + (now - lastNow) * playback.playbackRate
        if (durationMs > 0 && next >= durationMs && playback.playbackRate > 0) {
          engine.seek(durationMs)
          engine.pause()
        } else if (next <= 0 && playback.playbackRate < 0) {
          // Reverse shuttle (J) hit the start of the timeline.
          engine.seek(0)
          engine.pause()
        } else {
          engine.seek(next)
        }
      }
      lastNow = now

      project = engine.project
      const { currentTimeMs, isPlaying, playbackRate, volume, muted } = engine.playback.state

      pool.sync(getActiveMediaItems(project, currentTimeMs), {
        isPlaying,
        playbackRate,
        masterVolume: volume,
        muted,
      })

      const canvas = renderCanvasRef.current
      if (canvas) {
        const scale = getRenderScale(project, quality, containerRef.current)
        const width = Math.max(1, Math.round(project.width * scale))
        const height = Math.max(1, Math.round(project.height * scale))
        if (canvas.width !== width) canvas.width = width
        if (canvas.height !== height) canvas.height = height
        const renderOptions = {
          source: pool,
          ...(background ? { backgroundColor: background } : {}),
          ...(hiddenRef.current && hiddenRef.current.size > 0
            ? { skipElementIds: hiddenRef.current }
            : {}),
        }
        if (effectiveRenderer === 'webgpu' && isWebGPUSupported()) {
          // The backend composites at project resolution and its present
          // pass stretches onto the (possibly downscaled) backing store.
          // Creation is async: frames skip until the device is ready. If
          // setup fails, the canvas remounts on the canvas2d backend.
          const key = `${project.width}x${project.height}`
          let gpu = gpuRef.current
          if (gpu && gpu.key !== key && gpu.backend) {
            gpu.backend.dispose()
            gpu = null
          }
          if (!gpu) {
            const created: { key: string; backend: WebGPUBackend | null; pending: boolean } = {
              key,
              backend: null,
              pending: true,
            }
            gpuRef.current = created
            gpu = created
            void WebGPUBackend.create({ canvas, width: project.width, height: project.height })
              .then((backend) => {
                if (gpuRef.current === created) {
                  created.backend = backend
                  created.pending = false
                } else {
                  backend.dispose()
                }
              })
              .catch(() => {
                if (gpuRef.current === created) {
                  created.pending = false
                  gpuRef.current = null
                }
                setWebgpuUnavailable(true)
              })
          }
          if (gpu.backend) {
            renderFrameWith(gpu.backend, project, currentTimeMs, renderOptions)
          }
        } else {
          const ctx = canvas.getContext('2d')
          if (ctx) {
            // renderFrame draws in project coordinates; the transform maps
            // them onto the (possibly downscaled) backing store.
            ctx.setTransform(scale, 0, 0, scale, 0, 0)
            renderFrame(ctx, project, currentTimeMs, renderOptions)
          }
        }
      }

      drawOverlay(project, currentTimeMs)
      raf = requestAnimationFrame(loop)
    }

    const drawOverlay = (project: Project, timeMs: number) => {
      const overlay = overlayCanvasRef.current
      const container = containerRef.current
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
      if (!interactive) return

      const selectedId = engine.selection.elementIds[0]
      if (!selectedId) return
      const raw = getElement(project, selectedId)
      if (!raw || !isElementActiveAt(raw, timeMs)) return
      const element = resolveAnimatedElement(raw, timeMs)
      const obb = obbFor(project, element)
      if (!obb) return

      const scale = width / project.width
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      const px = (value: number) => value / scale // constant screen-px sizes

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

      // Gesture feedback: center alignment guides + live readout.
      const feedback = feedbackRef.current
      if (gestureRef.current) {
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
          ctx.roundRect(
            obb.cx - metrics.width / 2 - padding,
            labelY - fontPx / 2 - padding,
            metrics.width + padding * 2,
            fontPx + padding * 2,
            px(4),
          )
          ctx.fill()
          ctx.fillStyle = '#ffffff'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(feedback.label, obb.cx, labelY)
          ctx.textAlign = 'left'
        }
      }
    }

    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      gpuRef.current?.backend?.dispose()
      gpuRef.current = null
    }
    // The loop reads engine/pool state directly each frame.
  }, [engine, pool, background, interactive, quality, effectiveRenderer])

  // The render loop reads these through refs so toggling them doesn't
  // restart the loop (it depends on engine/pool/quality only).
  const hiddenRef = useRef<ReadonlySet<string> | undefined>(hiddenElementIds)
  hiddenRef.current = hiddenElementIds
  const doubleClickRef = useRef<typeof onElementDoubleClick>(onElementDoubleClick)
  doubleClickRef.current = onElementDoubleClick

  // ---- pointer interactions ------------------------------------------------

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

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return
    const point = toProjectPoint(event)
    if (!point) return
    const project = engine.project
    const timeMs = engine.playback.state.currentTimeMs
    const handleHitSize = 10 * screenToProject()

    // 1. Handles of the current selection take priority.
    const selectedId = engine.selection.elementIds[0]
    if (selectedId) {
      const raw = getElement(project, selectedId)
      if (raw && isElementActiveAt(raw, timeMs) && 'transform' in raw) {
        // Gestures start from the RESOLVED transform so armed elements are
        // grabbed where they currently are on screen.
        const element = resolveAnimatedElement(raw, timeMs)
        const obb = obbFor(project, element)
        if (obb) {
          const handle = hitTestHandles(obb, point.x, point.y, handleHitSize)
          if (handle) {
            const baseBox =
              handle !== 'rotate' && element.type === 'text' && element.box
                ? {
                    ...element.box,
                    height: element.box.height ?? obb.height / element.transform.scaleY,
                    hadHeight: element.box.height !== undefined,
                  }
                : null
            gestureRef.current = {
              kind: handle === 'rotate' ? 'rotate' : baseBox ? 'box-resize' : 'resize',
              elementId: element.id,
              baseTransform: element.transform,
              baseOBB: obb,
              baseBox,
              handle: handle === 'rotate' ? null : handle,
              start: point,
            }
            engine.beginTransaction()
            event.currentTarget.setPointerCapture(event.pointerId)
            return
          }
        }
      }
    }

    // 2. Hit-test elements top-down (topmost track first, latest element first).
    for (let trackIndex = project.tracks.length - 1; trackIndex >= 0; trackIndex--) {
      const track = project.tracks[trackIndex]!
      if (track.hidden || track.locked) continue
      for (let i = track.elements.length - 1; i >= 0; i--) {
        const raw = track.elements[i]!
        if (!isElementActiveAt(raw, timeMs)) continue
        if (!('transform' in raw)) continue
        const element = resolveAnimatedElement(raw, timeMs)
        const obb = obbFor(project, element)
        if (!obb || !hitTestOBB(obb, point.x, point.y)) continue

        engine.select([element.id])
        gestureRef.current = {
          kind: 'move',
          elementId: element.id,
          baseTransform: element.transform,
          baseOBB: obb,
          baseBox: null,
          handle: null,
          start: point,
        }
        engine.beginTransaction()
        event.currentTarget.setPointerCapture(event.pointerId)
        return
      }
    }

    engine.clearSelection()
  }

  const handleDoubleClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!interactive || !doubleClickRef.current) return
    const point = toProjectPoint(event)
    if (!point) return
    const project = engine.project
    const timeMs = engine.playback.state.currentTimeMs
    for (let trackIndex = project.tracks.length - 1; trackIndex >= 0; trackIndex--) {
      const track = project.tracks[trackIndex]!
      if (track.hidden || track.locked) continue
      for (let i = track.elements.length - 1; i >= 0; i--) {
        const raw = track.elements[i]!
        if (!isElementActiveAt(raw, timeMs)) continue
        if (!('transform' in raw)) continue
        const element = resolveAnimatedElement(raw, timeMs)
        const obb = obbFor(project, element)
        if (!obb || !hitTestOBB(obb, point.x, point.y)) continue
        doubleClickRef.current(element.id)
        return
      }
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current
    if (!gesture) return
    const point = toProjectPoint(event)
    if (!point) return

    let transform: Transform
    const feedback = feedbackRef.current
    if (gesture.kind === 'move') {
      transform = applyMove(gesture.baseTransform, gesture.start, point)
      // Magnetic canvas center (hold Alt to bypass).
      const threshold = CENTER_SNAP_PX * screenToProject()
      feedback.guideVertical = false
      feedback.guideHorizontal = false
      if (!event.altKey) {
        if (Math.abs(transform.x) < threshold) {
          transform = { ...transform, x: 0 }
          feedback.guideVertical = true
        }
        if (Math.abs(transform.y) < threshold) {
          transform = { ...transform, y: 0 }
          feedback.guideHorizontal = true
        }
      }
      feedback.label = null
    } else if (gesture.kind === 'rotate') {
      transform = applyRotate(gesture.baseTransform, gesture.baseOBB, gesture.start, point)
      feedback.label = `${transform.rotation.toFixed(1)}°`
      feedback.guideVertical = false
      feedback.guideHorizontal = false
    } else if (gesture.kind === 'resize') {
      transform = applyResize(
        gesture.baseTransform,
        gesture.baseOBB,
        gesture.handle ?? 'se',
        gesture.start,
        point,
      )
      const width = (gesture.baseOBB.width / gesture.baseTransform.scaleX) * transform.scaleX
      const height = (gesture.baseOBB.height / gesture.baseTransform.scaleY) * transform.scaleY
      feedback.label = `${Math.round(width)}×${Math.round(height)}`
      feedback.guideVertical = false
      feedback.guideHorizontal = false
    } else {
      const baseBox = gesture.baseBox
      if (!baseBox || !gesture.handle) return
      const result = applyBoxResize(
        gesture.baseTransform,
        gesture.baseOBB,
        gesture.handle,
        point,
        12 * screenToProject(),
      )
      transform = result.transform
      const nextWidth = Math.max(1, Math.round(result.displayWidth / gesture.baseTransform.scaleX))
      const nextHeight = Math.max(1, Math.round(result.displayHeight / gesture.baseTransform.scaleY))
      const resizesHeight = gesture.handle.includes('n') || gesture.handle.includes('s')
      const box: TextBox = {
        width: nextWidth,
        overflow: baseBox.overflow,
        ...(baseBox.hadHeight || resizesHeight ? { height: nextHeight } : {}),
      }
      try {
        applyGestureTransform(engine, gesture.elementId, transform, engine.playback.state.currentTimeMs)
        engine.dispatch({ type: 'updateElement', elementId: gesture.elementId, patch: { box } })
      } catch {
        gestureRef.current = null
        engine.endTransaction()
      }
      feedback.label = `${Math.round(result.displayWidth)}×${Math.round(result.displayHeight)}`
      feedback.guideVertical = false
      feedback.guideHorizontal = false
      return
    }

    try {
      applyGestureTransform(engine, gesture.elementId, transform, engine.playback.state.currentTimeMs)
    } catch {
      // Element vanished mid-gesture (e.g. concurrent removal): cancel.
      gestureRef.current = null
      engine.endTransaction()
    }
  }

  const endGesture = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!gestureRef.current) return
    gestureRef.current = null
    feedbackRef.current = { guideVertical: false, guideHorizontal: false, label: null }
    engine.endTransaction()
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
      {/* Keyed by renderer: a canvas can only ever hold one context type. */}
      <canvas
        key={effectiveRenderer}
        ref={renderCanvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
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
