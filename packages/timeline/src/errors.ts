/**
 * Engine error for rejected edits: unknown ids, invalid payloads, violated
 * invariants. Lives outside commands.ts so element-type definitions
 * (model.ts) can throw it from their validate hooks without a cycle.
 */
export class CommandError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'CommandError'
    this.code = code
  }
}

export function assertNever(value: never): never {
  throw new Error(`unreachable: ${String(value)}`)
}
