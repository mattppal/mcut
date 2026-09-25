import type { Project } from '@mcut/timeline'

const MAX_LINES = 14
const MAX_VALUE_CHARS = 80

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

const show = (value: Json | undefined): string => {
  const text = value === undefined ? 'unset' : JSON.stringify(value)
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text
}

const isRecord = (value: Json | undefined): value is { [key: string]: Json } => typeof value === 'object' && value !== null && !Array.isArray(value)

const idOf = (value: Json): string | undefined => (isRecord(value) && typeof value.id === 'string' ? value.id : undefined)

function keyed(items: Json[]): Map<string, Json> | undefined {
  const ids = items.map(idOf)
  if (ids.some((id) => id === undefined)) return undefined
  return new Map(items.map((item, index) => [ids[index] ?? String(index), item]))
}

function walk(path: string, before: Json | undefined, after: Json | undefined, out: string[]): void {
  if (JSON.stringify(before) === JSON.stringify(after)) return
  if (Array.isArray(before) && Array.isArray(after)) {
    const a = keyed(before)
    const b = keyed(after)
    if (a !== undefined && b !== undefined) {
      for (const [id, item] of b) {
        if (!a.has(id)) out.push(`+ ${path}[${id}] ${show(item)}`)
        else walk(`${path}[${id}]`, a.get(id), item, out)
      }
      for (const id of a.keys()) if (!b.has(id)) out.push(`- ${path}[${id}]`)
      return
    }
  }
  if (isRecord(before) && isRecord(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) walk(path === '' ? key : `${path}.${key}`, before[key], after[key], out)
    return
  }
  out.push(`~ ${path} ${show(before)} → ${show(after)}`)
}

export function describeChanges(before: Project, after: Project): string[] {
  const out: string[] = []
  walk('', JSON.parse(JSON.stringify(before)), JSON.parse(JSON.stringify(after)), out)
  return out.length > MAX_LINES ? [...out.slice(0, MAX_LINES), `… ${out.length - MAX_LINES} more changes`] : out
}
