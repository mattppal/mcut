interface ShadowState {
  color: string
  blur: number
  offsetX: number
  offsetY: number
}

export interface RecordedCall {
  method: string
  args: unknown[]
  fillStyle: unknown
  globalAlpha: number
  filter: string
  globalCompositeOperation: string
  shadow: ShadowState
}

const NO_SHADOW: ShadowState = { color: 'rgba(0, 0, 0, 0)', blur: 0, offsetX: 0, offsetY: 0 }

export class FakeContext2D {
  calls: RecordedCall[] = []
  readonly canvas: { width: number; height: number }
  fillStyle: unknown = '#000'
  strokeStyle: unknown = '#000'
  font = ''
  textAlign = 'left'
  textBaseline = 'alphabetic'
  globalAlpha = 1
  filter = 'none'
  globalCompositeOperation = 'source-over'
  shadowColor = NO_SHADOW.color
  shadowBlur = NO_SHADOW.blur
  shadowOffsetX = NO_SHADOW.offsetX
  shadowOffsetY = NO_SHADOW.offsetY

  constructor(width = 1920, height = 1080) {
    this.canvas = { width, height }
  }

  private get shadow(): ShadowState {
    return { color: this.shadowColor, blur: this.shadowBlur, offsetX: this.shadowOffsetX, offsetY: this.shadowOffsetY }
  }

  private set shadow(state: ShadowState) {
    this.shadowColor = state.color
    this.shadowBlur = state.blur
    this.shadowOffsetX = state.offsetX
    this.shadowOffsetY = state.offsetY
  }

  private record(method: string, args: unknown[]): void {
    this.calls.push({
      method,
      args,
      fillStyle: this.fillStyle,
      globalAlpha: this.globalAlpha,
      filter: this.filter,
      globalCompositeOperation: this.globalCompositeOperation,
      shadow: this.shadow,
    })
  }

  private stateStack: Array<{ alpha: number; filter: string; composite: string; shadow: ShadowState }> = []
  save(): void {
    this.stateStack.push({
      alpha: this.globalAlpha,
      filter: this.filter,
      composite: this.globalCompositeOperation,
      shadow: this.shadow,
    })
    this.record('save', [])
  }
  restore(): void {
    const state = this.stateStack.pop()
    this.globalAlpha = state?.alpha ?? 1
    this.filter = state?.filter ?? 'none'
    this.globalCompositeOperation = state?.composite ?? 'source-over'
    this.shadow = state?.shadow ?? NO_SHADOW
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
    return { width: text.length * 10 }
  }

  callsTo(method: string): RecordedCall[] {
    return this.calls.filter((c) => c.method === method)
  }
}
