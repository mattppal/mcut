import type { EngineStore } from '@mcut/react'
import { getVoiceSource, type AssetRef, type ElementId, type Project } from '@mcut/timeline'
import { VOICE_MODEL, VOICE_SAMPLE_RATE, decodeWav, encodeWav, mixVoice } from '@mcut/voice'

export type StemStatus =
  | { state: 'idle' }
  | { state: 'processing'; progress: number; startedAt: number }
  | { state: 'ready'; url: string; processingMs: number }
  | { state: 'failed'; error: string }

type StemKey = `hash:${string}` | `src:${string}`

type Stem =
  | { state: 'processing'; progress: number; startedAt: number; job: AbortController }
  | { state: 'ready'; url: string; processingMs: number; dry: Float32Array; wet: Float32Array; mixes: Map<number, string> }
  | { state: 'failed'; error: string }

export type StemState = ReadonlyMap<StemKey, StemStatus>

export interface VoiceStemDeps {
  decode: (src: string) => Promise<Float32Array>
  clean: (samples: Float32Array, onProgress: (progress: number) => void, signal: AbortSignal) => Promise<Float32Array>
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
  let state: ReadonlyMap<StemKey, Stem> = new Map()
  let active: ReadonlySet<ElementId> = new Set()
  let live: ReadonlySet<StemKey> = new Set()
  const waits = new Set<ReadonlySet<StemKey>>()
  const listeners = new Set<(state: StemState) => void>()

  const status = (asset: AssetRef): StemStatus => state.get(stemKey(asset)) ?? IDLE

  const replace = (next: ReadonlyMap<StemKey, Stem>): void => {
    state = next
    for (const listener of listeners) listener(state)
  }

  const set = (key: StemKey, stem: Stem): void => replace(new Map(state).set(key, stem))

  const unwanted = (key: StemKey): boolean => !live.has(key) && ![...waits].some((keys) => keys.has(key))

  function release(key: StemKey): void {
    const stem = state.get(key)
    if (!stem) return
    if (stem.state === 'processing') stem.job.abort()
    if (stem.state === 'ready') for (const url of [stem.url, ...stem.mixes.values()]) URL.revokeObjectURL(url)
    const next = new Map(state)
    next.delete(key)
    replace(next)
  }

  const subscribe = (listener: (state: StemState) => void) => {
    listeners.add(listener)
    return { unsubscribe: () => void listeners.delete(listener) }
  }

  async function prepare(asset: AssetRef, signal: AbortSignal, onProgress: (progress: number) => void) {
    const dry = await deps.decode(asset.src)
    const name = await stemName(asset)
    const cached = await deps.load(name)
    if (cached) {
      const wet = decodeWav(new Uint8Array(await cached.arrayBuffer())).samples
      if (wet.length === dry.length) return { dry, wet, wav: cached }
    }
    const wet = await deps.clean(dry, onProgress, signal)
    const wav = wavBlob(wet)
    await deps.save(name, wav)
    return { dry, wet, wav }
  }

  function start(asset: AssetRef): void {
    const key = stemKey(asset)
    const current = state.get(key)?.state
    if (current === 'processing' || current === 'ready') return
    const job = new AbortController()
    const startedAt = Date.now()
    const owns = (): boolean => {
      const stem = state.get(key)
      return stem?.state === 'processing' && stem.job === job
    }
    set(key, { state: 'processing', progress: 0, startedAt, job })
    prepare(asset, job.signal, (progress) => {
      if (owns()) set(key, { state: 'processing', progress, startedAt, job })
    }).then(
      ({ dry, wet, wav }) => {
        if (owns()) set(key, { state: 'ready', url: URL.createObjectURL(wav), processingMs: Date.now() - startedAt, dry, wet, mixes: new Map() })
      },
      (error: unknown) => {
        if (owns()) set(key, { state: 'failed', error: errorMessage(error) })
      },
    )
  }

  function settled(assets: readonly AssetRef[], { signal, onProgress }: SettleOptions = {}): Promise<void> {
    const keys: ReadonlySet<StemKey> = new Set(assets.map(stemKey))
    return new Promise((resolve, reject) => {
      const subscription = subscribe(check)
      waits.add(keys)
      function finish(): void {
        subscription.unsubscribe()
        signal?.removeEventListener('abort', abort)
        waits.delete(keys)
      }
      function abort(): void {
        finish()
        for (const key of keys) if (unwanted(key)) release(key)
        reject(signal?.reason)
      }
      function check(): void {
        const stems = [...keys].map((key) => state.get(key) ?? IDLE)
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
    live = new Set(voiced.map(({ asset }) => stemKey(asset)))
    for (const key of state.keys()) if (unwanted(key)) release(key)
    for (const { elementId, asset } of voiced) {
      if (!active.has(elementId) || status(asset).state === 'idle') start(asset)
    }
    active = new Set(voiced.map(({ elementId }) => elementId))
  }

  function srcFor(asset: AssetRef, amount: number): string | undefined {
    const stem = state.get(stemKey(asset))
    if (stem?.state !== 'ready') return undefined
    const percent = Math.round(amount * 100)
    if (percent >= 100) return stem.url
    const existing = stem.mixes.get(percent)
    if (existing) return existing
    const url = URL.createObjectURL(wavBlob(mixVoice(stem.dry, stem.wet, percent / 100)))
    stem.mixes.set(percent, url)
    return url
  }

  function audioSources(project: Project): ReadonlyMap<ElementId, string> {
    const sources = new Map<ElementId, string>()
    for (const { elementId, asset, amount } of voicedElements(project)) {
      const src = srcFor(asset, amount)
      if (src) sources.set(elementId, src)
    }
    const used = new Set(sources.values())
    for (const stem of state.values()) {
      if (stem.state !== 'ready') continue
      for (const [percent, url] of stem.mixes) {
        if (used.has(url)) continue
        URL.revokeObjectURL(url)
        stem.mixes.delete(percent)
      }
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
