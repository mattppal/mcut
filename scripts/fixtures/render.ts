import { existsSync } from 'node:fs'
import { z } from 'zod'
import type { MeasuredTruth } from './manifest'
import {
  VFR_SCHEDULE,
  type AudioCodec,
  type Container,
  type FixtureRecipe,
  type Rotation,
  type VideoCodec,
} from './recipes'

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export async function exec(args: string[]): Promise<ExecResult> {
  const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}

export interface Tooling {
  ffmpeg: string
  encoders: ReadonlySet<string>
  filters: ReadonlySet<string>
  fontFile: string | null
}

const fontCandidates = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/Library/Fonts/Arial Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  'C:/Windows/Fonts/arialbd.ttf',
]

function namesFromListing(listing: string, flagWidth: number): Set<string> {
  const pattern = new RegExp(`^\\s*[A-Z.]{${flagWidth}}\\s+(\\S+)`, 'gm')
  return new Set([...listing.matchAll(pattern)].map((match) => match[1] ?? ''))
}

export async function detectTooling(): Promise<Tooling | null> {
  const version = await exec(['ffmpeg', '-version']).catch(() => null)
  if (!version || version.code !== 0) return null
  const [encoders, filters] = await Promise.all([
    exec(['ffmpeg', '-hide_banner', '-encoders']),
    exec(['ffmpeg', '-hide_banner', '-filters']),
  ])
  return {
    ffmpeg: version.stdout.split('\n')[0]?.replace(/^ffmpeg version\s+/, '').split(' ')[0] ?? 'unknown',
    encoders: namesFromListing(encoders.stdout, 6),
    filters: namesFromListing(filters.stdout, 3),
    fontFile: fontCandidates.find((path) => existsSync(path)) ?? null,
  }
}

interface VideoEncoder {
  candidates: readonly string[]
  pixelFormat: string
  args: (encoder: string) => string[]
}

const videoEncoders: Record<VideoCodec, VideoEncoder> = {
  h264: {
    candidates: ['libx264'],
    pixelFormat: 'yuv420p',
    args: () => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28'],
  },
  hevc: {
    candidates: ['libx265'],
    pixelFormat: 'yuv420p',
    args: () => ['-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '30', '-tag:v', 'hvc1', '-x265-params', 'log-level=none'],
  },
  vp9: {
    candidates: ['libvpx-vp9'],
    pixelFormat: 'yuv420p',
    args: () => ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-crf', '35', '-b:v', '0'],
  },
  av1: {
    candidates: ['libsvtav1', 'libaom-av1'],
    pixelFormat: 'yuv420p',
    args: (encoder) =>
      encoder === 'libsvtav1'
        ? ['-c:v', 'libsvtav1', '-preset', '12', '-crf', '45']
        : ['-c:v', 'libaom-av1', '-cpu-used', '8', '-usage', 'realtime', '-crf', '45', '-row-mt', '1'],
  },
  prores: {
    candidates: ['prores_ks'],
    pixelFormat: 'yuv422p10le',
    args: () => ['-c:v', 'prores_ks', '-profile:v', '0'],
  },
}

const audioEncoders: Record<AudioCodec, { encoder: string; args: (recipe: FixtureRecipe) => string[] }> = {
  aac: {
    encoder: 'aac',
    args: (recipe) => ['-c:a', 'aac', '-b:a', `${recipe.channels * (recipe.sampleRate <= 16_000 ? 16 : 64)}k`],
  },
  opus: { encoder: 'libopus', args: (recipe) => ['-c:a', 'libopus', '-b:a', `${recipe.channels * 32}k`] },
  mp3: { encoder: 'libmp3lame', args: () => ['-c:a', 'libmp3lame', '-b:a', '96k'] },
  pcm_s16le: { encoder: 'pcm_s16le', args: () => ['-c:a', 'pcm_s16le'] },
  flac: { encoder: 'flac', args: () => ['-c:a', 'flac'] },
}

const containerArgs: Record<Container, string[]> = {
  mp4: ['-movflags', '+faststart'],
  mov: ['-movflags', '+faststart'],
  m4a: ['-movflags', '+faststart'],
  webm: [],
  mkv: [],
  ogg: [],
  mp3: [],
  wav: [],
  flac: [],
}

const channelLayouts: Record<number, string> = { 1: 'mono', 2: 'stereo', 6: '5.1' }

function audioExpression(recipe: FixtureRecipe): string {
  if (recipe.silenceGaps.length > 0) {
    const gate = recipe.silenceGaps.map((gap) => `between(t,${gap.startMs / 1000},${gap.endMs / 1000})`).join('+')
    return `if(${gate},0,0.4*sin(2*PI*(300*mod(t,1)+1350*mod(t,1)*mod(t,1))))`
  }
  const tone = recipe.tone ?? { hz: 440, gain: 0.3, beepGain: 0.3, beepMs: 0, beepEveryMs: 1000 }
  const envelope = `${tone.gain}+(${tone.beepGain}-${tone.gain})*lt(mod(t,${tone.beepEveryMs / 1000}),${tone.beepMs / 1000})`
  return `(${envelope})*sin(2*PI*${tone.hz}*t)`
}

function audioSource(recipe: FixtureRecipe): string {
  const layout = channelLayouts[recipe.channels]
  if (layout === undefined) throw new Error(`${recipe.id}: no channel layout for ${recipe.channels} channels`)
  const exprs = Array.from({ length: recipe.channels }, () => audioExpression(recipe)).join('|')
  return `aevalsrc=exprs='${exprs}':sample_rate=${recipe.sampleRate}:channel_layout=${layout}:duration=${recipe.durationMs / 1000}`
}

export function videoFrameCount(recipe: FixtureRecipe): number {
  if (recipe.fps === 'vfr') return VFR_SCHEDULE.framesPerSegment * 2
  return Math.max(1, Math.round((recipe.durationMs * recipe.fps) / 1000))
}

function sourceFps(recipe: FixtureRecipe): number {
  return recipe.fps === 'vfr' ? VFR_SCHEDULE.firstFps : recipe.fps
}

function videoInput(recipe: FixtureRecipe, stillImage: string | null): string[] {
  const fps = sourceFps(recipe)
  if (stillImage !== null) return ['-f', 'image2', '-loop', '1', '-framerate', String(fps), '-i', stillImage]
  const size = `${Math.max(2, recipe.width)}x${Math.max(2, recipe.height)}`
  const seconds = videoFrameCount(recipe) / fps
  return ['-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${fps}:duration=${seconds}`]
}

function frameCounterFilter(recipe: FixtureRecipe, fontFile: string | null): string {
  const font = fontFile === null ? 'font=Sans' : `fontfile=${fontFile}`
  const size = Math.max(8, Math.min(36, Math.round(Math.min(recipe.width, recipe.height) / 10)))
  return `drawtext=${font}:text='%{n} %{pts}':fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.6:x=8:y=8`
}

function vfrFilter(): string {
  const { firstFps, secondFps, framesPerSegment } = VFR_SCHEDULE
  return `setpts='if(lt(N,${framesPerSegment}),N/${firstFps},${framesPerSegment / firstFps}+(N-${framesPerSegment})/${secondFps})/TB'`
}

function videoFilter(recipe: FixtureRecipe, pixelFormat: string, fontFile: string | null): string {
  const parts = [`scale=${recipe.width}:${recipe.height}:flags=neighbor`, 'setsar=1', `format=${pixelFormat}`]
  if (recipe.frameCounter) parts.push(frameCounterFilter(recipe, fontFile))
  if (recipe.fps === 'vfr') parts.push(vfrFilter())
  return parts.join(',')
}

const rotationArgs = (rotation: Rotation): string[] =>
  rotation === 0 ? [] : ['-noautorotate', '-display_rotation', String(rotation)]

export type RenderPlan = { kind: 'skip'; reason: string } | { kind: 'render'; args: string[] }

export function planRender(recipe: FixtureRecipe, tooling: Tooling, stillImage: string | null, output: string): RenderPlan {
  const inputs: string[] = []
  const outputs: string[] = []
  if (recipe.videoCodec !== null) {
    const table = videoEncoders[recipe.videoCodec]
    const encoder = table.candidates.find((name) => tooling.encoders.has(name))
    if (encoder === undefined) return { kind: 'skip', reason: `no ${table.candidates.join(' or ')} encoder in this ffmpeg` }
    if (recipe.frameCounter && !tooling.filters.has('drawtext')) return { kind: 'skip', reason: 'no drawtext filter in this ffmpeg' }
    inputs.push(...rotationArgs(recipe.rotation), ...videoInput(recipe, stillImage))
    outputs.push('-vf', videoFilter(recipe, table.pixelFormat, tooling.fontFile), '-frames:v', String(videoFrameCount(recipe)))
    if (recipe.fps === 'vfr') outputs.push('-fps_mode', 'vfr', '-bf', '0')
    outputs.push(...table.args(encoder))
  }
  if (recipe.audioCodec !== null) {
    const table = audioEncoders[recipe.audioCodec]
    if (!tooling.encoders.has(table.encoder)) return { kind: 'skip', reason: `no ${table.encoder} encoder in this ffmpeg` }
    inputs.push('-f', 'lavfi', '-i', audioSource(recipe))
    outputs.push(...table.args(recipe))
  }
  outputs.push('-map_metadata', '-1', '-flags', '+bitexact', '-fflags', '+bitexact', ...containerArgs[recipe.container], output)
  return { kind: 'render', args: ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...inputs, ...outputs] }
}

export function stillImageArgs(recipe: FixtureRecipe, output: string): string[] {
  const size = `${Math.max(2, recipe.width)}x${Math.max(2, recipe.height)}`
  return ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=1:duration=1`, '-frames:v', '1', '-update', '1', output]
}

const probeOutputSchema = z.object({
  format: z.object({ duration: z.string().optional() }),
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      nb_frames: z.string().optional(),
      sample_rate: z.string().optional(),
      channels: z.number().optional(),
      side_data_list: z.array(z.object({ rotation: z.number().optional() })).optional(),
    }),
  ),
})

const probeEntries =
  'format=duration:stream=codec_type,codec_name,width,height,nb_frames,sample_rate,channels:stream_side_data=rotation'

export async function probeTruth(path: string): Promise<MeasuredTruth> {
  const result = await exec(['ffprobe', '-v', 'error', '-show_entries', probeEntries, '-of', 'json', path])
  if (result.code !== 0) throw new Error(`ffprobe failed for ${path}\n${result.stderr}`)
  const probe = probeOutputSchema.parse(JSON.parse(result.stdout))
  const video = probe.streams.find((stream) => stream.codec_type === 'video')
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio')
  const rotation = video?.side_data_list?.find((entry) => entry.rotation !== undefined)?.rotation ?? 0
  const swapped = Math.abs(rotation) % 180 === 90
  const width = video?.width ?? 0
  const height = video?.height ?? 0
  const frames = video?.nb_frames === undefined ? null : Number(video.nb_frames)
  return {
    durationMs: Math.round(Number(probe.format.duration ?? '0') * 1000),
    width,
    height,
    displayWidth: swapped ? height : width,
    displayHeight: swapped ? width : height,
    rotation,
    hasVideo: video !== undefined,
    hasAudio: audio !== undefined,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    frames: frames === null || Number.isNaN(frames) ? null : frames,
    sampleRate: audio?.sample_rate === undefined ? null : Number(audio.sample_rate),
    channels: audio?.channels ?? null,
  }
}
