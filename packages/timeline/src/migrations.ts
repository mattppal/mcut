import { z } from 'zod'
import { interpolateTrack, keyframeSchema } from './keyframes'

export const PROJECT_VERSION = 2

export class ProjectFormatError extends Error {
  readonly code: 'newer-version' | 'missing-migration' | 'invalid-document'

  constructor(code: ProjectFormatError['code'], message: string) {
    super(message)
    this.name = 'ProjectFormatError'
    this.code = code
  }
}

type ProjectDoc = Record<string, unknown>

const v1TracksSchema = z.array(z.looseObject({ elements: z.array(z.unknown()) }))

const v1MulticamSchema = z.looseObject({
  type: z.literal('multicam'),
  sources: z.array(z.looseObject({ trimStartMs: z.number().default(0) })).min(1),
  angles: z.array(z.looseObject({ atMs: z.number() })),
  timeMap: z.array(keyframeSchema).min(2).optional(),
})

function multicamOnGroupClock(element: unknown): unknown {
  const parsed = v1MulticamSchema.safeParse(element)
  if (!parsed.success) return element
  const { sources, angles, timeMap } = parsed.data
  const groupStartMs = Math.min(...sources.map((source) => source.trimStartMs))
  const cuts = angles.map((angle) => ({
    ...angle,
    atMs: Math.round(groupStartMs + (timeMap ? interpolateTrack(timeMap, angle.atMs) : angle.atMs)),
  }))
  return {
    ...parsed.data,
    trimStartMs: groupStartMs,
    sources: sources.map(({ trimStartMs, ...source }) => ({ ...source, offsetMs: trimStartMs - groupStartMs })),
    angles: cuts.filter((cut, i) => cuts[i + 1]?.atMs !== cut.atMs),
  }
}

const MIGRATIONS: Record<number, (doc: ProjectDoc) => ProjectDoc> = {
  1: (doc) => {
    const tracks = v1TracksSchema.safeParse(doc.tracks)
    if (!tracks.success) return doc
    return { ...doc, tracks: tracks.data.map((track) => ({ ...track, elements: track.elements.map(multicamOnGroupClock) })) }
  },
}

export function migrateProject(data: unknown): unknown {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ProjectFormatError('invalid-document', 'project document must be a JSON object')
  }
  let doc: ProjectDoc = { ...(data as ProjectDoc) }
  const declared = doc.version
  if (declared !== undefined && (typeof declared !== 'number' || !Number.isInteger(declared) || declared < 1)) {
    throw new ProjectFormatError('invalid-document', `invalid project version ${JSON.stringify(declared)}`)
  }
  let version = (declared as number | undefined) ?? 1
  if (version > PROJECT_VERSION) {
    throw new ProjectFormatError('newer-version', `project was saved by a newer mcut (format v${version}; this build reads up to v${PROJECT_VERSION})`)
  }
  while (version < PROJECT_VERSION) {
    const migrate = MIGRATIONS[version]
    if (!migrate) {
      throw new ProjectFormatError('missing-migration', `no migration from project format v${version}`)
    }
    doc = migrate(doc)
    version += 1
  }
  return { ...doc, version }
}
