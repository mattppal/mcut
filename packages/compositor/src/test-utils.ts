/** Recording fake 2D context for tests (no real canvas in Bun). */
export interface RecordedCall {
  method: string
  args: unknown[]
  /** Snapshot of fillStyle at call time. */
  fillStyle: unknown
  globalAlpha: number
  /** Snapshot of the effect filter string at call time. */
  filter: string
  /** Snapshot of the blend mode at call time. */
  globalCompositeOperation: string
}

export class FakeContext2D {
  calls: RecordedCall[] = []
  /** Stand-in backing surface, so drawImage(fake.canvas, ...) is identifiable. */
  readonly canvas = { fake: true, owner: this }
  fillStyle: unknown = '#000'
  strokeStyle: unknown = '#000'
  font = ''
  textAlign = 'left'
  textBaseline = 'alphabetic'
  globalAlpha = 1
  filter = 'none'
  globalCompositeOperation = 'source-over'

  private record(method: string, args: unknown[]): void {
    this.calls.push({
      method,
      args,
      fillStyle: this.fillStyle,
      globalAlpha: this.globalAlpha,
      filter: this.filter,
      globalCompositeOperation: this.globalCompositeOperation,
    })
  }

  private stateStack: Array<{ alpha: number; filter: string; composite: string }> = []
  save(): void {
    this.stateStack.push({
      alpha: this.globalAlpha,
      filter: this.filter,
      composite: this.globalCompositeOperation,
    })
    this.record('save', [])
  }
  restore(): void {
    const state = this.stateStack.pop()
    this.globalAlpha = state?.alpha ?? 1
    this.filter = state?.filter ?? 'none'
    this.globalCompositeOperation = state?.composite ?? 'source-over'
    this.record('restore', [])
  }
  translate(...args: unknown[]): void {
    this.record('translate', args)
  }
  rotate(...args: unknown[]): void {
    this.record('rotate', args)
  }
  scale(...args: unknown[]): void {
    this.record('scale', args)
  }
  fillRect(...args: unknown[]): void {
    this.record('fillRect', args)
  }
  clearRect(...args: unknown[]): void {
    this.record('clearRect', args)
  }
  fillText(...args: unknown[]): void {
    this.record('fillText', args)
  }
  drawImage(...args: unknown[]): void {
    this.record('drawImage', args)
  }
  beginPath(): void {
    this.record('beginPath', [])
  }
  rect(...args: unknown[]): void {
    this.record('rect', args)
  }
  clip(...args: unknown[]): void {
    this.record('clip', args)
  }
  roundRect(...args: unknown[]): void {
    this.record('roundRect', args)
  }
  fill(): void {
    this.record('fill', [])
  }
  stroke(): void {
    this.record('stroke', [])
  }
  measureText(text: string): { width: number } {
    // Deterministic: 10px per character regardless of font.
    return { width: text.length * 10 }
  }

  callsTo(method: string): RecordedCall[] {
    return this.calls.filter((c) => c.method === method)
  }
}
