import { z } from 'zod'
import { CommandError } from '../errors'
import { defaultSlotAnchor } from '../layout-summary'
import { layoutSchema, resizeSlotRect, slotResizeSchema } from '../layouts'
import { defineCommand, mustGetLayout } from './shared'

export const saveLayout = defineCommand({
  type: 'saveLayout',
  description:
    'Add or replace a multicam layout in the project (slots position sources ' +
    'on the canvas in normalized 0..1 rects; first slot paints bottom). A slot takes the same frame style ' +
    'as a video clip (crop, cornerRadius, stroke, shadow); its crop picks the source region that is fitted into the rect.',
  payloadSchema: z.object({ layout: layoutSchema }),
  reduce: (project, payload) => {
    const exists = project.layouts.some((l) => l.id === payload.layout.id)
    return {
      ...project,
      layouts: exists ? project.layouts.map((l) => (l.id === payload.layout.id ? payload.layout : l)) : [...project.layouts, payload.layout],
    }
  },
})

export const resizeLayoutSlot = defineCommand({
  type: 'resizeLayoutSlot',
  description:
    'Resize one layout slot around a fixed anchor, so it keeps its place instead of jumping to another corner. ' +
    "anchor defaults to the slot's corner for an overlay and to center for a full-frame or panel slot. aspect is pixel width over height. " +
    'widthPx and heightPx set an exact size, and with only one of them the other side follows aspect. ' +
    'With neither, keep (area by default) says what stays fixed when the aspect changes, so a taller slot keeps its visual size, and scale multiplies the result. ' +
    'The slot stays inside the frame and shrinks, keeping its aspect, when it cannot fit. Every cut to this layout changes.',
  payloadSchema: z.object({ layoutId: z.string().min(1), source: z.string().min(1), ...slotResizeSchema.shape }),
  reduce: (project, payload) => {
    const layout = mustGetLayout(project, payload.layoutId)
    const index = layout.slots.findIndex((slot) => slot.source === payload.source)
    const slot = layout.slots[index]
    if (!slot) throw new CommandError('unknown-slot', `layout "${layout.name}" has no "${payload.source}" slot`)
    const explicit = payload.widthPx !== undefined || payload.heightPx !== undefined
    if (explicit && (payload.scale !== undefined || payload.keep !== undefined)) {
      throw new CommandError('invalid-payload', 'scale and keep apply only when neither widthPx nor heightPx is given')
    }
    if (payload.widthPx !== undefined && payload.heightPx !== undefined && payload.aspect !== undefined) {
      throw new CommandError('invalid-payload', 'widthPx and heightPx already set the aspect, so drop aspect or one of them')
    }
    const rect = resizeSlotRect(slot.rect, project, { ...payload, anchor: payload.anchor ?? defaultSlotAnchor(layout, index) })
    const next = { ...layout, slots: layout.slots.map((s, i) => (i === index ? { ...s, rect } : s)) }
    return { ...project, layouts: project.layouts.map((l) => (l.id === layout.id ? next : l)) }
  },
})

export const removeLayout = defineCommand({
  type: 'removeLayout',
  description: 'Remove a project layout. Fails while any multicam cut still uses it.',
  payloadSchema: z.object({ layoutId: z.string().min(1) }),
  reduce: (project, payload) => {
    mustGetLayout(project, payload.layoutId)
    const inUse = project.tracks.some((track) => track.elements.some((e) => e.type === 'multicam' && e.angles.some((a) => a.layoutId === payload.layoutId)))
    if (inUse) {
      throw new CommandError('layout-in-use', `layout "${payload.layoutId}" is used by a multicam cut`)
    }
    return { ...project, layouts: project.layouts.filter((l) => l.id !== payload.layoutId) }
  },
})
