export class LiveBridgeError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'LiveBridgeError'
    this.code = code
  }
}
