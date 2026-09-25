import { z } from 'zod'
import { CommandError } from '../errors'
import { defaultSlotAnchor, slotRole } from '../layout-summary'
import { layoutSchema, layoutSlotSchema, pipFrameStyle, resizeSlotRect, slotResizeSchema, type Layout, type LayoutSlot } from '../layouts'
import type { Project } from '../model'
import { FRAME_STYLE_FIELDS, frameStyleSchema, type FrameStyle } from '../style'
import { defineCommand, mustGetLayout } from './shared'

const slotShape = layoutSlotSchema.shape
const styleShape = frameStyleSchema.shape

const slotPatchSchema = z.object({
  source: slotShape.source,
  rect: slotShape.rect.optional(),
  fit: slotShape.fit.unwrap().optional(),
  crop: styleShape.crop.nullable(),
  cornerRadius: styleShape.cornerRadius.nullable(),
  stroke: styleShape.stroke.nullable(),
  shadow: styleShape.shadow.nullable(),
})

const layoutPatchSchema = layoutSchema.extend({ slots: z.array(slotPatchSchema).min(1) })

type LayoutPatch = z.output<typeof layoutPatchSchema>
type SlotPatch = LayoutPatch['slots'][number]

const LOOK_FIELDS = ['cornerRadius', 'stroke', 'shadow'] as const

function patchField<K extends keyof FrameStyle>(style: FrameStyle, key: K, value: FrameStyle[K] | null): void {
  if (value === undefined) return
  if (value === null) delete style[key]
  else style[key] = value
}

function mergeSlot(old: LayoutSlot | undefined, patch: SlotPatch, layoutName: string): LayoutSlot {
  const rect = patch.rect ?? old?.rect
  if (rect === undefined) throw new CommandError('invalid-payload', `slot "${patch.source}" is new to layout "${layoutName}", so it needs a rect`)
  const slot: LayoutSlot = { ...old, source: patch.source, rect, fit: patch.fit ?? old?.fit ?? 'cover' }
  for (const key of FRAME_STYLE_FIELDS) patchField(slot, key, patch[key])
  return slot
}

function saveSlots(prev: Layout | undefined, patch: LayoutPatch, canvas: Pick<Project, 'width' | 'height'>): LayoutSlot[] {
  const saved = patch.slots.map((input) => {
    const old = prev?.slots.find((slot) => slot.source === input.source)
    return { slot: mergeSlot(old, input, patch.name), bare: old === undefined && LOOK_FIELDS.every((key) => input[key] === undefined) }
  })
  const layout = { ...patch, slots: saved.map(({ slot }) => slot) }
  return saved.map(({ slot, bare }, i) => (bare && slotRole(layout, i) === 'overlay' ? { ...slot, ...pipFrameStyle(slot.rect, canvas) } : slot))
}

export const saveLayout = defineCommand({
  type: 'saveLayout',
  description:
    'Add or replace a multicam layout in the project (slots position sources ' +
    'on the canvas in normalized 0..1 rects; first slot paints bottom). A slot takes the same frame style ' +
    'as a video clip (crop, cornerRadius, stroke, shadow); its crop picks the source region that is fitted into the rect. ' +
    'Each slot merges by source into the saved slot, so an omitted field keeps its value, null clears a frame style field, ' +
    'and rect is required only for a source new to the layout. A saved slot whose source is not in the list is removed. ' +
    'An overlay slot new to the layout that sets none of cornerRadius, stroke, and shadow gets the picture-in-picture look, ' +
    'cornerRadius 0.12 and a soft shadow sized to the slot. Set any of them, or null, to style it yourself.',
  payloadSchema: z.object({ layout: layoutPatchSchema }),
  reduce: (project, { layout: patch }) => {
    const prev = project.layouts.find((l) => l.id === patch.id)
    const layout: Layout = { id: patch.id, name: patch.name, slots: saveSlots(prev, patch, project) }
    return { ...project, layouts: prev ? project.layouts.map((l) => (l === prev ? layout : l)) : [...project.layouts, layout] }
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
