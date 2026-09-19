import { parseProject, type Project } from '../model'
import { rangesOverlap } from '../placement'
import { isRecord } from './json-schema-gen'

export interface Violation {
  invariant: string
  detail: string
}

type Check = (project: Project) => string[]

const invariants: Record<string, Check> = {
  'no-overlap': noOverlap,
  sorted: sortedByStart,
  'integer-ms': integerMs,
  'namespaced-ids': namespacedIds,
  'unique-ids': uniqueIds,
  'round-trip': roundTrip,
}

export function checkProjectInvariants(project: Project): Violation[] {
  const violations: Violation[] = []
  for (const [invariant, check] of Object.entries(invariants)) {
    for (const detail of check(project)) violations.push({ invariant, detail })
  }
  return violations
}

function noOverlap(project: Project): string[] {
  const details: string[] = []
  project.tracks.forEach((track, t) => {
    if (track.magnetic) return
    track.elements.forEach((a, i) => {
      for (const b of track.elements.slice(i + 1)) {
        if (rangesOverlap(a.startMs, a.durationMs, b.startMs, b.durationMs)) {
          details.push(
            `tracks[${t}] "${a.id}" [${a.startMs}, ${a.startMs + a.durationMs}) overlaps ` +
              `"${b.id}" [${b.startMs}, ${b.startMs + b.durationMs})`,
          )
        }
      }
    })
  })
  return details
}

function sortedByStart(project: Project): string[] {
  const details: string[] = []
  project.tracks.forEach((track, t) => {
    track.elements.forEach((element, e) => {
      const previous = track.elements[e - 1]
      if (previous && previous.startMs > element.startMs) {
        details.push(
          `tracks[${t}].elements[${e}] "${element.id}" starts at ${element.startMs} ` +
            `before "${previous.id}" at ${previous.startMs}`,
        )
      }
    })
  })
  return details
}

function withoutOpaquePresetValues(project: Project): unknown {
  return { ...project, presets: project.presets.map(({ id, name, kind }) => ({ id, name, kind })) }
}

function integerMs(project: Project): string[] {
  const details: string[] = []
  walk(withoutOpaquePresetValues(project), 'project', (path, key, value) => {
    if (key.endsWith('Ms') && !Number.isInteger(value)) details.push(`${path} = ${show(value)}`)
  })
  return details
}

function walk(value: unknown, path: string, visit: (path: string, key: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, visit))
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) {
    visit(`${path}.${key}`, key, child)
    walk(child, `${path}.${key}`, visit)
  }
}

function namespacedIds(project: Project): string[] {
  const details: string[] = []
  project.tracks.forEach((track, t) => {
    if (!/^t-/.test(track.id)) details.push(`tracks[${t}].id "${track.id}"`)
    track.elements.forEach((element, e) => {
      if (!/^e-/.test(element.id)) details.push(`tracks[${t}].elements[${e}].id "${element.id}"`)
      if (element.groupId !== undefined && !/^g-/.test(element.groupId)) {
        details.push(`tracks[${t}].elements[${e}].groupId "${element.groupId}"`)
      }
    })
  })
  for (const [key, asset] of Object.entries(project.assets)) {
    if (!/^a-/.test(key) || asset.id !== key) details.push(`assets["${key}"].id "${asset.id}"`)
  }
  project.markers.forEach((marker, m) => {
    if (!/^m-/.test(marker.id)) details.push(`markers[${m}].id "${marker.id}"`)
  })
  return details
}

function uniqueIds(project: Project): string[] {
  const collections = [
    project.tracks.map((track, t) => ({ id: track.id, path: `tracks[${t}]` })),
    project.tracks.flatMap((track, t) =>
      track.elements.map((element, e) => ({ id: element.id, path: `tracks[${t}].elements[${e}]` })),
    ),
    project.markers.map((marker, m) => ({ id: marker.id, path: `markers[${m}]` })),
    project.layouts.map((layout, l) => ({ id: layout.id, path: `layouts[${l}]` })),
    project.presets.map((preset, p) => ({ id: preset.id, path: `presets[${p}]` })),
  ]
  return collections.flatMap(duplicates)
}

function duplicates(entries: Array<{ id: string; path: string }>): string[] {
  const first = new Map<string, string>()
  const details: string[] = []
  for (const { id, path } of entries) {
    const earlier = first.get(id)
    if (earlier === undefined) first.set(id, path)
    else details.push(`${path} reuses id "${id}" of ${earlier}`)
  }
  return details
}

function roundTrip(project: Project): string[] {
  const document: unknown = JSON.parse(JSON.stringify(project))
  let parsed: Project
  try {
    parsed = parseProject(document)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [`parseProject rejected the serialized project with ${message.slice(0, 300)}`]
  }
  if (Bun.deepEquals(parsed, document, true)) return []
  return [firstDifference(document, parsed, 'project') ?? 'saved document and re-parsed project differ']
}

function firstDifference(saved: unknown, parsed: unknown, path: string): string | undefined {
  if (Bun.deepEquals(saved, parsed, true)) return undefined
  const mismatch = `at ${path} saved ${show(saved)} parsed back as ${show(parsed)}`
  if (Array.isArray(saved) && Array.isArray(parsed)) {
    for (let i = 0; i < Math.max(saved.length, parsed.length); i++) {
      const difference = firstDifference(saved[i], parsed[i], `${path}[${i}]`)
      if (difference !== undefined) return difference
    }
    return mismatch
  }
  if (isRecord(saved) && isRecord(parsed)) {
    for (const key of new Set([...Object.keys(saved), ...Object.keys(parsed)])) {
      const difference = firstDifference(saved[key], parsed[key], `${path}.${key}`)
      if (difference !== undefined) return difference
    }
  }
  return mismatch
}

function show(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value)
}
