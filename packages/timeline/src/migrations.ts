export const PROJECT_VERSION = 1

export class ProjectFormatError extends Error {
  readonly code: 'newer-version' | 'missing-migration' | 'invalid-document'

  constructor(code: ProjectFormatError['code'], message: string) {
    super(message)
    this.name = 'ProjectFormatError'
    this.code = code
  }
}

type ProjectDoc = Record<string, unknown>

const MIGRATIONS: Record<number, (doc: ProjectDoc) => ProjectDoc> = {}

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
