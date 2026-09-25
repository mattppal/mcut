import type { EngineStore } from '@mcut/react'
import { getVoiceSource, type AssetRef, type ElementId, type Project } from '@mcut/timeline'
import { VOICE_MODEL, VOICE_SAMPLE_RATE, decodeWav, encodeWav, mixVoice } from '@mcut/voice'

export type StemStatus =
  | { state: 'idle' }
  | { state: 'processing'; progress: number; startedAt: number }
  | { state: 'ready'; url: string; processingMs: number }
  | { state: 'failed'; error: string }

type StemKey = `hash:${string}` | `src:${string}`

export type StemState = ReadonlyMap<StemKey, StemStatus>

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
  status: (asset: AssetRef) => StemStatus
  start: (asset: AssetRef) => void
  settled: (assets: readonly AssetRef[], options?: SettleOptions) => Promise<void>
  reconcile: (project: Project) => void
  ready: (project: Project, options?: SettleOptions) => Promise<ReadonlyMap<ElementId, string>>
  audioSources: (project: Project) => ReadonlyMap<ElementId, string>
}

export const IDLE: StemStatus = { state: 'idle' }

export function voicedElements(project: Project): { elementId: ElementId; asset: AssetRef; amount: number }[] {
  return project.tracks.flatMap((track) =>
    track.elements.flatMap((element) => {
      const voice = getVoiceSource(project, element)
      const asset = voice ? project.assets[voice.assetId] : undefined
      return voice && asset ? [{ elementId: element.id, asset, amount: voice.amount }] : []
    }),
  )
}

const stemKey = (asset: AssetRef): StemKey => (asset.hash ? `hash:${asset.hash}` : `src:${asset.src}`)

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
  const decoded = new Map<StemKey, { dry: Float32Array; wet: Float32Array }>()
  const mixes = new Map<string, string>()

  const status = (asset: AssetRef): StemStatus => state.get(stemKey(asset)) ?? IDLE

  const set = (key: StemKey, next: StemStatus): void => {
    state = new Map(state).set(key, next)
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
    const key = stemKey(asset)
    const current = status(asset).state
    if (current === 'processing' || current === 'ready') return
    const startedAt = Date.now()
    set(key, { state: 'processing', progress: 0, startedAt })
    prepare(asset, (progress) => set(key, { state: 'processing', progress, startedAt })).then(
      ({ dry, wet, wav }) => {
        decoded.set(key, { dry, wet })
        set(key, { state: 'ready', url: URL.createObjectURL(wav), processingMs: Date.now() - startedAt })
      },
      (error: unknown) => set(key, { state: 'failed', error: errorMessage(error) }),
    )
  }

  function settled(assets: readonly AssetRef[], { signal, onProgress }: SettleOptions = {}): Promise<void> {
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
        const stems = assets.map(status)
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
      if (!active.has(elementId) || status(asset).state === 'idle') start(asset)
    }
    active = new Set(voiced.map(({ elementId }) => elementId))
  }

  function srcFor(asset: AssetRef, amount: number): string | undefined {
    const key = stemKey(asset)
    const stem = state.get(key)
    const samples = decoded.get(key)
    if (stem?.state !== 'ready' || !samples) return undefined
    const percent = Math.round(amount * 100)
    if (percent >= 100) return stem.url
    const mixKey = `${key}@${percent}`
    const existing = mixes.get(mixKey)
    if (existing) return existing
    const url = URL.createObjectURL(wavBlob(mixVoice(samples.dry, samples.wet, percent / 100)))
    mixes.set(mixKey, url)
    return url
  }

  function audioSources(project: Project): ReadonlyMap<ElementId, string> {
    const sources = new Map<ElementId, string>()
    for (const { elementId, asset, amount } of voicedElements(project)) {
      const src = srcFor(asset, amount)
      if (src) sources.set(elementId, src)
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
    const assets = new Map(voicedElements(project).map(({ asset }) => [stemKey(asset), asset]))
    for (const asset of assets.values()) start(asset)
    await settled([...assets.values()], options)
    for (const asset of assets.values()) {
      const stem = status(asset)
      if (stem.state === 'failed') throw new Error(`Clean up voice failed for ${asset.name ?? asset.id}. ${stem.error}`)
    }
    return audioSources(project)
  }

  return { get: () => state, subscribe, status, start, settled, reconcile, ready, audioSources }
}
