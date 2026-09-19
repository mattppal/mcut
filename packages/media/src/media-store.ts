/**
 * Content-addressed media persistence on OPFS (the OpenCut pattern: media
 * blobs live in the Origin Private File System keyed by content hash;
 * project JSON stores `asset.hash` and re-binds `src` on load). Hash-keyed
 * storage dedupes repeated imports and gives relink a stable identity.
 *
 * Callers fall back to their own storage (e.g. IndexedDB keyed by asset id)
 * when OPFS is unavailable or a file was imported without a hash.
 */

const MEDIA_DIR = 'mcut-media'

export const MAX_HASHABLE_BYTES = 512 * 1024 * 1024

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError'
}

export function isMediaStoreSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function' &&
    typeof crypto !== 'undefined' &&
    !!crypto.subtle
  )
}

/** SHA-256 hex of a blob's content, or null when too large to hash. */
export async function hashBlob(blob: Blob): Promise<string | null> {
  if (!isMediaStoreSupported() || blob.size > MAX_HASHABLE_BYTES) return null
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function mediaDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (!isMediaStoreSupported()) return null
  try {
    const root = await navigator.storage.getDirectory()
    return await root.getDirectoryHandle(MEDIA_DIR, { create })
  } catch (error) {
    if (isNotFound(error) && !create) return null
    throw new Error('Media store directory is unavailable', { cause: error })
  }
}

export async function saveMediaBlob(hash: string, blob: Blob): Promise<boolean> {
  const dir = await mediaDir(true)
  if (!dir) return false
  try {
    try {
      const existing = await dir.getFileHandle(hash)
      const file = await existing.getFile()
      if (file.size === blob.size) return true
    } catch (error) {
      if (!isNotFound(error)) {
        throw new Error(`Failed to inspect stored media ${hash}`, { cause: error })
      }
    }
    const handle = await dir.getFileHandle(hash, { create: true })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return true
  } catch (error) {
    throw new Error(`Failed to save media ${hash}`, { cause: error })
  }
}

export async function loadMediaBlob(hash: string): Promise<Blob | null> {
  const dir = await mediaDir(false)
  if (!dir) return null
  try {
    const handle = await dir.getFileHandle(hash)
    return await handle.getFile()
  } catch (error) {
    if (isNotFound(error)) return null
    throw new Error(`Failed to load stored media ${hash}`, { cause: error })
  }
}

function isAsyncIterator(value: unknown): value is AsyncIterator<unknown> {
  return typeof value === 'object' && value !== null && 'next' in value && typeof value.next === 'function'
}

function directoryEntries(dir: FileSystemDirectoryHandle): AsyncIterable<unknown> | null {
  const iterator = Reflect.get(dir, Symbol.asyncIterator)
  if (typeof iterator !== 'function') return null
  return {
    [Symbol.asyncIterator]() {
      const created = iterator.call(dir)
      if (!isAsyncIterator(created)) {
        throw new TypeError('Media store directory is not async-iterable')
      }
      return created
    },
  }
}

export async function pruneMediaBlobs(keep: ReadonlySet<string>): Promise<number> {
  const dir = await mediaDir(false)
  if (!dir) return 0
  const entries = directoryEntries(dir)
  if (!entries) return 0
  const names: string[] = []
  try {
    for await (const entry of entries) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue
      if (!keep.has(entry[0])) names.push(entry[0])
    }
  } catch (error) {
    throw new Error('Failed to iterate the media store', { cause: error })
  }
  let removed = 0
  for (const name of names) {
    try {
      await dir.removeEntry(name)
      removed++
    } catch (error) {
      if (isNotFound(error)) continue
      if (error instanceof DOMException && error.name === 'NoModificationAllowedError') continue
      throw new Error(`Failed to prune stored media ${name}`, { cause: error })
    }
  }
  return removed
}
