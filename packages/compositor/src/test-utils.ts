interface ShadowState {
  color: string
  blur: number
  offsetX: number
  offsetY: number
}

interface Matrix2D {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export interface RecordedCall {
  method: string
  args: unknown[]
  fillStyle: unknown
  globalAlpha: number
  filter: string
  globalCompositeOperation: string
  shadow: ShadowState
  transform: Matrix2D
}

const NO_SHADOW: ShadowState = { color: 'rgba(0, 0, 0, 0)', blur: 0, offsetX: 0, offsetY: 0 }
const IDENTITY: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

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
  private matrix = IDENTITY

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
      transform: this.matrix,
    })
  }

  private multiply(m: Matrix2D): void {
    const t = this.matrix
    this.matrix = {
      a: t.a * m.a + t.c * m.b,
      b: t.b * m.a + t.d * m.b,
      c: t.a * m.c + t.c * m.d,
      d: t.b * m.c + t.d * m.d,
      e: t.a * m.e + t.c * m.f + t.e,
      f: t.b * m.e + t.d * m.f + t.f,
    }
  }

  private stateStack: Array<{ alpha: number; filter: string; composite: string; shadow: ShadowState; matrix: Matrix2D }> = []
  save(): void {
    this.stateStack.push({
      alpha: this.globalAlpha,
      filter: this.filter,
      composite: this.globalCompositeOperation,
      shadow: this.shadow,
      matrix: this.matrix,
    })
    this.record('save', [])
  }
  restore(): void {
    const state = this.stateStack.pop()
    this.globalAlpha = state?.alpha ?? 1
    this.filter = state?.filter ?? 'none'
    this.globalCompositeOperation = state?.composite ?? 'source-over'
    this.shadow = state?.shadow ?? NO_SHADOW
    this.matrix = state?.matrix ?? IDENTITY
    this.record('restore', [])
  }
  translate(x: number, y: number): void {
    this.multiply({ a: 1, b: 0, c: 0, d: 1, e: x, f: y })
    this.record('translate', [x, y])
  }
  rotate(angle: number): void {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    this.multiply({ a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 })
    this.record('rotate', [angle])
  }
  scale(x: number, y: number): void {
    this.multiply({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 })
    this.record('scale', [x, y])
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.matrix = { a, b, c, d, e, f }
    this.record('setTransform', [a, b, c, d, e, f])
  }
  getTransform(): Matrix2D {
    return this.matrix
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

export function deviceRect({ args, transform: { a, b, c, d, e, f } }: Pick<RecordedCall, 'args' | 'transform'>): number[] {
  const [x = 0, y = 0, w = 0, h = 0] = args.slice(-4).map(Number)
  const at = (px: number, py: number) => ({ x: a * px + c * py + e, y: b * px + d * py + f })
  const from = at(x, y)
  const to = at(x + w, y + h)
  return [from.x, from.y, to.x - from.x, to.y - from.y]
}

export function onCanvas(main: FakeContext2D, scratch: FakeContext2D, method: string): number[][] {
  const frames = main.callsTo('drawImage').filter(({ args }) => args[0] === scratch.canvas)
  return frames.flatMap(({ args, transform }) => {
    const [sx = 0, sy = 0, sw = 1, sh = 1, dx = 0, dy = 0, dw = 0, dh = 0] = args.slice(1).map(Number)
    return scratch.callsTo(method).map((call) => {
      const [x = 0, y = 0, w = 0, h = 0] = deviceRect(call)
      return deviceRect({ transform, args: [dx + ((x - sx) * dw) / sw, dy + ((y - sy) * dh) / sh, (w * dw) / sw, (h * dh) / sh] })
    })
  })
}
