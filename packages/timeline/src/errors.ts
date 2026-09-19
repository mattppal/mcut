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
