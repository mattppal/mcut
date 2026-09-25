import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeWav, encodeWav } from '@mcut/voice'

const CLI = join(import.meta.dir, 'cli.ts')
const VOICE_FIXTURES = join(import.meta.dir, '..', '..', 'voice', 'test', 'fixtures')

function signalToDifferenceDb(estimate: Float32Array, reference: Float32Array): number {
  let signal = 0
  let difference = 0
  reference.forEach((sample, index) => {
    signal += sample * sample
    difference += (sample - (estimate[index] ?? 0)) ** 2
  })
  return 10 * Math.log10(signal / difference)
}

async function run(args: string[], options: { cwd?: string; stdin?: string } = {}) {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    cwd: options.cwd,
    stdin: options.stdin === undefined ? 'ignore' : new TextEncoder().encode(options.stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { stdout, stderr, exitCode }
}

describe('mcut CLI', () => {
  test('new → apply → validate → summarize round trip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcut-cli-'))
    const file = join(dir, 'project.json')

    const created = await run(['new', file, '--preset', 'shorts', '--name', 'Test cut'])
    expect(created.exitCode).toBe(0)
    expect(created.stdout).toContain('1080x1920')

    const applied = await run(['apply', file], {
      stdin: JSON.stringify([
        { type: 'addAsset', asset: { id: 'a-1', kind: 'video', src: 'media/a.mp4', name: 'a.mp4' } },
        {
          type: 'addElement',
          trackId: 't-default',
          element: { id: 'e-1', type: 'video', startMs: 0, durationMs: 4000, assetId: 'a-1' },
        },
      ]),
    })
    expect(applied.stderr).toBe('')
    expect(applied.exitCode).toBe(0)
    expect(applied.stdout).toContain('Applied 2 command(s)')

    const project = JSON.parse(await readFile(file, 'utf8'))
    expect(project.tracks[0].elements).toHaveLength(1)

    const validated = await run(['validate', file])
    expect(validated.exitCode).toBe(0)
    expect(validated.stdout).toContain('OK')

    const summarized = await run(['summarize', file])
    expect(summarized.exitCode).toBe(0)
    expect(summarized.stdout).toContain('e-1')
  })

  test('apply with an invalid command fails without writing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcut-cli-'))
    const file = join(dir, 'project.json')
    await run(['new', file])
    const before = await readFile(file, 'utf8')
    const result = await run(['apply', file], {
      stdin: JSON.stringify({ type: 'removeElement', elementId: 'e-ghost' }),
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('CommandError')
    expect(await readFile(file, 'utf8')).toBe(before)
  })

  test('validate exits 1 on broken documents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcut-cli-'))
    const file = join(dir, 'project.json')
    await run(['new', file])
    const project = JSON.parse(await readFile(file, 'utf8'))
    project.tracks[0].elements.push({
      id: 'e-1',
      type: 'video',
      startMs: 0,
      durationMs: 1000,
      trimStartMs: 0,
      assetId: 'a-ghost',
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      opacity: 1,
      volume: 1,
      muted: false,
    })
    await writeFile(file, JSON.stringify(project))
    const result = await run(['validate', file])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('missing-asset')
  })

  test('commands lists the registry and prints schemas', async () => {
    const list = await run(['commands'])
    expect(list.exitCode).toBe(0)
    expect(list.stdout).toContain('splitElement')

    const single = await run(['commands', '--name', 'splitElement'])
    expect(single.exitCode).toBe(0)
    const tool = JSON.parse(single.stdout)
    expect(tool.inputSchema.properties).toHaveProperty('atMs')
  })

  test('silence-cuts removes transcript gaps end to end', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcut-cli-'))
    const file = join(dir, 'project.json')
    const transcriptFile = join(dir, 'transcript.json')
    await run(['new', file])
    await run(['apply', file], {
      stdin: JSON.stringify([
        { type: 'addAsset', asset: { id: 'a-1', kind: 'video', src: 'media/a.mp4', name: 'a.mp4' } },
        {
          type: 'addElement',
          trackId: 't-default',
          element: { id: 'e-1', type: 'video', startMs: 0, durationMs: 10000, assetId: 'a-1' },
        },
      ]),
    })
    await writeFile(
      transcriptFile,
      JSON.stringify({
        words: [
          { text: 'hello', startMs: 0, endMs: 3000 },
          { text: 'world', startMs: 7000, endMs: 10000 },
        ],
      }),
    )
    const result = await run(['silence-cuts', file, '--transcript', transcriptFile, '--element', 'e-1', '--padding', '0'])
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('4.00s removed')
    const project = JSON.parse(await readFile(file, 'utf8'))
    expect(project.tracks[0].elements).toHaveLength(2)
  })

  test('clean-voice writes a 48 kHz WAV close to the native deep-filter output', async () => {
    const output = join(await mkdtemp(join(tmpdir(), 'mcut-cli-')), 'clean.wav')
    const result = await run(['clean-voice', join(VOICE_FIXTURES, 'input.wav'), '-o', output])
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    const cleaned = decodeWav(await readFile(output))
    const native = decodeWav(await readFile(join(VOICE_FIXTURES, 'native.wav')))
    expect(cleaned.sampleRate).toBe(48_000)
    expect(signalToDifferenceDb(cleaned.samples, native.samples)).toBeGreaterThan(35)
  }, 120_000)

  test('clean-voice rejects audio that is not 48 kHz', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcut-cli-'))
    const input = join(dir, 'phone.wav')
    await writeFile(input, encodeWav(new Float32Array(16_000), 16_000))
    const result = await run(['clean-voice', input, '-o', join(dir, 'clean.wav')])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(`mcut: ${input} is 16000 Hz audio and clean-voice needs 48000 Hz`)
  })
})
