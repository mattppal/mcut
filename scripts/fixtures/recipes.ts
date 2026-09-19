export type Container = 'mp4' | 'mov' | 'webm' | 'mkv' | 'm4a' | 'ogg' | 'mp3' | 'wav' | 'flac'
export type VideoCodec = 'h264' | 'hevc' | 'vp9' | 'av1' | 'prores'
export type AudioCodec = 'aac' | 'opus' | 'mp3' | 'pcm_s16le' | 'flac'
export type Rotation = 0 | 90 | 180 | 270

export interface FixtureTone {
  hz: number
  gain: number
  beepGain: number
  beepMs: number
  beepEveryMs: number
}

export interface SilenceGap {
  startMs: number
  endMs: number
}

export interface FixtureExpected {
  durationMs: number
  width: number
  height: number
  hasVideo: boolean
  hasAudio: boolean
  tolerance: number
}

export interface FixtureRecipe {
  id: string
  container: Container
  videoCodec: VideoCodec | null
  audioCodec: AudioCodec | null
  width: number
  height: number
  fps: number | 'vfr'
  durationMs: number
  frameCounter: boolean
  tone: FixtureTone | null
  silenceGaps: SilenceGap[]
  sampleRate: number
  channels: number
  rotation: Rotation
  stillImage: boolean
  expected: FixtureExpected
}

export const containerExtension: Record<Container, string> = {
  mp4: 'mp4',
  mov: 'mov',
  webm: 'webm',
  mkv: 'mkv',
  m4a: 'm4a',
  ogg: 'ogg',
  mp3: 'mp3',
  wav: 'wav',
  flac: 'flac',
}

export const VFR_SCHEDULE = { firstFps: 30, secondFps: 10, framesPerSegment: 30 }

const beepTone: FixtureTone = { hz: 440, gain: 0.2, beepGain: 0.8, beepMs: 100, beepEveryMs: 1000 }

const speechGaps: SilenceGap[] = [
  { startMs: 1000, endMs: 1800 },
  { startMs: 3200, endMs: 4400 },
]

type RecipeKey = 'id' | 'container' | 'videoCodec' | 'audioCodec'
type RecipeInput = Pick<FixtureRecipe, RecipeKey> &
  Partial<Omit<FixtureRecipe, RecipeKey | 'expected'> & { expected: Partial<FixtureExpected> }>

function recipe(input: RecipeInput): FixtureRecipe {
  const width = input.width ?? 640
  const height = input.height ?? 360
  const durationMs = input.durationMs ?? 3000
  const rotation = input.rotation ?? 0
  const swapped = rotation === 90 || rotation === 270
  const hasVideo = input.videoCodec !== null
  return {
    id: input.id,
    container: input.container,
    videoCodec: input.videoCodec,
    audioCodec: input.audioCodec,
    width,
    height,
    fps: input.fps ?? 30,
    durationMs,
    frameCounter: input.frameCounter ?? false,
    tone: input.tone ?? null,
    silenceGaps: input.silenceGaps ?? [],
    sampleRate: input.sampleRate ?? 48_000,
    channels: input.channels ?? 1,
    rotation,
    stillImage: input.stillImage ?? false,
    expected: {
      durationMs,
      width: hasVideo ? (swapped ? height : width) : 0,
      height: hasVideo ? (swapped ? width : height) : 0,
      hasVideo,
      hasAudio: input.audioCodec !== null,
      tolerance: 50,
      ...input.expected,
    },
  }
}

const counter = (id: string, container: Container, videoCodec: VideoCodec, audioCodec: AudioCodec) =>
  recipe({ id, container, videoCodec, audioCodec, frameCounter: true, tone: beepTone })

const gaps = (id: string, container: Container, audioCodec: AudioCodec, sampleRate: number, channels: number) =>
  recipe({ id, container, videoCodec: null, audioCodec, durationMs: 6000, silenceGaps: speechGaps, sampleRate, channels })

export const recipes: readonly FixtureRecipe[] = [
  counter('counter-h264-mp4', 'mp4', 'h264', 'aac'),
  counter('counter-hevc-mp4', 'mp4', 'hevc', 'aac'),
  counter('counter-vp9-webm', 'webm', 'vp9', 'opus'),
  counter('counter-vp9-mkv', 'mkv', 'vp9', 'opus'),
  counter('counter-av1-mkv', 'mkv', 'av1', 'opus'),
  recipe({ id: 'counter-prores-mov', container: 'mov', videoCodec: 'prores', audioCodec: 'pcm_s16le', durationMs: 2000, frameCounter: true, tone: beepTone }),

  gaps('gaps-aac-m4a', 'm4a', 'aac', 44_100, 2),
  gaps('gaps-opus-ogg', 'ogg', 'opus', 48_000, 1),
  gaps('gaps-opus-webm', 'webm', 'opus', 48_000, 2),
  gaps('gaps-mp3', 'mp3', 'mp3', 48_000, 2),
  gaps('gaps-pcm-wav', 'wav', 'pcm_s16le', 48_000, 1),
  gaps('gaps-flac', 'flac', 'flac', 48_000, 2),
  gaps('gaps-8k-mono-wav', 'wav', 'pcm_s16le', 8000, 1),

  recipe({ id: 'vfr-h264-mp4', container: 'mp4', videoCodec: 'h264', audioCodec: null, width: 320, height: 180, fps: 'vfr', durationMs: 3933, frameCounter: true, expected: { tolerance: 100 } }),
  recipe({ id: 'odd-361x203-vp9-webm', container: 'webm', videoCodec: 'vp9', audioCodec: null, width: 361, height: 203, durationMs: 2000 }),
  recipe({ id: 'tiny-1x1-vp9-webm', container: 'webm', videoCodec: 'vp9', audioCodec: null, width: 1, height: 1, fps: 25, durationMs: 1000 }),
  recipe({ id: 'portrait-360x640-h264-mp4', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', width: 360, height: 640, durationMs: 2000, frameCounter: true, tone: beepTone }),
  recipe({ id: 'one-frame-h264-mp4', container: 'mp4', videoCodec: 'h264', audioCodec: null, width: 320, height: 180, fps: 25, durationMs: 40, frameCounter: true, expected: { tolerance: 10 } }),
  recipe({ id: 'long-10min-h264-mp4', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', width: 160, height: 90, fps: 5, durationMs: 600_000, frameCounter: true, tone: beepTone, sampleRate: 16_000, expected: { tolerance: 100 } }),
  recipe({ id: 'no-audio-h264-mp4', container: 'mp4', videoCodec: 'h264', audioCodec: null, durationMs: 2000, frameCounter: true }),
  recipe({ id: 'audio-only-aac-mp4', container: 'mp4', videoCodec: null, audioCodec: 'aac', durationMs: 2000, tone: beepTone, sampleRate: 44_100, channels: 2 }),
  recipe({ id: 'rotate90-h264-mp4', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', durationMs: 2000, frameCounter: true, tone: beepTone, rotation: 90 }),
  recipe({ id: 'surround-5-1-aac-m4a', container: 'm4a', videoCodec: null, audioCodec: 'aac', durationMs: 2000, tone: beepTone, channels: 6 }),
  recipe({ id: 'still-image-h264-mp4', container: 'mp4', videoCodec: 'h264', audioCodec: null, fps: 25, durationMs: 2000, stillImage: true }),
]
