import { valueAt } from './value-at'

export type ByteReader = (start: number, end: number) => Promise<Uint8Array>

const LAME_DECODER_DELAY_FRAMES = 529
const LAME_TAG_ENCODERS = ['LAME', 'Lavf', 'Lavc']
const MP3_FRAME_SEARCH_BYTES = 4096
const XING_TAG_BYTES = 192
const XING_OPTIONAL_FIELD_BYTES = [4, 4, 100, 4]
const ITUNES_MAX_PRIMING_FRAMES = 16_384
const MATROSKA_HEAD_BYTES = 65_536
const OPUS_FRAME_SIZES = {
  silk: [480, 960, 1920, 2880],
  hybrid: [480, 960],
  celt: [120, 240, 480, 960],
}

const EBML = {
  segment: 0x18538067,
  seekHead: 0x114d9b74,
  seek: 0x4dbb,
  seekId: 0x53ab,
  seekPosition: 0x53ac,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  codecDelay: 0x56aa,
  cluster: 0x1f43b675,
}

function text(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

function uint(bytes: Uint8Array, start: number, length: number): number {
  let value = 0
  for (let i = start; i < start + length; i++) value = value * 256 + valueAt(bytes, i)
  return value
}

function id3TagBytes(head: Uint8Array): number {
  if (head.length < 10 || text(head, 0, 3) !== 'ID3') return 0
  const size = [6, 7, 8, 9].reduce((total, i) => total * 128 + (valueAt(head, i) & 0x7f), 0)
  return 10 + size + ((valueAt(head, 5) & 0x10) !== 0 ? 10 : 0)
}

function xingOffset(bytes: Uint8Array, at: number): number | null {
  if (at + 4 > bytes.length || valueAt(bytes, at) !== 0xff) return null
  const b1 = valueAt(bytes, at + 1)
  const b2 = valueAt(bytes, at + 2)
  const version = (b1 >> 3) & 3
  const isLayer3 = (b1 & 0xe0) === 0xe0 && ((b1 >> 1) & 3) === 1
  if (!isLayer3 || version === 1 || b2 >> 4 === 0xf || ((b2 >> 2) & 3) === 3) return null
  const mono = valueAt(bytes, at + 3) >> 6 === 3
  const sideInfo = version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17
  return at + 4 + sideInfo
}

export async function lameStartSkipFrames(read: ByteReader): Promise<number> {
  const frameSearchStart = id3TagBytes(await read(0, 10))
  const bytes = await read(frameSearchStart, frameSearchStart + MP3_FRAME_SEARCH_BYTES + XING_TAG_BYTES)
  let tag: number | null = null
  for (let at = 0; tag === null && at < Math.min(bytes.length, MP3_FRAME_SEARCH_BYTES); at++) tag = xingOffset(bytes, at)
  if (tag === null || tag + 8 > bytes.length) return 0
  if (text(bytes, tag, 4) !== 'Xing' && text(bytes, tag, 4) !== 'Info') return 0
  const flags = uint(bytes, tag + 4, 4)
  const optional = XING_OPTIONAL_FIELD_BYTES.reduce((total, size, bit) => total + ((flags >> bit) & 1 ? size : 0), 0)
  const lame = tag + 8 + optional
  if (lame + 24 > bytes.length || !LAME_TAG_ENCODERS.includes(text(bytes, lame, 4))) return 0
  return (uint(bytes, lame + 21, 3) >> 12) + LAME_DECODER_DELAY_FRAMES
}

interface Box {
  type: string
  start: number
  content: number
  end: number
}

async function* boxes(read: ByteReader, start: number, end: number): AsyncGenerator<Box> {
  let at = start
  while (at + 8 <= end) {
    const head = await read(at, at + 16)
    if (head.length < 8) return
    const declared = uint(head, 0, 4)
    const header = declared === 1 ? 16 : 8
    if (head.length < header) return
    const size = declared === 1 ? uint(head, 8, 8) : declared === 0 ? end - at : declared
    if (size < header) return
    yield { type: text(head, 4, 4), start: at, content: at + header, end: at + size }
    at += size
  }
}

async function child(read: ByteReader, parent: { content: number; end: number }, type: string): Promise<Box | null> {
  for await (const box of boxes(read, parent.content, parent.end)) if (box.type === type) return box
  return null
}

async function metaChildren(read: ByteReader, meta: Box): Promise<{ content: number; end: number }> {
  const probe = await read(meta.content, meta.content + 12)
  const fullBox = probe.length < 8 || text(probe, 4, 4) !== 'hdlr'
  return { content: meta.content + (fullBox ? 4 : 0), end: meta.end }
}

function freeformValue(bytes: Uint8Array, name: string): string | null {
  let key = ''
  let value: string | null = null
  let at = 0
  while (at + 12 <= bytes.length) {
    const size = uint(bytes, at, 4)
    if (size < 12 || at + size > bytes.length) return null
    const type = text(bytes, at + 4, 4)
    if (type === 'name') key = text(bytes, at + 12, size - 12)
    if (type === 'data' && size > 16) value = text(bytes, at + 16, size - 16)
    at += size
  }
  return key === name ? value : null
}

export async function itunesPrimingFrames(read: ByteReader): Promise<number> {
  const file = { content: 0, end: Number.MAX_SAFE_INTEGER }
  const moov = await child(read, file, 'moov')
  const udta = moov && (await child(read, moov, 'udta'))
  const meta = udta && (await child(read, udta, 'meta'))
  const ilst = meta && (await child(read, await metaChildren(read, meta), 'ilst'))
  if (!ilst) return 0
  for await (const item of boxes(read, ilst.content, ilst.end)) {
    if (item.type !== '----') continue
    const smpb = freeformValue(await read(item.content, item.end), 'iTunSMPB')
    const priming = smpb === null ? Number.NaN : Number.parseInt(smpb.trim().split(/\s+/)[1] ?? '', 16)
    if (priming > 0 && priming < ITUNES_MAX_PRIMING_FRAMES) return priming
  }
  return 0
}

interface Element {
  id: number
  data: number
  end: number
}

function vintLength(first: number): number {
  let length = 1
  while (length <= 8 && (first & (0x80 >> (length - 1))) === 0) length++
  return length
}

function element(bytes: Uint8Array, at: number): Element | null {
  if (at >= bytes.length) return null
  const idLength = vintLength(valueAt(bytes, at))
  if (idLength > 4 || at + idLength >= bytes.length) return null
  const sizeAt = at + idLength
  const sizeLength = vintLength(valueAt(bytes, sizeAt))
  if (sizeLength > 8 || sizeAt + sizeLength > bytes.length) return null
  const marker = 0x80 >> (sizeLength - 1)
  const rest = uint(bytes, sizeAt + 1, sizeLength - 1)
  const high = valueAt(bytes, sizeAt) & (marker - 1)
  const size = high * 256 ** (sizeLength - 1) + rest
  const unknown = size === 2 ** (7 * sizeLength) - 1
  const data = sizeAt + sizeLength
  return { id: uint(bytes, at, idLength), data, end: unknown ? bytes.length : Math.min(bytes.length, data + size) }
}

function* elements(bytes: Uint8Array, start: number, end: number): Generator<Element> {
  let at = start
  while (at < end) {
    const found = element(bytes, at)
    if (!found) return
    yield found
    at = found.end
  }
}

function trackCodecDelay(bytes: Uint8Array, tracks: Element, trackNumber: number): number {
  for (const entry of elements(bytes, tracks.data, tracks.end)) {
    if (entry.id !== EBML.trackEntry) continue
    let number = -1
    let delay = 0
    for (const field of elements(bytes, entry.data, entry.end)) {
      if (field.id === EBML.trackNumber) number = uint(bytes, field.data, field.end - field.data)
      if (field.id === EBML.codecDelay) delay = uint(bytes, field.data, field.end - field.data)
    }
    if (number === trackNumber) return delay
  }
  return 0
}

function seekPosition(bytes: Uint8Array, seekHead: Element, target: number): number | null {
  for (const seek of elements(bytes, seekHead.data, seekHead.end)) {
    if (seek.id !== EBML.seek) continue
    let id = -1
    let position: number | null = null
    for (const field of elements(bytes, seek.data, seek.end)) {
      if (field.id === EBML.seekId) id = uint(bytes, field.data, field.end - field.data)
      if (field.id === EBML.seekPosition) position = uint(bytes, field.data, field.end - field.data)
    }
    if (id === target) return position
  }
  return null
}

export async function matroskaCodecDelayNs(read: ByteReader, trackNumber: number): Promise<number> {
  const head = await read(0, MATROSKA_HEAD_BYTES)
  const segment = [...elements(head, 0, head.length)].find((found) => found.id === EBML.segment)
  if (!segment) return 0
  let tracksAt: number | null = null
  for (const found of elements(head, segment.data, segment.end)) {
    if (found.id === EBML.tracks) return trackCodecDelay(head, found, trackNumber)
    if (found.id === EBML.seekHead) tracksAt = seekPosition(head, found, EBML.tracks)
    if (found.id === EBML.cluster) break
  }
  if (tracksAt === null) return 0
  const tail = await read(segment.data + tracksAt, segment.data + tracksAt + MATROSKA_HEAD_BYTES)
  const tracks = element(tail, 0)
  return tracks?.id === EBML.tracks ? trackCodecDelay(tail, tracks, trackNumber) : 0
}

export function vorbisShortBlockFrames(header: Uint8Array): number {
  if (header.length === 0) return 0
  let at = 1
  for (let laced = 0; laced < valueAt(header, 0) && at < header.length; at++) {
    if (valueAt(header, at) < 255) laced++
  }
  if (at + 29 > header.length || valueAt(header, at) !== 1 || text(header, at + 1, 6) !== 'vorbis') return 0
  return 1 << (valueAt(header, at + 28) & 0x0f)
}

export function opusPreSkip(header: Uint8Array): number {
  return header.length >= 12 && text(header, 0, 8) === 'OpusHead' ? valueAt(header, 10) + valueAt(header, 11) * 256 : 0
}

export function opusPacketFrames(packet: Uint8Array): number {
  if (packet.length === 0) return 0
  const toc = valueAt(packet, 0)
  const config = toc >> 3
  const sizes = config < 12 ? OPUS_FRAME_SIZES.silk : config < 16 ? OPUS_FRAME_SIZES.hybrid : OPUS_FRAME_SIZES.celt
  const frameSize = valueAt(sizes, config % sizes.length)
  const code = toc & 3
  const frames = code === 0 ? 1 : code < 3 ? 2 : packet.length > 1 ? valueAt(packet, 1) & 0x3f : 0
  return frameSize * frames
}
