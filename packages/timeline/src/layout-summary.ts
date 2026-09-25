import { assertNever } from './errors'
import type { Layout, LayoutSlot, SlotAnchor } from './layouts'
import type { Project } from './model'
import { FRAME_STYLE_FIELDS, type FrameStyle } from './style'

type SlotRole = 'full-frame' | 'overlay' | 'panel'

interface Frame {
  width: number
  height: number
}

const NAMED_ASPECTS: ReadonlyArray<readonly [string, number]> = [
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['1:1', 1],
  ['4:5', 4 / 5],
]

function coversFrame(slot: LayoutSlot): boolean {
  const { x, y, w, h } = slot.rect
  return x <= 0 && y <= 0 && x + w >= 1 && y + h >= 1
}

export function slotRole(layout: Layout, index: number): SlotRole {
  const slot = layout.slots[index]
  if (slot === undefined || coversFrame(slot)) return 'full-frame'
  return layout.slots.slice(0, index).some(coversFrame) ? 'overlay' : 'panel'
}

function layoutRole(layout: Layout): string {
  const roles = layout.slots.map((_, i) => slotRole(layout, i))
  if (roles.includes('overlay')) return 'picture-in-picture'
  if (layout.slots.length === 1)
    return roles[0] === 'full-frame' ? `full-frame ${layout.slots[0]?.source}` : `single ${layout.slots[0]?.source}, does not cover the frame`
  return 'split'
}

function corner(slot: LayoutSlot): Exclude<SlotAnchor, 'center'> {
  const cx = slot.rect.x + slot.rect.w / 2
  const cy = slot.rect.y + slot.rect.h / 2
  return `${cy < 0.5 ? 'top' : 'bottom'}-${cx < 0.5 ? 'left' : 'right'}`
}

export function defaultSlotAnchor(layout: Layout, index: number): SlotAnchor {
  const slot = layout.slots[index]
  return slot !== undefined && slotRole(layout, index) === 'overlay' ? corner(slot) : 'center'
}

function cornerWarnings(prev: Layout, next: Layout): string[] {
  return next.slots.flatMap((slot, i) => {
    const j = prev.slots.findIndex((s) => s.source === slot.source)
    const old = prev.slots[j]
    if (old === undefined || slotRole(prev, j) !== 'overlay' || slotRole(next, i) !== 'overlay' || corner(old) === corner(slot)) return []
    return [`Warning: ${slot.source} moved from ${corner(old)} to ${corner(slot)}. Use resizeLayoutSlot to change size or aspect in place.`]
  })
}

type Fields = Record<string, string | number>

const fieldsText = (value: Fields) =>
  Object.entries(value)
    .map(([key, field]) => `${key} ${field}`)
    .join(', ')

function fieldsChange<T extends Fields>(label: string, old: T | undefined, next: T | undefined, text: (value: T) => string = fieldsText): string[] {
  if (old === undefined) return next === undefined ? [] : [`${label} added (${text(next)})`]
  if (next === undefined) return [`${label} removed`]
  return Object.keys(next)
    .filter((key) => old[key] !== next[key])
    .map((key) => `${label} ${key} ${old[key]} → ${next[key]}`)
}

const STYLE_CHANGES: Record<keyof FrameStyle, (old: FrameStyle, next: FrameStyle) => string[]> = {
  crop: (old, next) => fieldsChange('crop', old.crop, next.crop),
  cornerRadius: ({ cornerRadius: from = 0 }, { cornerRadius: to = 0 }) => (from === to ? [] : [`corner radius ${from} → ${to}`]),
  stroke: (old, next) => fieldsChange('stroke', old.stroke, next.stroke, (stroke) => `${stroke.width} px ${stroke.color}`),
  shadow: (old, next) => fieldsChange('shadow', old.shadow, next.shadow),
}

function styleChanges(old: LayoutSlot, next: LayoutSlot): string[] {
  const fit = old.fit === next.fit ? [] : [`fit ${old.fit} → ${next.fit}`]
  return [...fit, ...FRAME_STYLE_FIELDS.flatMap((key) => STYLE_CHANGES[key](old, next))]
}

function lostStyleWarnings(prev: Layout, next: Layout): string[] {
  return next.slots.flatMap((slot, i) => {
    const old = prev.slots.find((s) => s.source === slot.source)
    if (old === undefined || slotRole(next, i) !== 'overlay') return []
    const lostRadius = (old.cornerRadius ?? 0) > 0 && (slot.cornerRadius ?? 0) === 0
    const lostShadow = old.shadow !== undefined && slot.shadow === undefined
    const lost = [lostRadius && 'corner radius', lostShadow && 'shadow'].filter((name) => name !== false)
    if (lost.length === 0) return []
    const restore = { source: slot.source, ...(lostRadius && { cornerRadius: old.cornerRadius }), ...(lostShadow && { shadow: old.shadow }) }
    return [
      `Warning: the ${slot.source} overlay lost its ${lost.join(' and ')}. ` +
        `To restore ${lost.length > 1 ? 'them' : 'it'}, save this layout with ${JSON.stringify(restore)} as the ${slot.source} slot.`,
    ]
  })
}

function pixels(slot: LayoutSlot, frame: Frame): string {
  const w = Math.round(slot.rect.w * frame.width)
  const h = Math.round(slot.rect.h * frame.height)
  const aspect = w / h
  const named = NAMED_ASPECTS.find(([, value]) => Math.abs(aspect / value - 1) < 0.02)
  return `${w}×${h} px, aspect ${aspect.toFixed(2)}${named ? ` (${named[0]})` : ''}`
}

function percentChange(from: number, to: number): string {
  const change = Math.round((to / from - 1) * 100)
  return `${change > 0 ? '+' : ''}${change}%`
}

function describeSlot(layout: Layout, index: number, frame: Frame): string {
  const slot = layout.slots[index]
  if (slot === undefined) return ''
  const role = slotRole(layout, index)
  switch (role) {
    case 'full-frame':
    case 'panel':
      return `${slot.source} ${role} ${pixels(slot, frame)}`
    case 'overlay':
      return `${slot.source} overlay ${corner(slot)} ${pixels(slot, frame)}`
    default:
      return assertNever(role)
  }
}

export function summarizeLayouts(project: Project): string[] {
  if (project.layouts.length === 0) return []
  const lines = ['Layouts:']
  for (const layout of project.layouts) {
    lines.push(`  ${layout.id} "${layout.name}" (${layoutRole(layout)}):`)
    layout.slots.forEach((_, i) => lines.push(`    ${describeSlot(layout, i, project)}`))
  }
  return lines
}

export function describeLayoutChange(before: Project, after: Project, layoutId: string): string[] {
  const next = after.layouts.find((l) => l.id === layoutId)
  if (next === undefined) return []
  const prev = before.layouts.find((l) => l.id === layoutId)
  if (prev === undefined) return [`Added layout "${next.name}" (${layoutRole(next)}).`]
  const lines = [`Layout "${next.name}" (${layoutRole(next)}), before → after:`]
  next.slots.forEach((slot, i) => {
    const now = describeSlot(next, i, after)
    const old = prev.slots.find((s) => s.source === slot.source)
    if (old === undefined) {
      lines.push(`  new slot → ${now}`)
      return
    }
    const was = describeSlot(prev, prev.slots.indexOf(old), before)
    const style = styleChanges(old, slot)
    if (was === now) {
      const moved = old.rect.x !== slot.rect.x || old.rect.y !== slot.rect.y
      const change = [...(moved ? [`moved from x ${old.rect.x}, y ${old.rect.y} to x ${slot.rect.x}, y ${slot.rect.y}`] : []), ...style]
      lines.push(`  ${now} (${change.length > 0 ? change.join(', ') : 'unchanged'})`)
      return
    }
    const resize = [`width ${percentChange(old.rect.w, slot.rect.w)}`, `height ${percentChange(old.rect.h, slot.rect.h)}`]
    lines.push(`  ${was} → ${now} (${[...resize, ...style].join(', ')})`)
  })
  for (const slot of prev.slots) {
    if (!next.slots.some((s) => s.source === slot.source)) lines.push(`  removed ${slot.source} slot`)
  }
  lines.push(...cornerWarnings(prev, next), ...lostStyleWarnings(prev, next))
  const [prevOnly] = prev.slots
  const [nextOnly] = next.slots
  if (prev.slots.length === 1 && next.slots.length === 1 && prevOnly && nextOnly && coversFrame(prevOnly) && !coversFrame(nextOnly)) {
    lines.push(
      `Warning: the only slot of "${next.name}" no longer covers the frame, so every cut to this layout shows bars. Check that this is the layout you meant to edit.`,
    )
  }
  return lines
}
