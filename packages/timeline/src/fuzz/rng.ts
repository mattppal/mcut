export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  int(min: number, max: number): number {
    const span = Math.max(0, Math.floor(max) - Math.ceil(min))
    return Math.ceil(min) + Math.floor(this.next() * (span + 1))
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length - 1)]
    if (item === undefined) throw new Error('pick from an empty list')
    return item
  }

  chance(probability: number): boolean {
    return this.next() < probability
  }
}
