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

/** Largest file we hash/persist (WebCrypto digest needs the full buffer). */
export const MAX_HASHABLE_BYTES = 512 * 1024 * 1024

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
  } catch {
    return null
  }
}

/** Persist a blob under its hash. No-op when already stored (same content). */
export async function saveMediaBlob(hash: string, blob: Blob): Promise<boolean> {
  const dir = await mediaDir(true)
  if (!dir) return false
  try {
    try {
      const existing = await dir.getFileHandle(hash)
      const file = await existing.getFile()
      if (file.size === blob.size) return true // content-addressed: same hash = same bytes
    } catch {
      // Not stored yet.
    }
    const handle = await dir.getFileHandle(hash, { create: true })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return true
  } catch {
    return false
  }
}

export async function loadMediaBlob(hash: string): Promise<Blob | null> {
  const dir = await mediaDir(false)
  if (!dir) return null
  try {
    const handle = await dir.getFileHandle(hash)
    return await handle.getFile()
  } catch {
    return null
  }
}

/** Delete stored blobs whose hash is not in `keep`. Returns removed count. */
export async function pruneMediaBlobs(keep: ReadonlySet<string>): Promise<number> {
  const dir = await mediaDir(false)
  if (!dir) return 0
  let removed = 0
  try {
    const names: string[] = []
    // OPFS directories are async-iterable of [name, handle].
    for await (const [name] of dir as unknown as AsyncIterable<[string, unknown]>) {
      if (!keep.has(name)) names.push(name)
    }
    for (const name of names) {
      try {
        await dir.removeEntry(name)
        removed++
      } catch {
        // Locked or already gone.
      }
    }
  } catch {
    // Iteration unsupported: skip pruning.
  }
  return removed
}
