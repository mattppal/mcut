/**
 * Project format versioning.
 *
 * The serialized project JSON is mcut's public contract: projects persisted
 * by older releases must keep loading forever. Every breaking change to
 * {@link import('./model').projectSchema} bumps {@link PROJECT_VERSION} and
 * adds one entry to {@link MIGRATIONS}; `parseProject` runs the chain before
 * validating. (Kdenlive's DocumentValidator pattern: sequential upgrades,
 * refuse documents from the future.)
 *
 * Purely additive optional fields do NOT need a version bump — older
 * documents already satisfy the new schema.
 */

/** Version written into newly created/serialized projects. */
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

/**
 * `MIGRATIONS[n]` upgrades a version-`n` document to version `n + 1`.
 * Migrations receive and return plain JSON; the result is schema-validated
 * once the chain reaches {@link PROJECT_VERSION}.
 */
const MIGRATIONS: Record<number, (doc: ProjectDoc) => ProjectDoc> = {
  // 1: (doc) => ({ ...doc, /* upgrade to v2 */ }),
}

/**
 * Upgrade a persisted project document to {@link PROJECT_VERSION}.
 * Documents without a `version` field predate versioning and are treated as
 * version 1 (the shapes are identical). Throws {@link ProjectFormatError}
 * for documents written by a newer mcut.
 */
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
    throw new ProjectFormatError(
      'newer-version',
      `project was saved by a newer mcut (format v${version}; this build reads up to v${PROJECT_VERSION})`,
    )
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
