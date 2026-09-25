import { elementIdSchema } from '@mcut/timeline'
import { z } from 'zod'

export const frameGrabSchema = z.strictObject({
  mimeType: z.literal('image/png'),
  data: z.string().min(1),
  width: z.int().min(1),
  height: z.int().min(1),
  timeMs: z.number().min(0),
  elementId: elementIdSchema.optional(),
  visibleElementIds: z.array(elementIdSchema),
})

type FrameGrab = z.infer<typeof frameGrabSchema>

export function frameContent(frame: FrameGrab) {
  const summary = {
    timeMs: frame.timeMs,
    width: frame.width,
    height: frame.height,
    ...(frame.elementId !== undefined ? { elementId: frame.elementId } : {}),
    visibleElementIds: frame.visibleElementIds,
  }
  return {
    content: [
      { type: 'image' as const, data: frame.data, mimeType: 'image/png' as const },
      { type: 'text' as const, text: JSON.stringify(summary) },
    ],
  }
}

const targetProject = async (target: McutMcpTarget): Promise<Project> => parseProject(await target.getProject())

const savedLayoutArgs = z.object({ layout: z.object({ id: z.string() }) })
