import { describe, expect, test } from 'bun:test'
import { containerFormats, listContainerFormats } from './container-formats'

describe('container formats', () => {
  test('lists the built-ins in table order: mp4, webm, mkv', () => {
    expect(listContainerFormats().map((f) => f.id)).toEqual(['mp4', 'webm', 'mkv'])
  })

  test('mkv entry muxes Matroska', async () => {
    const mkv = containerFormats.mkv
    expect(mkv.extension).toBe('mkv')
    expect(mkv.mimeType).toBe('video/x-matroska')
    const output = await mkv.createOutputFormat()
    expect(output.mimeType).toBe('video/x-matroska')
    expect(output.fileExtension).toBe('.mkv')
    expect(output.getSupportedVideoCodecs().length).toBeGreaterThan(0)
  })
})
