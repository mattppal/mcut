export function minimizeSteps<T>(steps: readonly T[], stillFails: (subset: T[]) => boolean): T[] {
  let current = [...steps]
  let granularity = 2
  while (current.length >= 2) {
    const chunks = splitInto(current, granularity)
    const smaller = chunks.map((_, i) => chunks.filter((_, j) => j !== i).flat()).find((subset) => stillFails(subset))
    if (smaller !== undefined) {
      current = smaller
      granularity = Math.max(granularity - 1, 2)
    } else if (granularity >= current.length) {
      break
    } else {
      granularity = Math.min(granularity * 2, current.length)
    }
  }
  return removeSingles(current, stillFails)
}

function splitInto<T>(items: T[], parts: number): T[][] {
  const size = Math.ceil(items.length / parts)
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size))
  return chunks
}

function removeSingles<T>(items: T[], stillFails: (subset: T[]) => boolean): T[] {
  let current = items
  for (let i = 0; i < current.length; ) {
    const without = current.filter((_, j) => j !== i)
    if (stillFails(without)) current = without
    else i++
  }
  return current
}
