import { degToRad, type HandleId, type OBB } from '@mcut/compositor'
import type { Transform } from '@mcut/timeline'

export interface GesturePoint {
  x: number
  y: number
}

export interface BoxResizeResult {
  transform: Transform
  displayWidth: number
  displayHeight: number
}

const MIN_SCALE = 0.05
const MIN_BOX_SIZE = 8

/** Keep magnitude ≥ MIN_SCALE, preserving sign (negative scale = flip). */
const clampScale = (value: number): number => {
  const sign = value < 0 ? -1 : 1
  return sign * Math.max(MIN_SCALE, Math.abs(value))
}

function pointToLocal(obb: OBB, point: GesturePoint): GesturePoint {
  const rad = degToRad(-obb.rotation)
  const dx = point.x - obb.cx
  const dy = point.y - obb.cy
  return {
    x: dx * Math.cos(rad) - dy * Math.sin(rad),
    y: dx * Math.sin(rad) + dy * Math.cos(rad),
  }
}

function localDeltaToCanvas(obb: OBB, delta: GesturePoint): GesturePoint {
  const rad = degToRad(obb.rotation)
  return {
    x: delta.x * Math.cos(rad) - delta.y * Math.sin(rad),
    y: delta.x * Math.sin(rad) + delta.y * Math.cos(rad),
  }
}

/** Translate gesture: offset the base transform by the pointer delta. */
export function applyMove(base: Transform, start: GesturePoint, current: GesturePoint): Transform {
  return {
    ...base,
    x: Math.round(base.x + (current.x - start.x)),
    y: Math.round(base.y + (current.y - start.y)),
  }
}

/** Rotate gesture around the element center. */
export function applyRotate(
  base: Transform,
  obb: OBB,
  start: GesturePoint,
  current: GesturePoint,
): Transform {
  const startAngle = Math.atan2(start.y - obb.cy, start.x - obb.cx)
  const currentAngle = Math.atan2(current.y - obb.cy, current.x - obb.cx)
  let rotation = base.rotation + ((currentAngle - startAngle) * 180) / Math.PI
  rotation = ((((rotation + 180) % 360) + 360) % 360) - 180 // normalize to [-180, 180)
  return { ...base, rotation: Math.round(rotation * 10) / 10 }
}

/**
 * Resize gesture. Corner handles scale uniformly; edge handles scale one
 * axis. Pointer positions are mapped into the element's local (un-rotated)
 * space so resizing behaves intuitively on rotated elements.
 */
export function applyResize(
  base: Transform,
  obb: OBB,
  handle: Exclude<HandleId, 'rotate'>,
  start: GesturePoint,
  current: GesturePoint,
  preserveAspect = false,
): Transform {
  const localStart = pointToLocal(obb, start)
  const localCurrent = pointToLocal(obb, current)

  if (!preserveAspect && (handle === 'e' || handle === 'w')) {
    const factor = localStart.x === 0 ? 1 : localCurrent.x / localStart.x
    return { ...base, scaleX: clampScale(base.scaleX * factor) }
  }
  if (!preserveAspect && (handle === 'n' || handle === 's')) {
    const factor = localStart.y === 0 ? 1 : localCurrent.y / localStart.y
    return { ...base, scaleY: clampScale(base.scaleY * factor) }
  }
  const startDistance = preserveAspect && (handle === 'e' || handle === 'w')
    ? Math.abs(localStart.x)
    : preserveAspect && (handle === 'n' || handle === 's')
      ? Math.abs(localStart.y)
      : Math.hypot(localStart.x, localStart.y)
  const currentDistance = preserveAspect && (handle === 'e' || handle === 'w')
    ? Math.abs(localCurrent.x)
    : preserveAspect && (handle === 'n' || handle === 's')
      ? Math.abs(localCurrent.y)
      : Math.hypot(localCurrent.x, localCurrent.y)
  const factor = startDistance === 0 ? 1 : currentDistance / startDistance
  if (preserveAspect) {
    const baseScale = handle === 'n' || handle === 's'
      ? Math.abs(base.scaleY)
      : handle === 'e' || handle === 'w'
        ? Math.abs(base.scaleX)
        : Math.max(Math.abs(base.scaleX), Math.abs(base.scaleY))
    const scale = Math.max(MIN_SCALE, baseScale * factor)
    return {
      ...base,
      scaleX: (base.scaleX < 0 ? -1 : 1) * scale,
      scaleY: (base.scaleY < 0 ? -1 : 1) * scale,
    }
  }
  return {
    ...base,
    scaleX: clampScale(base.scaleX * factor),
    scaleY: clampScale(base.scaleY * factor),
  }
}

export function applyBoxResize(
  base: Transform,
  obb: OBB,
  handle: Exclude<HandleId, 'rotate'>,
  current: GesturePoint,
  minSize = MIN_BOX_SIZE,
): BoxResizeResult {
  const localCurrent = pointToLocal(obb, current)
  let left = -obb.width / 2
  let right = obb.width / 2
  let top = -obb.height / 2
  let bottom = obb.height / 2

  if (handle.includes('w')) left = localCurrent.x
  if (handle.includes('e')) right = localCurrent.x
  if (handle.includes('n')) top = localCurrent.y
  if (handle.includes('s')) bottom = localCurrent.y

  if (right - left < minSize) {
    if (handle.includes('w')) left = right - minSize
    else right = left + minSize
  }
  if (bottom - top < minSize) {
    if (handle.includes('n')) top = bottom - minSize
    else bottom = top + minSize
  }

  const centerDelta = localDeltaToCanvas(obb, {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
  })

  return {
    transform: {
      ...base,
      x: Math.round((base.x + centerDelta.x) * 10) / 10,
      y: Math.round((base.y + centerDelta.y) * 10) / 10,
    },
    displayWidth: Math.round((right - left) * 10) / 10,
    displayHeight: Math.round((bottom - top) * 10) / 10,
  }
}
