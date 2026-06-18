/**
 * Tiny parser for Google Fonts css2 responses: each `@font-face` block
 * becomes one face descriptor the export worker can register (workers can't
 * see `document.fonts`, so faces are re-created from their source URLs).
 */

export interface ParsedFontFace {
  /** font-weight descriptor: "400" or a variable range like "100 900". */
  weight?: string;
  /** font-style descriptor: "normal" | "italic" | oblique range. */
  style?: string;
  /** unicode-range descriptor (css2 ships one face per script subset). */
  unicodeRange?: string;
  url: string;
}

export function parseGoogleFontCss(css: string): ParsedFontFace[] {
  const faces: ParsedFontFace[] = [];
  for (const block of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
    const url = /src:[^;}]*url\(([^)]+)\)/.exec(block)?.[1]?.replace(/^['"]|['"]$/g, "");
    if (!url) continue;
    const weight = /font-weight:\s*([^;}]+)/.exec(block)?.[1]?.trim();
    const style = /font-style:\s*([^;}]+)/.exec(block)?.[1]?.trim();
    const unicodeRange = /unicode-range:\s*([^;}]+)/.exec(block)?.[1]?.trim();
    faces.push({
      url,
      ...(weight ? { weight } : {}),
      ...(style ? { style } : {}),
      ...(unicodeRange ? { unicodeRange } : {}),
    });
  }
  return faces;
}

/** Does a font-weight descriptor ("400", "100 900") cover `wanted`? */
export function weightDescriptorMatches(descriptor: string | undefined, wanted: number): boolean {
  if (!descriptor) return true;
  const parts = descriptor.split(/\s+/).map(Number).filter(Number.isFinite);
  if (parts.length === 0) return true;
  const min = Math.min(...parts);
  const max = Math.max(...parts);
  return wanted >= min && wanted <= max;
}
