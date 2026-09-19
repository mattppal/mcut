import { z } from 'zod'
import { CommandError } from '../errors'
import { layoutSchema } from '../layouts'
import { defineCommand, mustGetLayout } from './shared'

export const saveLayout = defineCommand({
  type: 'saveLayout',
  description:
    'Add or replace a multicam layout in the project (slots position sources ' +
    'on the canvas in normalized 0..1 rects; first slot paints bottom).',
  payloadSchema: z.object({ layout: layoutSchema }),
  reduce: (project, payload) => {
    const exists = project.layouts.some((l) => l.id === payload.layout.id)
    return {
      ...project,
      layouts: exists
        ? project.layouts.map((l) => (l.id === payload.layout.id ? payload.layout : l))
        : [...project.layouts, payload.layout],
    }
  },
})

export const removeLayout = defineCommand({
  type: 'removeLayout',
  description: 'Remove a project layout. Fails while any multicam cut still uses it.',
  payloadSchema: z.object({ layoutId: z.string().min(1) }),
  reduce: (project, payload) => {
    mustGetLayout(project, payload.layoutId)
    const inUse = project.tracks.some((track) =>
      track.elements.some(
        (e) => e.type === 'multicam' && e.angles.some((a) => a.layoutId === payload.layoutId),
      ),
    )
    if (inUse) {
      throw new CommandError('layout-in-use', `layout "${payload.layoutId}" is used by a multicam cut`)
    }
    return { ...project, layouts: project.layouts.filter((l) => l.id !== payload.layoutId) }
  },
})
