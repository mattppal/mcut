import { assertNever } from './errors'
import { animatableProperties, getKeyframes } from './keyframes'
import { summarizeLayouts } from './layout-summary'
import { isMediaClip, type MediaClip } from './media-clip'
import type { AudioElement, ImageElement, MulticamElement, Project, TimelineElement, VideoElement } from './model'
import { getVisibleAngleCuts } from './multicam'
import { getProjectDurationMs } from './selectors'
import { getAverageSpeed } from './speed'

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`

function describeAsset(project: Project, element: VideoElement | AudioElement | ImageElement): string {
  return `${element.type} ${project.assets[element.assetId]?.name ?? element.assetId}`
}

function describeWindow(clip: MediaClip): string {
  let what = clip.trimStartMs > 0 ? ` (trim-in ${seconds(clip.trimStartMs)})` : ''
  if (clip.timeMap) {
    const speed = getAverageSpeed(clip)
    what += clip.timeMap.length > 2 ? ` (speed ramp, avg ${speed.toFixed(2)}x)` : ` (speed ${speed.toFixed(2)}x)`
  }
  if (clip.reversed) what += ' (reversed)'
  return what
}

function describeFades(clip: MediaClip): string {
  const fadeIn = clip.fadeInMs ?? 0
  const fadeOut = clip.fadeOutMs ?? 0
  if (fadeIn === 0 && fadeOut === 0) return ''
  const fades = [fadeIn > 0 && `in ${seconds(fadeIn)}`, fadeOut > 0 && `out ${seconds(fadeOut)}`].filter(Boolean).join(', ')
  return ` [fade: ${fades}]`
}

function describeMulticam(project: Project, element: MulticamElement): string {
  const cuts = getVisibleAngleCuts(element)
    .map((cut) => `${seconds(cut.localMs)}→${project.layouts.find((l) => l.id === cut.layoutId)?.name ?? cut.layoutId}`)
    .join(', ')
  const keys = element.sources.map((src) => src.key).join(' + ')
  return `multicam [${keys}]${describeWindow(element)} cuts: ${cuts}` + (element.audioSource ? ` (audio: ${element.audioSource})` : '')
}

function describeContent(project: Project, element: TimelineElement): string {
  switch (element.type) {
    case 'video':
    case 'audio':
      return describeAsset(project, element) + describeWindow(element)
    case 'image':
      return describeAsset(project, element)
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
  if ('zooms' in element && element.zooms && element.zooms.length > 0) {
    const zooms = element.zooms.map((z) => `${z.id}${z.source ? ` ${z.source}` : ''} ${z.scale}x @ ${seconds(element.startMs + z.atMs)}`)
    suffix += ` [zooms: ${zooms.join(', ')}]`
  }
  if (isMediaClip(element)) suffix += describeFades(element)
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
  lines.push(...summarizeLayouts(project))
  const assets = Object.values(project.assets)
  if (assets.length > 0) {
    lines.push(`Assets: ${assets.map((a) => `${a.id} ${a.kind} "${a.name ?? ''}"${a.durationMs ? ` ${seconds(a.durationMs)}` : ''}`).join('; ')}`)
  }
  if (project.markers.length > 0) {
    lines.push(`Markers: ${project.markers.map((m) => `${m.id} @ ${seconds(m.timeMs)}${m.label ? ` "${m.label}"` : ''}`).join('; ')}`)
  }
  return lines.join('\n')
}
