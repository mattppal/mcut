import { getElementType } from './element-registry'
import { animatableProperties, getKeyframes } from './keyframes'
import type { Project, TimelineElement } from './model'
import { getProjectDurationMs } from './selectors'

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`

function describeElement(project: Project, element: TimelineElement): string {
  const range = `${seconds(element.startMs)}–${seconds(element.startMs + element.durationMs)}`
  // Each element type describes itself (registry hook); fallback = its name.
  const what =
    getElementType(element.type)?.describe?.(element as Record<string, unknown>, project) ??
    element.type
  const armed = animatableProperties(element)
    .map((property) => {
      const track = getKeyframes(element, property)
      return track.length > 0 ? `${property}×${track.length}` : null
    })
    .filter(Boolean)
  let suffix = armed.length > 0 ? ` [keyframed: ${armed.join(', ')}]` : ''
  if ('effects' in element && element.effects && element.effects.length > 0) {
    suffix += ` [effects: ${element.effects.map((e) => e.type).join(', ')}]`
  }
  if ('blendMode' in element && element.blendMode) {
    suffix += ` [blend: ${element.blendMode}]`
  }
  if ('transition' in element && element.transition) {
    suffix += ` [→ ${element.transition.type} ${element.transition.durationMs}ms]`
  }
  const fadeIn = 'fadeInMs' in element ? (element.fadeInMs ?? 0) : 0
  const fadeOut = 'fadeOutMs' in element ? (element.fadeOutMs ?? 0) : 0
  if (fadeIn > 0 || fadeOut > 0) {
    const fades = [fadeIn > 0 && `in ${seconds(fadeIn)}`, fadeOut > 0 && `out ${seconds(fadeOut)}`]
      .filter(Boolean)
      .join(', ')
    suffix += ` [fade: ${fades}]`
  }
  return `${element.id} ${what} @ ${range}${suffix}`
}

/**
 * A compact, deterministic textual rendering of the project in editor
 * vocabulary — what an agent reads before dispatching commands. Tracks are
 * listed top-most first (render order reversed), like a timeline reads.
 */
export function summarizeProject(project: Project): string {
  const lines: string[] = [
    `Project "${project.name}" ${project.width}×${project.height} @ ${project.fps}fps, ` +
      `duration ${seconds(getProjectDurationMs(project))}`,
  ]
  for (let i = project.tracks.length - 1; i >= 0; i--) {
    const track = project.tracks[i]!
    const flags = [track.muted && 'muted', track.hidden && 'hidden', track.locked && 'locked']
      .filter(Boolean)
      .join(', ')
    lines.push(`Track "${track.name}"${flags ? ` (${flags})` : ''}:`)
    if (track.elements.length === 0) lines.push('  (empty)')
    for (const element of track.elements) {
      lines.push(`  ${describeElement(project, element)}`)
    }
  }
  const assets = Object.values(project.assets)
  if (assets.length > 0) {
    lines.push(
      `Assets: ${assets
        .map((a) => `${a.id} ${a.kind} "${a.name ?? ''}"${a.durationMs ? ` ${seconds(a.durationMs)}` : ''}`)
        .join('; ')}`,
    )
  }
  if (project.markers.length > 0) {
    lines.push(
      `Markers: ${project.markers
        .map((m) => `${m.id} @ ${seconds(m.timeMs)}${m.label ? ` "${m.label}"` : ''}`)
        .join('; ')}`,
    )
  }
  return lines.join('\n')
}
