import { assertNever } from './errors'
import { getLayout } from './layouts'
import type { MulticamElement, Project, TimelineElement } from './model'
import { getActiveLayout, getAngleTransitionAt, getMulticamSourceTimeMs } from './multicam'
import { getSourceTimeMs } from './speed'

export interface FrameRequest {
  assetId: string
  sourceTimeMs: number
}

function multicamFrameRequests(
  project: Project,
  element: MulticamElement,
  timelineMs: number,
): FrameRequest[] {
  const window = getAngleTransitionAt(element, timelineMs - element.startMs)
  const layouts = window
    ? [getLayout(project.layouts, window.fromLayoutId), getLayout(project.layouts, window.toLayoutId)]
    : [getActiveLayout(project, element, timelineMs)]
  const requests: FrameRequest[] = []
  const seen = new Set<string>()
  for (const layout of layouts) {
    for (const slot of layout?.slots ?? []) {
      const source = element.sources.find((s) => s.key === slot.source)
      if (!source || seen.has(source.key)) continue
      seen.add(source.key)
      requests.push({
        assetId: source.assetId,
        sourceTimeMs: getMulticamSourceTimeMs(element, source, timelineMs),
      })
    }
  }
  return requests
}

export function getFrameRequests(
  project: Project,
  element: TimelineElement,
  timelineMs: number,
): FrameRequest[] {
  switch (element.type) {
    case 'video':
      return [
        {
          assetId: element.assetId,
          sourceTimeMs: Math.max(0, getSourceTimeMs(element, timelineMs - element.startMs)),
        },
      ]
    case 'image':
      return [{ assetId: element.assetId, sourceTimeMs: 0 }]
    case 'multicam':
      return multicamFrameRequests(project, element, timelineMs)
    case 'audio':
    case 'text':
    case 'caption':
      return []
    default:
      return assertNever(element)
  }
}
