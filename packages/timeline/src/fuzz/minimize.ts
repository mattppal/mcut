type StillFails<T> = (subset: T[]) => boolean | Promise<boolean>

export async function minimizeSteps<T>(steps: readonly T[], stillFails: StillFails<T>): Promise<T[]> {
  let current = [...steps]
  let granularity = 2
  while (current.length >= 2) {
    const chunks = splitInto(current, granularity)
    const smaller = await findAsync(
      chunks.map((_, i) => chunks.filter((_, j) => j !== i).flat()),
      stillFails,
    )
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

async function findAsync<T>(subsets: T[][], stillFails: StillFails<T>): Promise<T[] | undefined> {
  for (const subset of subsets) {
    if (await stillFails(subset)) return subset
  }
  return undefined
}

function splitInto<T>(items: T[], parts: number): T[][] {
  const size = Math.ceil(items.length / parts)
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size))
  return chunks
}

async function removeSingles<T>(items: T[], stillFails: StillFails<T>): Promise<T[]> {
  let current = items
  for (let i = 0; i < current.length; ) {
    const without = current.filter((_, j) => j !== i)
    if (await stillFails(without)) current = without
    else i++
  }
  return current
}
