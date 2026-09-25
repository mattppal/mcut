import { assertNever } from './errors'
import type { Layout, LayoutSlot } from './layouts'
import type { Project } from './model'

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

function slotRole(layout: Layout, index: number): SlotRole {
  const slot = layout.slots[index]
  if (slot === undefined || coversFrame(slot)) return 'full-frame'
  return layout.slots.slice(0, index).some(coversFrame) ? 'overlay' : 'panel'
}

function layoutRole(layout: Layout): string {
  const roles = layout.slots.map((_, i) => slotRole(layout, i))
  if (roles.includes('overlay')) return 'picture-in-picture'
  if (layout.slots.length === 1) return roles[0] === 'full-frame' ? `full-frame ${layout.slots[0]?.source}` : `single ${layout.slots[0]?.source}, does not cover the frame`
  return 'split'
}

function corner(slot: LayoutSlot): string {
  const cx = slot.rect.x + slot.rect.w / 2
  const cy = slot.rect.y + slot.rect.h / 2
  return `${cy < 0.5 ? 'top' : 'bottom'}-${cx < 0.5 ? 'left' : 'right'}`
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
    if (was === now) {
      const moved = old.rect.x !== slot.rect.x || old.rect.y !== slot.rect.y
      const restyled = JSON.stringify({ ...old, rect: null }) !== JSON.stringify({ ...slot, rect: null })
      const change = [moved && `moved from x ${old.rect.x}, y ${old.rect.y} to x ${slot.rect.x}, y ${slot.rect.y}`, restyled && 'restyled'].filter(Boolean)
      lines.push(`  ${now} (${change.length > 0 ? change.join(', ') : 'unchanged'})`)
      return
    }
    lines.push(`  ${was} → ${now} (width ${percentChange(old.rect.w, slot.rect.w)}, height ${percentChange(old.rect.h, slot.rect.h)})`)
  })
  for (const slot of prev.slots) {
    if (!next.slots.some((s) => s.source === slot.source)) lines.push(`  removed ${slot.source} slot`)
  }
  const [prevOnly] = prev.slots
  const [nextOnly] = next.slots
  if (prev.slots.length === 1 && next.slots.length === 1 && prevOnly && nextOnly && coversFrame(prevOnly) && !coversFrame(nextOnly)) {
    lines.push(`Warning: the only slot of "${next.name}" no longer covers the frame, so every cut to this layout shows bars. Check that this is the layout you meant to edit.`)
  }
  return lines
}
