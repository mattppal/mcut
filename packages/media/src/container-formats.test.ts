import { describe, expect, test } from 'bun:test'
import { Mp4OutputFormat } from 'mediabunny'
import {
  getContainerFormat,
  listContainerFormats,
  registerContainerFormat,
} from './container-formats'

describe('container format registry', () => {
  test('built-ins register in order: mp4, webm, mkv', () => {
    expect(listContainerFormats().map((f) => f.id)).toEqual(['mp4', 'webm', 'mkv'])
  })

  test('mkv entry muxes Matroska', () => {
    const mkv = getContainerFormat('mkv')
    expect(mkv?.extension).toBe('mkv')
    expect(mkv?.mimeType).toBe('video/x-matroska')
    const output = mkv!.createOutputFormat()
    expect(output.mimeType).toBe('video/x-matroska')
    expect(output.fileExtension).toBe('.mkv')
    expect(output.getSupportedVideoCodecs().length).toBeGreaterThan(0)
  })

  test('custom formats register and resolve like built-ins', () => {
    registerContainerFormat({
      id: 'test-custom',
      label: 'Custom',
      extension: 'custom',
      mimeType: 'video/x-custom',
      createOutputFormat: () => new Mp4OutputFormat(),
    })
    expect(getContainerFormat('test-custom')?.label).toBe('Custom')
    expect(listContainerFormats().map((f) => f.id)).toContain('test-custom')
  })

  test('duplicate ids are rejected', () => {
    expect(() =>
      registerContainerFormat({
        id: 'mp4',
        label: 'MP4 again',
        extension: 'mp4',
        mimeType: 'video/mp4',
        createOutputFormat: () => new Mp4OutputFormat(),
      }),
    ).toThrow('already registered')
  })
})
