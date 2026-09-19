const NAMED: Record<string, [number, number, number, number]> = {
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
  red: [1, 0, 0, 1],
  green: [0, 128 / 255, 0, 1],
  blue: [0, 0, 1, 1],
  gray: [128 / 255, 128 / 255, 128 / 255, 1],
  grey: [128 / 255, 128 / 255, 128 / 255, 1],
  transparent: [0, 0, 0, 0],
}

function hexChannels(hex: string, width: 1 | 2): [number, number, number, number] | null {
  const count = hex.length / width
  if (count !== 3 && count !== 4) return null
  const channelAt = (index: number): number => {
    const digits = hex.slice(index * width, (index + 1) * width)
    return Number.parseInt(width === 1 ? digits + digits : digits, 16) / 255
  }
  const channels: [number, number, number, number] = [channelAt(0), channelAt(1), channelAt(2), count === 4 ? channelAt(3) : 1]
  return channels.every((p) => Number.isFinite(p)) ? channels : null
}

export function parseCssColor(input: string): [number, number, number, number] {
  const value = input.trim().toLowerCase()
  const named = NAMED[value]
  if (named) return [...named]

  if (value.startsWith('#')) {
    const hex = value.slice(1)
    const channels = hexChannels(hex, 1) ?? hexChannels(hex, 2)
    if (channels) return channels
  }

  const inner = value.match(/^rgba?\(([^)]+)\)$/)?.[1]
  if (inner !== undefined) {
    const [rawR, rawG, rawB, rawA] = inner.split(/[\s,/]+/).filter(Boolean)
    if (rawR !== undefined && rawG !== undefined && rawB !== undefined) {
      const channel = (raw: string): number => (raw.endsWith('%') ? (Number.parseFloat(raw) / 100) * 255 : Number.parseFloat(raw))
      const r = channel(rawR)
      const g = channel(rawG)
      const b = channel(rawB)
      const a = rawA === undefined ? 1 : rawA.endsWith('%') ? Number.parseFloat(rawA) / 100 : Number.parseFloat(rawA)
      if ([r, g, b, a].every((p) => Number.isFinite(p))) {
        return [Math.min(1, Math.max(0, r / 255)), Math.min(1, Math.max(0, g / 255)), Math.min(1, Math.max(0, b / 255)), Math.min(1, Math.max(0, a))]
      }
    }
  }

  return [0, 0, 0, 1]
}
