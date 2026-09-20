import type { EmbedOmission } from '../registry/mcut/embed'
import type { Rect, SurfaceCapture } from './embed-parity-capture'

export type DifferenceKind = 'root' | 'tree' | 'layout' | 'style'

export interface Difference {
  kind: DifferenceKind
  detail: string
}

export interface ClassifiedDifference extends Difference {
  omission: EmbedOmission | null
}

const LAYOUT_TOLERANCE_PX = 1

function lineDiff(a: string[], b: string[]): { removed: string[]; added: string[] } {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const rowBelow = table[i + 1] ?? []
      const row = table[i] ?? []
      row[j] = a[i] === b[j] ? (rowBelow[j + 1] ?? 0) + 1 : Math.max(rowBelow[j] ?? 0, row[j + 1] ?? 0)
    }
  }
  const removed: string[] = []
  const added: string[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1
      j += 1
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      removed.push(a[i] ?? '')
      i += 1
    } else {
      added.push(b[j] ?? '')
      j += 1
    }
  }
  removed.push(...a.slice(i))
  added.push(...b.slice(j))
  return { removed, added }
}

function rectText(rect: Rect | null): string {
  return rect === null ? 'absent' : `${rect.x},${rect.y} ${rect.w}x${rect.h}`
}

function rectsMatch(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b
  return (
    Math.abs(a.x - b.x) <= LAYOUT_TOLERANCE_PX &&
    Math.abs(a.y - b.y) <= LAYOUT_TOLERANCE_PX &&
    Math.abs(a.w - b.w) <= LAYOUT_TOLERANCE_PX &&
    Math.abs(a.h - b.h) <= LAYOUT_TOLERANCE_PX
  )
}

export function diffCaptures(scope: string, desktop: SurfaceCapture, embed: SurfaceCapture): Difference[] {
  const differences: Difference[] = []
  for (const key of new Set([...Object.keys(desktop.root), ...Object.keys(embed.root)])) {
    if (desktop.root[key] !== embed.root[key]) {
      differences.push({
        kind: 'root',
        detail: `${scope}: html[${key}] desktop=${JSON.stringify(desktop.root[key] ?? '')} embed=${JSON.stringify(embed.root[key] ?? '')}`,
      })
    }
  }
  const { removed, added } = lineDiff(desktop.tree, embed.tree)
  for (const line of removed) differences.push({ kind: 'tree', detail: `${scope}: desktop only: ${line.trim()}` })
  for (const line of added) differences.push({ kind: 'tree', detail: `${scope}: embed only: ${line.trim()}` })
  for (const key of new Set([...Object.keys(desktop.regions), ...Object.keys(embed.regions)])) {
    const a = desktop.regions[key] ?? null
    const b = embed.regions[key] ?? null
    if (!rectsMatch(a, b)) differences.push({ kind: 'layout', detail: `${scope}: ${key} desktop=${rectText(a)} embed=${rectText(b)}` })
  }
  for (const key of new Set([...Object.keys(desktop.styles), ...Object.keys(embed.styles)])) {
    if (desktop.styles[key] !== embed.styles[key]) {
      differences.push({ kind: 'style', detail: `${scope}: ${key} desktop=${desktop.styles[key] ?? 'unset'} embed=${embed.styles[key] ?? 'unset'}` })
    }
  }
  return differences
}

export function classify(difference: Difference, omissions: ReadonlyArray<{ id: EmbedOmission; selector?: string }>): EmbedOmission | null {
  for (const omission of omissions) {
    if (omission.selector === undefined) continue
    if (difference.kind === 'tree' && difference.detail.includes(`<omitted ${omission.id}>`)) return omission.id
    const rootAttribute = omission.selector.match(/^html\[([\w-]+)\]$/)
    if (difference.kind === 'root' && rootAttribute && difference.detail.includes(`html[${rootAttribute[1]}]`)) return omission.id
  }
  return null
}

export function renderReport(input: {
  classified: ClassifiedDifference[]
  pixels: number
  omissions: ReadonlyArray<{ id: EmbedOmission; reason: string }>
  covered: ReadonlySet<EmbedOmission>
}): string {
  const lines: string[] = ['# Embed parity report', '']
  lines.push(`Screenshot mismatch: ${(input.pixels * 100).toFixed(2)}% of pixels (desktop with browser chrome vs the homepage iframe).`, '')
  lines.push('## Differences', '')
  if (input.classified.length === 0) lines.push('None.', '')
  for (const difference of input.classified) {
    lines.push(`- ${difference.omission === null ? 'UNEXPLAINED' : `allowed (${difference.omission})`} ${difference.kind}: ${difference.detail}`)
  }
  lines.push('', '## Allowlist', '')
  for (const { id, reason } of input.omissions) {
    lines.push(`- \`${id}\` (${input.covered.has(id) ? 'observed' : 'no visible difference'}). ${reason}`)
  }
  lines.push('')
  return lines.join('\n')
}
