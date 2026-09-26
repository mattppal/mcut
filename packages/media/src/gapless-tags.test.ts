import { describe, expect, test } from 'bun:test'
import {
  itunesPrimingFrames,
  lameStartSkipFrames,
  matroskaCodecDelayNs,
  opusPacketFrames,
  opusPreSkip,
  vorbisShortBlockFrames,
  type ByteReader,
} from './gapless-tags'

type Part = number[] | Uint8Array | string

function bytes(...parts: Part[]): Uint8Array {
  const chunks = parts.map((part) => (typeof part === 'string' ? new TextEncoder().encode(part) : Uint8Array.from(part)))
  const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let at = 0
  for (const chunk of chunks) {
    joined.set(chunk, at)
    at += chunk.length
  }
  return joined
}

function zeros(length: number): number[] {
  return Array.from({ length }, () => 0)
}

function bigEndian(value: number, length: number): number[] {
  return Array.from({ length }, (_, index) => Math.floor(value / 256 ** (length - 1 - index)) % 256)
}

function reader(data: Uint8Array): ByteReader {
  return async (start, end) => data.subarray(start, end)
}

function mp3(tag: string, encoder: string, delayFrames: number): Uint8Array {
  const id3 = bytes('ID3', [4, 0, 0], [0, 0, 0, 20], zeros(20))
  const frame = bytes(
    [0xff, 0xfb, 0x90, 0x00],
    zeros(32),
    tag,
    bigEndian(0x0f, 4),
    zeros(112),
    encoder.padEnd(9, ' '),
    zeros(12),
    bigEndian(delayFrames * 4096 + 0x123, 3),
  )
  return bytes(id3, frame, zeros(400))
}

function box(type: string, ...content: Part[]): Uint8Array {
  const payload = bytes(...content)
  return bytes(bigEndian(payload.length + 8, 4), type, payload)
}

function ebml(id: number, ...content: Part[]): Uint8Array {
  const payload = bytes(...content)
  return bytes(bigEndian(id, Math.ceil(id.toString(16).length / 2)), [0x10], bigEndian(payload.length, 3), payload)
}

const FULL_BOX = [0, 0, 0, 0]
const EBML_HEADER = ebml(0x1a45dfa3, ebml(0x4286, [1]))

function trackEntry(number: number, codecDelayNs: number): Uint8Array {
  return ebml(0xae, ebml(0xd7, [number]), ebml(0x56aa, bigEndian(codecDelayNs, 4)))
}

describe('lameStartSkipFrames', () => {
  test('adds the decoder delay to the encoder delay a LAME tag records after an ID3 tag', async () => {
    expect(await lameStartSkipFrames(reader(mp3('Info', 'LAME3.100', 576)))).toBe(1105)
    expect(await lameStartSkipFrames(reader(mp3('Xing', 'Lavc61.19', 576)))).toBe(1105)
  })

  test('reads no delay from a tag another encoder wrote or from a frame without a tag', async () => {
    expect(await lameStartSkipFrames(reader(mp3('Info', 'GOGO', 576)))).toBe(0)
    expect(await lameStartSkipFrames(reader(mp3('\0\0\0\0', 'LAME3.100', 576)))).toBe(0)
  })
})

describe('itunesPrimingFrames', () => {
  test('reads the priming field of iTunSMPB and nothing from a file without it', async () => {
    const smpb = ' 00000000 00000840 000001CA 00000000003F31F6 00000000 00000000'
    const ilst = box(
      'ilst',
      box('----', box('mean', FULL_BOX, 'com.apple.iTunes'), box('name', FULL_BOX, 'iTunSMPB'), box('data', bigEndian(1, 4), zeros(4), smpb)),
    )
    const meta = box('meta', FULL_BOX, box('hdlr', FULL_BOX, zeros(4), 'mdirappl', zeros(9)), ilst)
    const ftyp = box('ftyp', 'M4A ', zeros(4), 'M4A mp42isom')
    const mvhd = box('mvhd', FULL_BOX, zeros(96))
    expect(await itunesPrimingFrames(reader(bytes(ftyp, box('moov', mvhd, box('udta', meta)), box('mdat', zeros(64)))))).toBe(2112)
    expect(await itunesPrimingFrames(reader(bytes(ftyp, box('moov', mvhd), box('mdat', zeros(64)))))).toBe(0)
  })
})

describe('matroskaCodecDelayNs', () => {
  test('reads the codec delay of the requested track', async () => {
    const segment = ebml(0x18538067, ebml(0x1654ae6b, trackEntry(1, 6_500_000), trackEntry(2, 21_333_333)), ebml(0x1f43b675, [0xe7, 0x81, 0]))
    expect(await matroskaCodecDelayNs(reader(bytes(EBML_HEADER, segment)), 2)).toBe(21_333_333)
    expect(await matroskaCodecDelayNs(reader(bytes(EBML_HEADER, segment)), 1)).toBe(6_500_000)
  })

  test('follows the seek head to tracks written after the first 64 KB', async () => {
    const seekHead = (position: number) => ebml(0x114d9b74, ebml(0x4dbb, ebml(0x53ab, [0x16, 0x54, 0xae, 0x6b]), ebml(0x53ac, bigEndian(position, 4))))
    const padding = ebml(0xec, zeros(70_000))
    const tracks = ebml(0x1654ae6b, trackEntry(1, 6_500_000))
    const segment = ebml(0x18538067, seekHead(seekHead(0).length + padding.length), padding, tracks)
    expect(await matroskaCodecDelayNs(reader(bytes(EBML_HEADER, segment)), 1)).toBe(6_500_000)
  })
})

describe('codec headers', () => {
  test('opusPreSkip reads the pre-skip of an OpusHead', () => {
    expect(opusPreSkip(bytes('OpusHead', [1, 2, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0]))).toBe(312)
    expect(opusPreSkip(bytes('OpusTags', [1, 2, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0]))).toBe(0)
  })

  test('opusPacketFrames counts the frames each packet decodes to', () => {
    expect([[0xfc], [0xff, 0x03], [0x18], [0x80], [0x61]].map((packet) => opusPacketFrames(Uint8Array.from(packet)))).toEqual([960, 2880, 2880, 120, 960])
  })

  test('vorbisShortBlockFrames reads the short block size from Xiph-laced headers', () => {
    const identification = bytes([1], 'vorbis', zeros(4), [2], [0x80, 0xbb, 0, 0], zeros(12), [0xb8, 1])
    expect(vorbisShortBlockFrames(bytes([2, identification.length, 3], identification, zeros(3), [5]))).toBe(256)
  })
})
