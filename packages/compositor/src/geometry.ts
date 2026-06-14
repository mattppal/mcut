import type { Project, TextBox, TextRun, TextStyle, TimelineElement, Transform } from '@mcut/timeline'

/**
 * Element coordinates are center-origin: (0, 0) is the canvas center and the
 * element is anchored at its own center. This converts to canvas pixels.
 */
export function toCanvasPoint(project: Project, x: number, y: number): { x: number; y: number } {
  return { x: project.width / 2 + x, y: project.height / 2 + y }
}

export function fromCanvasPoint(project: Project, x: number, y: number): { x: number; y: number } {
  return { x: x - project.width / 2, y: y - project.height / 2 }
}

/** Oriented bounding box in canvas pixels. Rotation in degrees, clockwise. */
export interface OBB {
  cx: number
  cy: number
  width: number
  height: number
  rotation: number
}

export interface ElementSize {
  width: number
  height: number
}

export const degToRad = (deg: number): number => (deg * Math.PI) / 180

export interface SizeHelpers {
  /** Natural pixel size of a media asset (probed metadata). */
  getAssetSize?: (assetId: string) => ElementSize | null
  /** Measure a text block (unscaled). Required for text element bounds. */
  measureText?: (text: string, style: TextStyle, box?: TextBox, runs?: readonly TextRun[]) => ElementSize
}

export function getElementNaturalSize(
  element: TimelineElement,
  helpers: SizeHelpers = {},
): ElementSize | null {
  // Multicam composes full-canvas; it has no single natural size and is
  // positioned via the inspector rather than canvas handles.
  if (element.type === 'audio' || element.type === 'caption' || element.type === 'multicam') {
    return null
  }
  if (element.type === 'text') {
    return helpers.measureText?.(element.text, element.style, element.box, element.runs) ?? null
  }
  const size = helpers.getAssetSize?.(element.assetId) ?? null
  // A crop mask redefines the frame: the kept source region IS the element,
  // so display size, handles, and the inspector all follow the crop.
  if (size && 'crop' in element && element.crop) {
    return { width: size.width * element.crop.w, height: size.height * element.crop.h }
  }
  return size
}

export function getElementDisplaySize(
  element: TimelineElement,
  helpers: SizeHelpers = {},
): ElementSize | null {
  if (!('transform' in element)) return null
  const natural = getElementNaturalSize(element, helpers)
  if (!natural || natural.width <= 0 || natural.height <= 0) return null
  // Negative scale means flipped, not negative size.
  return {
    width: natural.width * Math.abs(element.transform.scaleX),
    height: natural.height * Math.abs(element.transform.scaleY),
  }
}

export interface DisplaySizePatch {
  width?: number
  height?: number
  preserveAspect?: boolean
}

export function getTransformForDisplaySize(
  transform: Transform,
  natural: ElementSize,
  patch: DisplaySizePatch,
): Transform {
  if (natural.width <= 0 || natural.height <= 0) return transform

  // Display sizes are unsigned; preserve each axis's flip (scale sign).
  const signX = transform.scaleX < 0 ? -1 : 1
  const signY = transform.scaleY < 0 ? -1 : 1
  let scaleX =
    patch.width !== undefined ? signX * Math.max(0.001, patch.width / natural.width) : transform.scaleX
  let scaleY =
    patch.height !== undefined ? signY * Math.max(0.001, patch.height / natural.height) : transform.scaleY

  if (patch.preserveAspect) {
    if (patch.width !== undefined && patch.height === undefined) scaleY = signY * Math.abs(scaleX)
    if (patch.height !== undefined && patch.width === undefined) scaleX = signX * Math.abs(scaleY)
  }

  return { ...transform, scaleX, scaleY }
}

/**
 * The element's oriented bounding box on the canvas, or `null` when its size
 * is unknown (e.g. unprobed media without a frame yet). Captions are
 * positioned by their style band and are not transformable; they have no OBB.
 */
export function getElementOBB(
  project: Project,
  element: TimelineElement,
  helpers: SizeHelpers = {},
): OBB | null {
  if (element.type === 'audio' || element.type === 'caption' || element.type === 'multicam') {
    return null
  }

  const natural = getElementNaturalSize(element, helpers)
  const transform = element.transform
  if (!natural || natural.width <= 0 || natural.height <= 0) return null

  const center = toCanvasPoint(project, transform.x, transform.y)
  return {
    cx: center.x,
    cy: center.y,
    width: natural.width * Math.abs(transform.scaleX),
    height: natural.height * Math.abs(transform.scaleY),
    rotation: transform.rotation,
  }
}

/** Is the canvas-space point inside the (rotated) box? */
export function hitTestOBB(obb: OBB, x: number, y: number): boolean {
  const rad = degToRad(-obb.rotation)
  const dx = x - obb.cx
  const dy = y - obb.cy
  const localX = dx * Math.cos(rad) - dy * Math.sin(rad)
  const localY = dx * Math.sin(rad) + dy * Math.cos(rad)
  return Math.abs(localX) <= obb.width / 2 && Math.abs(localY) <= obb.height / 2
}

export type HandleId =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'rotate'

export interface Handle {
  id: HandleId
  /** Canvas-space position. */
  x: number
  y: number
}

/** Distance of the rotate handle above the box's top edge (canvas px). */
export const ROTATE_HANDLE_OFFSET = 32

/** The 8 resize handles plus the rotate handle, in canvas space. */
export function getHandles(obb: OBB): Handle[] {
  const rad = degToRad(obb.rotation)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const hw = obb.width / 2
  const hh = obb.height / 2

  const local: Array<[HandleId, number, number]> = [
    ['nw', -hw, -hh],
    ['n', 0, -hh],
    ['ne', hw, -hh],
    ['e', hw, 0],
    ['se', hw, hh],
    ['s', 0, hh],
    ['sw', -hw, hh],
    ['w', -hw, 0],
    ['rotate', 0, -hh - ROTATE_HANDLE_OFFSET],
  ]

  return local.map(([id, lx, ly]) => ({
    id,
    x: obb.cx + lx * cos - ly * sin,
    y: obb.cy + lx * sin + ly * cos,
  }))
}

/** Hit-test the handles (square hit area of `size` px around each). */
export function hitTestHandles(obb: OBB, x: number, y: number, size = 12): HandleId | null {
  for (const handle of getHandles(obb)) {
    if (Math.abs(x - handle.x) <= size && Math.abs(y - handle.y) <= size) return handle.id
  }
  return null
}

/**
 * "Contain" scale factor for fitting a `width`×`height` media into the
 * project frame (used when inserting media elements).
 */
export function getFitScale(project: Project, width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1
  return Math.min(project.width / width, project.height / height)
}
