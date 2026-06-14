import { describe, expect, test } from 'bun:test'
import { coalesceActiveMediaItems, type ActiveMediaItem } from './preview-pool'

const base: ActiveMediaItem = {
  assetId: 'a-1',
  kind: 'video',
  sourceTimeMs: 1000,
  rate: 1,
  volume: 0,
}

describe('coalesceActiveMediaItems', () => {
  test('keeps an audible item from being overwritten by a muted visual item', () => {
    const items = coalesceActiveMediaItems([
      { ...base, kind: 'video', sourceTimeMs: 5000, volume: 0 },
      { ...base, kind: 'audio', sourceTimeMs: 1000, volume: 0.8 },
    ])

    expect(items).toEqual([
      { ...base, kind: 'video', sourceTimeMs: 1000, rate: 1, volume: 0.8 },
    ])
  })

  test('keeps video capability when an audio item is the audible source', () => {
    const items = coalesceActiveMediaItems([
      { ...base, kind: 'audio', sourceTimeMs: 1000, volume: 0.5 },
      { ...base, kind: 'video', sourceTimeMs: 1000, volume: 0 },
    ])

    expect(items[0]).toMatchObject({ kind: 'video', sourceTimeMs: 1000, volume: 0.5 })
  })

  test('combines volume for duplicate audible items on the same media clock', () => {
    const items = coalesceActiveMediaItems([
      { ...base, kind: 'video', volume: 0.4 },
      { ...base, kind: 'audio', sourceTimeMs: 1020, volume: 0.3 },
    ])

    expect(items[0]).toMatchObject({ kind: 'video', sourceTimeMs: 1000, volume: 0.7 })
  })

  test('uses the louder item when duplicate audible items need different clocks', () => {
    const items = coalesceActiveMediaItems([
      { ...base, kind: 'video', sourceTimeMs: 1000, volume: 0.4 },
      { ...base, kind: 'audio', sourceTimeMs: 3000, volume: 0.9 },
    ])

    expect(items[0]).toMatchObject({ kind: 'video', sourceTimeMs: 3000, volume: 0.9 })
  })
})
