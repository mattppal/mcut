import { assertNever } from './errors'
import { animatableProperties, getKeyframes } from './keyframes'
import type { AudioElement, ImageElement, MulticamElement, Project, TimelineElement, VideoElement } from './model'
import { getProjectDurationMs } from './selectors'
import { getAverageSpeed } from './speed'

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`

function describeAssetClip(project: Project, element: VideoElement | AudioElement | ImageElement): string {
  const asset = project.assets[element.assetId]
  let what = `${element.type} ${asset?.name ?? element.assetId}`
  if ('trimStartMs' in element && element.trimStartMs > 0) {
    what += ` (trim-in ${seconds(element.trimStartMs)})`
  }
  if ('timeMap' in element && element.timeMap) {
    const speed = getAverageSpeed(element)
    what += element.timeMap.length > 2 ? ` (speed ramp, avg ${speed.toFixed(2)}x)` : ` (speed ${speed.toFixed(2)}x)`
  }
  if ('reversed' in element && element.reversed) what += ' (reversed)'
  return what
}

function describeMulticam(project: Project, element: MulticamElement): string {
  const cuts = element.angles
    .map((a) => {
      const layout = project.layouts.find((l) => l.id === a.layoutId)
      return `${seconds(a.atMs)}→${layout?.name ?? a.layoutId}`
    })
    .join(', ')
  return `multicam [${element.sources.map((src) => src.key).join(' + ')}]` + ` cuts: ${cuts}` + (element.audioSource ? ` (audio: ${element.audioSource})` : '')
}

function describeContent(project: Project, element: TimelineElement): string {
  switch (element.type) {
    case 'video':
    case 'audio':
    case 'image':
      return describeAssetClip(project, element)
    case 'text':
      return `text "${element.text.slice(0, 40)}"`
    case 'caption':
      return `caption "${element.text.slice(0, 40)}"`
    case 'multicam':
      return describeMulticam(project, element)
    default:
      return assertNever(element)
  }
}

function describeElement(project: Project, element: TimelineElement): string {
  const range = `${seconds(element.startMs)}–${seconds(element.startMs + element.durationMs)}`
  const what = describeContent(project, element)
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
    const fades = [fadeIn > 0 && `in ${seconds(fadeIn)}`, fadeOut > 0 && `out ${seconds(fadeOut)}`].filter(Boolean).join(', ')
    suffix += ` [fade: ${fades}]`
  }
  return `${element.id} ${what} @ ${range}${suffix}`
}

export function summarizeProject(project: Project): string {
  const lines: string[] = [
    `Project "${project.name}" ${project.width}×${project.height} @ ${project.fps}fps, ` + `duration ${seconds(getProjectDurationMs(project))}`,
  ]
  for (let i = project.tracks.length - 1; i >= 0; i--) {
    const track = project.tracks[i]!
    const flags = [track.muted && 'muted', track.hidden && 'hidden', track.locked && 'locked'].filter(Boolean).join(', ')
    lines.push(`Track "${track.name}"${flags ? ` (${flags})` : ''}:`)
    if (track.elements.length === 0) lines.push('  (empty)')
    for (const element of track.elements) {
      lines.push(`  ${describeElement(project, element)}`)
    }
  }
  const assets = Object.values(project.assets)
  if (assets.length > 0) {
    lines.push(`Assets: ${assets.map((a) => `${a.id} ${a.kind} "${a.name ?? ''}"${a.durationMs ? ` ${seconds(a.durationMs)}` : ''}`).join('; ')}`)
  }
  if (project.markers.length > 0) {
    lines.push(`Markers: ${project.markers.map((m) => `${m.id} @ ${seconds(m.timeMs)}${m.label ? ` "${m.label}"` : ''}`).join('; ')}`)
  }
  return lines.join('\n')
}
