/** Minimal CSS color → linear-ish RGBA for GPU clear values (0..1, straight). */

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

/**
 * Parse the CSS colors the compositor actually meets (#hex, rgb()/rgba(),
 * a few names). Unknown input falls back to opaque black — the same color
 * the canvas2d path would effectively paint for an invalid background.
 */
export function parseCssColor(input: string): [number, number, number, number] {
  const value = input.trim().toLowerCase()
  const named = NAMED[value]
  if (named) return [...named]

  if (value.startsWith('#')) {
    const hex = value.slice(1)
    if (hex.length === 3 || hex.length === 4) {
      const parts = [...hex].map((c) => Number.parseInt(c + c, 16))
      if (parts.every((p) => Number.isFinite(p))) {
        return [parts[0]! / 255, parts[1]! / 255, parts[2]! / 255, hex.length === 4 ? parts[3]! / 255 : 1]
      }
    }
    if (hex.length === 6 || hex.length === 8) {
      const parts = [0, 2, 4, 6]
        .slice(0, hex.length / 2)
        .map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
      if (parts.every((p) => Number.isFinite(p))) {
        return [parts[0]! / 255, parts[1]! / 255, parts[2]! / 255, hex.length === 8 ? parts[3]! / 255 : 1]
      }
    }
  }

  const fn = value.match(/^rgba?\(([^)]+)\)$/)
  if (fn) {
    const parts = fn[1]!.split(/[\s,/]+/).filter(Boolean)
    if (parts.length >= 3) {
      const channel = (raw: string): number =>
        raw.endsWith('%') ? (Number.parseFloat(raw) / 100) * 255 : Number.parseFloat(raw)
      const r = channel(parts[0]!)
      const g = channel(parts[1]!)
      const b = channel(parts[2]!)
      const rawA = parts[3]
      const a = rawA === undefined ? 1 : rawA.endsWith('%') ? Number.parseFloat(rawA) / 100 : Number.parseFloat(rawA)
      if ([r, g, b, a].every((p) => Number.isFinite(p))) {
        return [
          Math.min(1, Math.max(0, r / 255)),
          Math.min(1, Math.max(0, g / 255)),
          Math.min(1, Math.max(0, b / 255)),
          Math.min(1, Math.max(0, a)),
        ]
      }
    }
  }

  return [0, 0, 0, 1]
}
