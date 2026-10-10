import { listZoomRegions, type Project, type ZoomRegionRef } from '@mcut/timeline'

const CLOCKED_COMMANDS: ReadonlySet<string> = new Set(['addAngleCut', 'moveAngleCut', 'removeAngleCut', 'setAngleLayout', 'addZoomRegion', 'updateZoomRegion'])

export function onTimelineClock<T extends object>(commandName: string, input: T): T {
  if (!CLOCKED_COMMANDS.has(commandName) || ('time' in input && input.time !== undefined)) return input
  return { ...input, time: 'timeline' }
}

export const commandsOnTimelineClock = <T extends { type: string }>(commands: readonly T[]): T[] =>
  commands.map((command) => onTimelineClock(command.type, command))

export function zoomsOnTimelineClock(project: Project): ZoomRegionRef[] {
  const elementStartMs = new Map<string, number>(project.tracks.flatMap((track) => track.elements.map((element) => [element.id, element.startMs] as const)))
  return listZoomRegions(project).map((zoom) => ({ ...zoom, atMs: (elementStartMs.get(zoom.elementId) ?? 0) + zoom.atMs }))
}
