import { describe, expect, test } from 'bun:test'
import { decodeWav, encodeWav } from './wav'

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0))
const u16 = (value: number): number[] => [value & 0xff, value >>> 8]
const u32 = (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24]
const f32 = (value: number): number[] => [...new Uint8Array(Float32Array.of(value).buffer)]
const chunk = (id: string, body: number[]): number[] => [...ascii(id), ...u32(body.length), ...body, ...(body.length % 2 === 1 ? [0] : [])]

function riff(...chunks: number[][]): Uint8Array<ArrayBuffer> {
  const body = [...ascii('WAVE'), ...chunks.flat()]
  return Uint8Array.from([...ascii('RIFF'), ...u32(body.length), ...body])
}

const floatSubformat = [...u16(3), 0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71]

describe('encodeWav', () => {
  test('writes a canonical 16-bit PCM mono file', () => {
    const format = chunk('fmt ', [...u16(1), ...u16(1), ...u32(16_000), ...u32(32_000), ...u16(2), ...u16(16)])
    expect(encodeWav(Float32Array.of(0.5, -1), 16_000)).toEqual(riff(format, chunk('data', [...u16(0x4000), ...u16(0x8000)])))
  })

  test('round trips through decodeWav at 16-bit precision', () => {
    const decoded = decodeWav(encodeWav(Float32Array.of(0, 0.5, -1, 1, -0.25, 2), 48_000))
    expect(decoded).toEqual({ samples: Float32Array.of(0, 0.5, -1, 32_767 / 32_768, -0.25, 32_767 / 32_768), sampleRate: 48_000 })
  })
})

describe('decodeWav', () => {
  test('downmixes extensible 32-bit float stereo and skips unknown chunks', () => {
    const format = chunk('fmt ', [
      ...u16(0xfffe),
      ...u16(2),
      ...u32(44_100),
      ...u32(44_100 * 8),
      ...u16(8),
      ...u16(32),
      ...u16(22),
      ...u16(32),
      ...u32(3),
      ...floatSubformat,
    ])
    const data = chunk('data', [0.5, -0.25, 1, 1, 0.25, 0.75].flatMap(f32))
    expect(decodeWav(riff(format, chunk('LIST', [1, 2, 3]), data))).toEqual({ samples: Float32Array.of(0.125, 1, 0.5), sampleRate: 44_100 })
  })

  test('rejects encodings other than 16-bit PCM and 32-bit float', () => {
    const format = chunk('fmt ', [...u16(1), ...u16(1), ...u32(48_000), ...u32(144_000), ...u16(3), ...u16(24)])
    expect(() => decodeWav(riff(format, chunk('data', [0, 0, 0])))).toThrow(
      'unsupported WAV encoding 1 with 24-bit samples, expected 16-bit PCM or 32-bit float',
    )
  })
})
