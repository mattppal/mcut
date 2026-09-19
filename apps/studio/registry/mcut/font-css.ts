export interface ParsedFontFace {
  weight?: string
  style?: string
  unicodeRange?: string
  url: string
}

export function parseGoogleFontCss(css: string): ParsedFontFace[] {
  const faces: ParsedFontFace[] = []
  for (const block of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
    const url = /src:[^;}]*url\(([^)]+)\)/.exec(block)?.[1]?.replace(/^['"]|['"]$/g, '')
    if (!url) continue
    const weight = /font-weight:\s*([^;}]+)/.exec(block)?.[1]?.trim()
    const style = /font-style:\s*([^;}]+)/.exec(block)?.[1]?.trim()
    const unicodeRange = /unicode-range:\s*([^;}]+)/.exec(block)?.[1]?.trim()
    faces.push({
      url,
      ...(weight ? { weight } : {}),
      ...(style ? { style } : {}),
      ...(unicodeRange ? { unicodeRange } : {}),
    })
  }
  return faces
}

export function weightDescriptorMatches(descriptor: string | undefined, wanted: number): boolean {
  if (!descriptor) return true
  const parts = descriptor.split(/\s+/).map(Number).filter(Number.isFinite)
  if (parts.length === 0) return true
  const min = Math.min(...parts)
  const max = Math.max(...parts)
  return wanted >= min && wanted <= max
}
