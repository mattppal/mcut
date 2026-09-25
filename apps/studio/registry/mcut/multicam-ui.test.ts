import { describe, expect, test } from 'bun:test'
import type { LayoutSlot } from '@mcut/timeline'
import { panSlotWindow, slotCoverWindow } from './multicam-ui'

const slot: LayoutSlot = { source: 'camera', rect: { x: 0, y: 0, w: 0.5625, h: 1 }, fit: 'cover' }
const box = { width: 1080, height: 1080 }
const source = { width: 1920, height: 1080 }

describe('slot crop panning', () => {
  test('a cover slot shows the centered window of a wider source', () => {
    expect(slotCoverWindow(slot, box, source)).toEqual({ x: 0.21875, y: 0, w: 0.5625, h: 1 })
  })

  test('panning past the edge stops at the edge and the crop keeps showing it', () => {
    const crop = panSlotWindow(slotCoverWindow(slot, box, source), 0.9, 0.3)
    expect(crop).toEqual({ x: 0.4375, y: 0, w: 0.5625, h: 1 })
    expect(slotCoverWindow({ ...slot, crop }, box, source)).toEqual({ x: 0.4375, y: 0, w: 0.5625, h: 1 })
  })

  test('a window over the whole source stores no crop', () => {
    expect(panSlotWindow({ x: 0, y: 0, w: 1, h: 1 }, 0.2, 0.2)).toBeUndefined()
  })
})
