import type { EngineStore } from '@mcut/react'
import { getVoiceSource, type AssetId, type AssetRef, type ElementId, type Project } from '@mcut/timeline'
import { VOICE_MODEL, VOICE_SAMPLE_RATE, decodeWav, encodeWav, mixVoice } from '@mcut/voice'

export type StemStatus =
  | { state: 'idle' }
  | { state: 'processing'; progress: number; startedAt: number }
  | { state: 'ready'; url: string; processingMs: number }
  | { state: 'failed'; error: string }

export type StemState = ReadonlyMap<AssetId, StemStatus>

export interface VoiceStemDeps {
  decode: (src: string) => Promise<Float32Array>
  clean: (samples: Float32Array, onProgress: (progress: number) => void) => Promise<Float32Array>
  load: (name: string) => Promise<Blob | null>
  save: (name: string, wav: Blob) => Promise<void>
}

export interface SettleOptions {
  signal?: AbortSignal
  onProgress?: (progress: number) => void
}

export interface VoiceStems extends EngineStore<StemState> {
  status: (assetId: AssetId) => StemStatus
  start: (asset: AssetRef) => void
  settled: (assetIds: readonly AssetId[], options?: SettleOptions) => Promise<void>
  reconcile: (project: Project) => void
  ready: (project: Project, options?: SettleOptions) => Promise<ReadonlyMap<ElementId, string>>
  audioSources: (project: Project) => ReadonlyMap<ElementId, string>
}

export const IDLE: StemStatus = { state: 'idle' }

export function voicedElements(project: Project): { elementId: ElementId; asset: AssetRef }[] {
  return project.tracks.flatMap((track) =>
    track.elements.flatMap((element) => {
      const voice = getVoiceSource(project, element)
      const asset = voice ? project.assets[voice.assetId] : undefined
      return asset ? [{ elementId: element.id, asset }] : []
    }),
  )
}

async function stemName(asset: AssetRef): Promise<string> {
  if (asset.hash) return `voice-${VOICE_MODEL}-${asset.hash}.wav`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(asset.src))
  return `voice-${VOICE_MODEL}-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}.wav`
}

const wavBlob = (samples: Float32Array): Blob => new Blob([encodeWav(samples, VOICE_SAMPLE_RATE)], { type: 'audio/wav' })

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export function createVoiceStems(deps: VoiceStemDeps): VoiceStems {
  let state: StemState = new Map()
  let active: ReadonlySet<ElementId> = new Set()
  const listeners = new Set<(state: StemState) => void>()
  const decoded = new Map<AssetId, { dry: Float32Array; wet: Float32Array }>()
  const mixes = new Map<string, string>()

  const status = (assetId: AssetId): StemStatus => state.get(assetId) ?? IDLE

  const set = (assetId: AssetId, next: StemStatus): void => {
    state = new Map(state).set(assetId, next)
    for (const listener of listeners) listener(state)
  }

  const subscribe = (listener: (state: StemState) => void) => {
    listeners.add(listener)
    return { unsubscribe: () => void listeners.delete(listener) }
  }

  async function prepare(asset: AssetRef, onProgress: (progress: number) => void) {
    const dry = await deps.decode(asset.src)
    const name = await stemName(asset)
    const cached = await deps.load(name)
    if (cached) {
      const wet = decodeWav(new Uint8Array(await cached.arrayBuffer())).samples
      if (wet.length === dry.length) return { dry, wet, wav: cached }
    }
    const wet = await deps.clean(dry, onProgress)
    const wav = wavBlob(wet)
    await deps.save(name, wav)
    return { dry, wet, wav }
  }

  function start(asset: AssetRef): void {
    const current = status(asset.id).state
    if (current === 'processing' || current === 'ready') return
    const startedAt = Date.now()
    set(asset.id, { state: 'processing', progress: 0, startedAt })
    prepare(asset, (progress) => set(asset.id, { state: 'processing', progress, startedAt })).then(
      ({ dry, wet, wav }) => {
        decoded.set(asset.id, { dry, wet })
        set(asset.id, { state: 'ready', url: URL.createObjectURL(wav), processingMs: Date.now() - startedAt })
      },
      (error: unknown) => set(asset.id, { state: 'failed', error: errorMessage(error) }),
    )
  }

  function settled(assetIds: readonly AssetId[], { signal, onProgress }: SettleOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const subscription = subscribe(check)
      function finish(): void {
        subscription.unsubscribe()
        signal?.removeEventListener('abort', abort)
      }
      function abort(): void {
        finish()
        reject(signal?.reason)
      }
      function check(): void {
        const stems = assetIds.map(status)
        if (stems.every((stem) => stem.state !== 'processing')) {
          finish()
          resolve()
          return
        }
        onProgress?.(stems.reduce((sum, stem) => sum + (stem.state === 'processing' ? stem.progress : 1), 0) / stems.length)
      }
      if (signal?.aborted) return abort()
      signal?.addEventListener('abort', abort, { once: true })
      check()
    })
  }

  function reconcile(project: Project): void {
    const voiced = voicedElements(project)
    for (const { elementId, asset } of voiced) {
      if (!active.has(elementId) || status(asset.id).state === 'idle') start(asset)
    }
    active = new Set(voiced.map(({ elementId }) => elementId))
  }

  function srcFor(assetId: AssetId, amount: number): string | undefined {
    const stem = status(assetId)
    const samples = decoded.get(assetId)
    if (stem.state !== 'ready' || !samples) return undefined
    const percent = Math.round(amount * 100)
    if (percent >= 100) return stem.url
    const key = `${assetId}@${percent}`
    const existing = mixes.get(key)
    if (existing) return existing
    const url = URL.createObjectURL(wavBlob(mixVoice(samples.dry, samples.wet, percent / 100)))
    mixes.set(key, url)
    return url
  }

  function audioSources(project: Project): ReadonlyMap<ElementId, string> {
    const sources = new Map<ElementId, string>()
    for (const track of project.tracks) {
      for (const element of track.elements) {
        const voice = getVoiceSource(project, element)
        const src = voice ? srcFor(voice.assetId, voice.amount) : undefined
        if (src) sources.set(element.id, src)
      }
    }
    const live = new Set(sources.values())
    for (const [key, url] of mixes) {
      if (live.has(url)) continue
      URL.revokeObjectURL(url)
      mixes.delete(key)
    }
    return sources
  }

  async function ready(project: Project, options?: SettleOptions): Promise<ReadonlyMap<ElementId, string>> {
    const assets = new Map(voicedElements(project).map(({ asset }) => [asset.id, asset]))
    for (const asset of assets.values()) start(asset)
    await settled([...assets.keys()], options)
    for (const asset of assets.values()) {
      const stem = status(asset.id)
      if (stem.state === 'failed') throw new Error(`Clean up voice failed for ${asset.name ?? asset.id}. ${stem.error}`)
    }
    return audioSources(project)
  }

  return { get: () => state, subscribe, status, start, settled, reconcile, ready, audioSources }
}
