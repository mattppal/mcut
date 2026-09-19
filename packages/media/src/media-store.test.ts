import { afterEach, describe, expect, test } from 'bun:test'
import { loadMediaBlob, pruneMediaBlobs, saveMediaBlob } from './media-store'

const originalStorage = navigator.storage

function restoreStorage(): void {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: originalStorage,
  })
}

afterEach(restoreStorage)

describe('media store', () => {
  test('loadMediaBlob returns null when the hash is missing', async () => {
    const dir = {
      getFileHandle: async () => {
        throw new DOMException('missing', 'NotFoundError')
      },
    }
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: async () => ({
          getDirectoryHandle: async () => dir,
        }),
      },
    })
    await expect(loadMediaBlob('abc')).resolves.toBeNull()
  })

  test('loadMediaBlob throws when the store fails for a reason other than a missing hash', async () => {
    const dir = {
      getFileHandle: async () => {
        throw new DOMException('denied', 'SecurityError')
      },
    }
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: async () => ({
          getDirectoryHandle: async () => dir,
        }),
      },
    })
    await expect(loadMediaBlob('abc')).rejects.toThrow('Failed to load stored media abc')
  })

  test('saveMediaBlob throws when writing fails', async () => {
    const dir = {
      getFileHandle: async () => {
        throw new DOMException('missing', 'NotFoundError')
      },
    }
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: async () => ({
          getDirectoryHandle: async () => dir,
        }),
      },
    })
    await expect(saveMediaBlob('abc', new Blob(['x']))).rejects.toThrow('Failed to save media abc')
  })

  test('pruneMediaBlobs skips locked entries and keeps going', async () => {
    const removed: string[] = []
    const dir = {
      async *[Symbol.asyncIterator]() {
        yield ['keep', {}]
        yield ['stale', {}]
        yield ['gone', {}]
        yield ['locked', {}]
      },
      removeEntry: async (name: string) => {
        if (name === 'locked') throw new DOMException('locked', 'NoModificationAllowedError')
        if (name === 'gone') throw new DOMException('missing', 'NotFoundError')
        removed.push(name)
      },
    }
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: async () => ({
          getDirectoryHandle: async () => dir,
        }),
      },
    })
    await expect(pruneMediaBlobs(new Set(['keep']))).resolves.toBe(1)
    expect(removed).toEqual(['stale'])
  })
})
