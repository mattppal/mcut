import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

interface Line {
  text: string
  gapAfterMs: number
  retakeOf?: number
}

interface PlacedLine extends Line {
  startMs: number
  endMs: number
}

const LINES: Line[] = [
  { text: 'Hey, today I am going to show you how the timeline works in this editor.', gapAfterMs: 700 },
  { text: 'First, open the editor and import your clips into the media bin.', gapAfterMs: 700 },
  { text: 'Then you click the export button in the top, uh, no, wait.', gapAfterMs: 1_200 },
  { text: 'Then you click the export button in the top right corner.', gapAfterMs: 700, retakeOf: 2 },
  { text: 'That renders your video with every edit applied.', gapAfterMs: 700 },
  { text: 'Thanks for watching.', gapAfterMs: 1_000 },
]

const LEAD_MS = 400
const CAMERA_OFFSET_MS = 600
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

async function run(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  if ((await proc.exited) !== 0) throw new Error(`${cmd[0]} failed. ${err.slice(-800)}`)
  return out
}

const durationMs = async (file: string): Promise<number> =>
  Math.round(Number(await run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])) * 1000)

async function speech(work: string): Promise<{ wav: string; lines: PlacedLine[]; totalMs: number }> {
  const parts: string[] = []
  const lines: PlacedLine[] = []
  let cursor = LEAD_MS
  const lead = join(work, 'lead.wav')
  await run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', String(LEAD_MS / 1000), lead])
  parts.push(lead)
  for (const [index, line] of LINES.entries()) {
    const said = join(work, `line-${index}.wav`)
    await run(['espeak-ng', '-v', 'en-us', '-s', '155', '-w', said, line.text])
    const spoken = await durationMs(said)
    lines.push({ ...line, startMs: cursor, endMs: cursor + spoken })
    const gap = join(work, `gap-${index}.wav`)
    await run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', String(line.gapAfterMs / 1000), gap])
    parts.push(said, gap)
    cursor += spoken + line.gapAfterMs
  }
  const list = join(work, 'parts.txt')
  writeFileSync(list, parts.map((part) => `file '${part}'`).join('\n'))
  const wav = join(work, 'speech.wav')
  await run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-ar', '48000', wav])
  return { wav, lines, totalMs: cursor }
}

function cameraFilter(lines: PlacedLine[]): string {
  const talking = lines.map((line) => `between(t,${(line.startMs + CAMERA_OFFSET_MS) / 1000},${(line.endMs + CAMERA_OFFSET_MS) / 1000})`).join('+')
  return [
    'drawbox=x=0:y=0:w=iw:h=ih:color=0x2b3a4a:t=fill',
    'drawbox=x=440:y=560:w=400:h=160:color=0x3d5a80:t=fill',
    'drawbox=x=560:y=140:w=160:h=440:color=0xe0ac69:t=fill',
    'drawbox=x=520:y=180:w=240:h=360:color=0xe0ac69:t=fill',
    'drawbox=x=520:y=150:w=240:h=70:color=0x4a3020:t=fill',
    'drawbox=x=575:y=300:w=36:h=24:color=0x1b1b1b:t=fill',
    'drawbox=x=669:y=300:w=36:h=24:color=0x1b1b1b:t=fill',
    'drawbox=x=610:y=450:w=60:h=10:color=0x7a3b2e:t=fill',
    `drawbox=x=610:y=445:w=60:h=34:color=0x5a1f18:t=fill:enable='(${talking})*lt(mod(t,0.24),0.12)'`,
    `drawtext=fontfile=${FONT}:text='CAM A':x=30:y=30:fontsize=28:fontcolor=white@0.6`,
  ].join(',')
}

function screenFilter(): string {
  const text = (value: string, x: number | string, y: number | string, size: number, color = 'white') =>
    `drawtext=fontfile=${FONT}:text='${value}':x=${x}:y=${y}:fontsize=${size}:fontcolor=${color}`
  return [
    'drawbox=x=0:y=0:w=iw:h=ih:color=0x1e1e1e:t=fill',
    'drawbox=x=0:y=0:w=iw:h=72:color=0x2d2d2d:t=fill',
    text('mcut Studio', 32, 20, 30),
    'drawbox=x=1680:y=14:w=200:h=44:color=0xd9480f:t=fill',
    text('Export', 1728, 22, 28),
    'drawbox=x=0:y=72:w=360:h=648:color=0x252525:t=fill',
    text('Media', 32, 100, 26, '0xbbbbbb'),
    'drawbox=x=32:y=150:w=296:h=160:color=0x4c6ef5:t=fill',
    'drawbox=x=32:y=330:w=296:h=160:color=0x37b24d:t=fill',
    'drawbox=x=400:y=110:w=1120:h=590:color=0x000000:t=fill',
    text('Preview', 880, 380, 40, '0x666666'),
    'drawbox=x=0:y=720:w=iw:h=360:color=0x181818:t=fill',
    text('Timeline', 32, 740, 26, '0xbbbbbb'),
    'drawbox=x=200:y=800:w=900:h=80:color=0x1864ab:t=fill',
    'drawbox=x=1120:y=800:w=500:h=80:color=0x5f3dc4:t=fill',
    'drawbox=x=200:y=900:w=1400:h=60:color=0x2b8a3e:t=fill',
    "drawbox=x='200+mod(t*120,1400)':y=780:w=4:h=200:color=0xff4d4f:t=fill",
    "drawbox=x='400+300*sin(t/2)':y='400+200*cos(t/3)':w=18:h=18:color=white:t=fill",
  ].join(',')
}

export async function writeStandins(outDir: string): Promise<void> {
  const work = join(outDir, '.work')
  mkdirSync(work, { recursive: true })
  const { wav, lines, totalMs } = await speech(work)
  const videoMs = totalMs + CAMERA_OFFSET_MS + 500
  const seconds = String(videoMs / 1000)
  await run(['ffmpeg', '-y', '-v', 'error', '-i', wav, '-c:a', 'pcm_s16le', join(outDir, 'audio.wav')])
  await run([
    'ffmpeg', '-y', '-v', 'error',
    '-f', 'lavfi', '-i', `color=c=black:s=1280x720:r=30:d=${seconds}`,
    '-i', wav,
    '-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=0.01:r=48000:d=${seconds}`,
    '-filter_complex', `[0:v]${cameraFilter(lines)}[v];[1:a]adelay=${CAMERA_OFFSET_MS},highpass=f=200,lowpass=f=5000,volume=0.7,apad[s];[s][2:a]amix=inputs=2:duration=shortest[a]`,
    '-map', '[v]', '-map', '[a]', '-t', seconds, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(outDir, 'camera.mp4'),
  ])
  await run([
    'ffmpeg', '-y', '-v', 'error',
    '-f', 'lavfi', '-i', `color=c=black:s=1920x1080:r=30:d=${seconds}`,
    '-vf', screenFilter(), '-t', seconds, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(outDir, 'screen.mp4'),
  ])
  const manifest = {
    note: 'Stand-ins for Matt\'s talking track, screen track, and separate audio. Times are milliseconds.',
    cameraOffsetMs: CAMERA_OFFSET_MS,
    audioWavMs: totalMs,
    videoMs,
    lines: lines.map((line) => ({ text: line.text, audioStartMs: line.startMs, audioEndMs: line.endMs, cameraStartMs: line.startMs + CAMERA_OFFSET_MS, ...(line.retakeOf === undefined ? {} : { retakeOf: line.retakeOf }) })),
    screenRegions: { exportButton: { x: 1680, y: 14, w: 200, h: 44 }, timeline: { x: 0, y: 720, w: 1920, h: 360 } },
  }
  writeFileSync(join(outDir, 'standins.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  rmSync(work, { recursive: true, force: true })
}

if (import.meta.main) {
  const outDir = resolve(process.argv[2] ?? 'reports/agent-e2e/talking-head-standins')
  mkdirSync(outDir, { recursive: true })
  await writeStandins(outDir)
  console.log(`wrote camera.mp4, screen.mp4, audio.wav, standins.json to ${outDir}`)
}
