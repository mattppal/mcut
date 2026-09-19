import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProbeRunner } from './fuzz/probe-runner'

const flacSignature = [0x66, 0x4c, 0x61, 0x43]
const lastStreamInfoBlockHeader = [0x80, 0x00, 0x00, 0x22]
const streamInfo48kStereo16Bit288000Samples = [
  0x10, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b, 0xb8, 0x02, 0xf0, 0x00, 0x04, 0x65, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]

const metadataOnlyFlac = new Uint8Array([
  ...flacSignature,
  ...lastStreamInfoBlockHeader,
  ...streamInfo48kStereo16Bit288000Samples,
])

function writeTempFile(name: string, bytes: Uint8Array): string {
  const path = join(mkdtempSync(join(tmpdir(), 'mcut-probe-')), name)
  writeFileSync(path, bytes)
  return path
}

test('probeMedia settles on a FLAC file that ends after its metadata blocks', async () => {
  const runner = new ProbeRunner(3000)
  try {
    const outcome = await runner.probe(writeTempFile('metadata-only.flac', metadataOnlyFlac))
    expect(outcome).toMatchObject({
      kind: 'probe',
      probe: { durationMs: 0, hasVideo: false, hasAudio: true, mimeType: 'audio/flac' },
    })
  } finally {
    runner.close()
  }
})
