import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { blocked, check, pass, poll, type Driver, type SurfaceContext, type View } from '../context.ts'
import { clips } from './core.ts'

const SUCCESS_TOAST = 'Captions added to the timeline'
const DOWNLOAD_TOAST = /^Downloading Whisper model… (\d+)% \(one-time, cached after this\)$/
const TRANSCRIBE_TOAST = /^Transcribing on this device… (\d+)%$/
const PROGRESS_TOASTS = [DOWNLOAD_TOAST, /^Loading Whisper model…$/, TRANSCRIBE_TOAST]
const QUIET_TOASTS = [/^Imported \d+ files?$/, /^AssemblyAI key (saved|removed)$/, /^Autosaved/]
const CAPTION_WORDS = /welcome|mcut|video/i
const MODEL_FILE = /\/onnx-community\/(whisper-[^/]+)\/resolve\/[^/]+\/(.+)$/
const ORT_FILE = /\/npm\/onnxruntime-web@[^/]+\/dist\/(.+)$/
const WHISPER_WAIT_MS = 840_000
const REMOTE_WAIT_MS = 120_000

const toastLogSchema = z.array(z.string())
const gateSchema = z.object({ gpu: z.boolean(), deviceMemory: z.number().nullable(), adapter: z.string(), userAgent: z.string() })
const cacheSchema = z.union([z.string(), z.array(z.string())])

type LeftTab = 'media' | 'text' | 'animate' | 'captions' | 'transcript'

const GATE_PROBE = `(async () => {
  const gpu = navigator.gpu
  const adapter = gpu === undefined
    ? 'navigator.gpu absent'
    : await gpu.requestAdapter().then((a) => (a === null ? 'requestAdapter() null' : 'adapter present'), (e) => 'requestAdapter() rejected ' + String(e))
  return { gpu: gpu !== undefined, deviceMemory: navigator.deviceMemory ?? null, adapter, userAgent: navigator.userAgent }
})()`

const CACHE_PROBE = `(async () => {
  if (!('caches' in window)) return 'caches API unavailable'
  const urls = []
  for (const name of await caches.keys()) {
    for (const request of await (await caches.open(name)).keys()) urls.push(name + ' ' + request.url)
  }
  return urls
})()`

const quote = (list: readonly string[]): string => list.map((item) => `"${item}"`).join(', ')

async function watchToasts(view: View): Promise<void> {
  await view.evaluate(() => {
    const root = document.documentElement
    if (root.dataset.mcutSmokeToasts !== undefined) return
    root.dataset.mcutSmokeToasts = '[]'
    const seen: string[] = []
    const shown = new WeakMap<Element, string>()
    const record = () => {
      let changed = false
      for (const item of document.querySelectorAll('section[aria-label^="Notifications"] li')) {
        const text = (item.querySelector('[data-title]') ?? item).textContent?.trim() ?? ''
        if (text.length === 0 || shown.get(item) === text) continue
        shown.set(item, text)
        seen.push(text)
        changed = true
      }
      if (changed) root.dataset.mcutSmokeToasts = JSON.stringify(seen)
    }
    new MutationObserver(record).observe(document.body, { subtree: true, childList: true, characterData: true })
    record()
  })
}

async function toastsSeen(view: View): Promise<string[]> {
  const raw: unknown = await view.evaluate(() => JSON.parse(document.documentElement.dataset.mcutSmokeToasts ?? '[]'))
  return toastLogSchema.parse(raw)
}

async function readGate(view: View) {
  const raw: unknown = await view.evaluate(GATE_PROBE)
  return gateSchema.parse(raw)
}

async function cachedModelFiles(view: View): Promise<string> {
  const raw: unknown = await view.evaluate(CACHE_PROBE)
  const cached = cacheSchema.parse(raw)
  if (typeof cached === 'string') return cached
  const onnx = cached.filter((url) => url.endsWith('.onnx'))
  return `Cache Storage holds ${cached.length} entr${cached.length === 1 ? 'y' : 'ies'}, ${onnx.length} of them .onnx`
}

async function openRailTab(view: View, tab: LeftTab): Promise<void> {
  const button = view.locator(`[data-rail-tab="${tab}"]`)
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
  const pressed = await poll(() => button.getAttribute('aria-pressed'), (value) => value === 'true', 5_000)
  check(pressed === 'true', `rail tab "${tab}" reads aria-pressed ${pressed}`)
}

const onDeviceSwitch = (view: View) => view.locator('label', { hasText: 'Transcribe on this device' }).getByRole('switch')
const captionClips = (view: View) => view.locator('[data-mcut-clip="caption"]')
const speechClip = (view: View, name: string) => view.locator(`[data-mcut-clip="video"][title="${name}"]`)
const captionTexts = (view: View): Promise<string[]> => captionClips(view).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('title') ?? ''))

async function setOnDevice(view: View, enabled: boolean): Promise<void> {
  const toggle = onDeviceSwitch(view)
  const wanted = String(enabled)
  if ((await toggle.getAttribute('aria-checked')) !== wanted) await toggle.click()
  const state = await poll(() => toggle.getAttribute('aria-checked'), (value) => value === wanted, 3_000)
  check(state === wanted, `"Transcribe on this device" switch reads aria-checked ${state} after switching it ${enabled ? 'on' : 'off'}`)
}

async function selectSpeechClip(ctx: SurfaceContext): Promise<string> {
  const name = path.basename(ctx.fixtures.speech)
  const clip = speechClip(ctx.view, name)
  check((await clip.count()) === 1, `timeline holds one "${name}" clip`)
  await clip.click()
  return name
}

interface AutoCaptionRun {
  toasts: string[]
  error: string | undefined
  captions: string[]
  ms: number
}

const isProgress = (text: string) => PROGRESS_TOASTS.some((pattern) => pattern.test(text))
const isQuiet = (text: string) => text === SUCCESS_TOAST || QUIET_TOASTS.some((pattern) => pattern.test(text))

async function runAutoCaption(view: View, timeoutMs: number): Promise<AutoCaptionRun> {
  const start = (await toastsSeen(view)).length
  const baseline = (await captionTexts(view)).length
  const button = view.getByRole('button', { name: /Auto-caption|Transcribing…/ }).first()
  const started = Date.now()
  await button.click()
  let sawPending = false
  const read = async () => {
    const toasts = (await toastsSeen(view)).slice(start)
    const label = await button.innerText({ timeout: 5_000 })
    if (label.includes('Transcribing')) sawPending = true
    const captions = await captionTexts(view)
    return {
      toasts,
      captions,
      error: toasts.find((text) => !isProgress(text) && !isQuiet(text)),
      settled: captions.length !== baseline || toasts.includes(SUCCESS_TOAST) || (sawPending && !label.includes('Transcribing')),
    }
  }
  const result = await poll(read, (value) => value.error !== undefined || value.settled, timeoutMs)
  return { toasts: result.toasts, error: result.error, captions: result.captions, ms: Date.now() - started }
}

function percentRange(toasts: readonly string[], pattern: RegExp): { updates: number; min: number; max: number } {
  const values = toasts.flatMap((text) => {
    const match = pattern.exec(text)
    return match === null ? [] : [Number(match[1])]
  })
  return { updates: values.length, min: Math.min(...values), max: Math.max(...values) }
}

function describeToasts(toasts: readonly string[]): string {
  const download = percentRange(toasts, DOWNLOAD_TOAST)
  const transcribe = percentRange(toasts, TRANSCRIBE_TOAST)
  const rest = toasts.filter((text) => !DOWNLOAD_TOAST.test(text) && !TRANSCRIBE_TOAST.test(text))
  const parts = [
    download.updates > 0 ? `"Downloading Whisper model… N% (one-time, cached after this)" ${download.updates} update(s) from ${download.min}% to ${download.max}%` : 'no Downloading toast',
    transcribe.updates > 0 ? `"Transcribing on this device… N%" ${transcribe.updates} update(s) from ${transcribe.min}% to ${transcribe.max}%` : 'no Transcribing toast',
    rest.length > 0 ? `other toasts ${quote(rest)}` : 'no other toasts',
  ]
  return parts.join(', ')
}

function describeUpstream(urls: readonly string[]): { model: string | null; onnx: string[]; summary: string } {
  const models = new Set<string>()
  const files = new Set<string>()
  const ort = new Set<string>()
  const hosts = new Set<string>()
  for (const url of urls) {
    const { hostname, pathname } = new URL(url)
    hosts.add(hostname)
    const model = MODEL_FILE.exec(pathname)
    if (model !== null) {
      models.add(model[1] ?? '')
      files.add(model[2] ?? '')
    }
    const wasm = ORT_FILE.exec(pathname)
    if (wasm !== null) ort.add(wasm[1] ?? '')
  }
  const onnx = [...files].filter((file) => file.endsWith('.onnx'))
  const summary = `${urls.length} upstream request(s) to ${[...hosts].join(', ') || 'no host'}, model ${[...models].join(', ') || 'none'}, files ${[...files].join(', ') || 'none'}, ORT ${[...ort].join(', ') || 'none'}`
  return { model: [...models][0] ?? null, onnx, summary }
}

const captionsOnDevice: Driver = async (ctx) => {
  const { view } = ctx
  await watchToasts(view)
  await openRailTab(view, 'media')
  const name = path.basename(ctx.fixtures.speech)
  const before = await clips(view).count()
  await ctx.importFile(ctx.fixtures.speech)
  const card = view.getByTitle(name).first()
  await card.waitFor({ state: 'visible', timeout: 15_000 })
  await card.dblclick()
  const after = await poll(() => clips(view).count(), (count) => count === before + 1, 15_000)
  check(after === before + 1, `${before} clip(s) became ${after} after double-clicking the "${name}" card`)
  await selectSpeechClip(ctx)
  await openRailTab(view, 'captions')
  await view.getByRole('button', { name: /Auto-caption|Transcribing…/ }).first().waitFor({ state: 'visible', timeout: 10_000 })
  const gate = await readGate(view)
  const gateText = `navigator.gpu ${gate.gpu ? 'present' : 'absent'}, deviceMemory ${gate.deviceMemory ?? 'undefined'}, ${gate.adapter}`
  ctx.log(`gate: ${gateText}, ${gate.userAgent}`)
  if ((await onDeviceSwitch(view).count()) === 0) {
    if (!gate.gpu) return blocked(`WebGPU gate hides the "Transcribe on this device" switch, ${gateText}, ${gate.userAgent}`)
    throw new Error(`the "Transcribe on this device" switch is absent from the Captions panel although ${gateText}`)
  }
  await setOnDevice(view, true)
  await ctx.upstreamRequests()
  if (ctx.whisper.mode === 'offline') {
    const run = await runAutoCaption(view, 90_000)
    ctx.log(`offline toasts: ${quote(run.toasts)}`)
    const seen = run.error === undefined ? `no error toast within ${run.ms} ms, toasts ${quote(run.toasts)}` : `the user sees the toast "${run.error}" after ${run.ms} ms`
    return blocked(`${ctx.whisper.reason}; ${seen}; ${describeUpstream(await ctx.upstreamRequests()).summary}`)
  }
  const run = await runAutoCaption(view, WHISPER_WAIT_MS)
  ctx.log(`toasts: ${quote(run.toasts)}`)
  const upstream = describeUpstream(await ctx.upstreamRequests())
  ctx.log(upstream.summary)
  if (run.error !== undefined) throw new Error(`Auto-caption failed with the toast "${run.error}" after ${run.ms} ms, ${describeToasts(run.toasts)}, ${upstream.summary}`)
  check(run.captions.length > 0, `${run.captions.length} caption clip(s) on the timeline after ${run.ms} ms, ${describeToasts(run.toasts)}`)
  const rows = await view.getByTitle('Delete caption').count()
  check(rows === run.captions.length, `${rows} caption row(s) in the panel for ${run.captions.length} caption clip(s)`)
  check(run.captions.some((text) => CAPTION_WORDS.test(text)), `caption text ${quote(run.captions)} contains welcome, mcut or video`)
  check(upstream.onnx.length > 0, `upstream requests name the model files (${upstream.summary})`)
  const observed = `${run.captions.length} caption(s) ${quote(run.captions)} in ${run.ms} ms, ${describeToasts(run.toasts)}, ${upstream.summary}, ${gateText}, ${await cachedModelFiles(view)}`
  const download = percentRange(run.toasts, DOWNLOAD_TOAST)
  if (download.updates > 0 && download.max > 0) return pass(observed)
  if (ctx.whisper.mode === 'mirror') {
    return blocked(`the Downloading toast never showed a percentage although ${upstream.onnx.length} .onnx file(s) came from the mirror at ${ctx.whisper.url}, so the model arrived within one render frame and download progress cannot be judged here; ${observed}`)
  }
  throw new Error(`the Downloading toast never showed a percentage while ${upstream.onnx.length} .onnx file(s) downloaded from the network; ${observed}`)
}

const captionsOnDeviceCached: Driver = async (ctx) => {
  if (ctx.whisper.mode === 'offline') return blocked(ctx.whisper.reason)
  const { view } = ctx
  await watchToasts(view)
  await openRailTab(view, 'captions')
  const before = await captionClips(view).count()
  check(before > 0, `${before} caption clip(s) on the timeline before Undo`)
  await view.getByRole('button', { name: 'Undo' }).click()
  const cleared = await poll(() => captionClips(view).count(), (count) => count === 0, 5_000)
  check(cleared === 0, `${before} caption clip(s) became ${cleared} after Undo`)
  await selectSpeechClip(ctx)
  await setOnDevice(view, true)
  await ctx.upstreamRequests()
  const run = await runAutoCaption(view, 170_000)
  ctx.log(`toasts: ${quote(run.toasts)}`)
  const upstream = describeUpstream(await ctx.upstreamRequests())
  ctx.log(upstream.summary)
  if (run.error !== undefined) throw new Error(`second Auto-caption failed with the toast "${run.error}" after ${run.ms} ms, ${describeToasts(run.toasts)}, ${upstream.summary}`)
  check(run.captions.length > 0, `${run.captions.length} caption clip(s) after the second Auto-caption, ${describeToasts(run.toasts)}`)
  check(upstream.onnx.length === 0, `upstream .onnx requests during the cached run: ${upstream.onnx.join(', ') || 'none'} (${upstream.summary})`)
  return pass(`${run.captions.length} caption(s) ${quote(run.captions)} again in ${run.ms} ms with ${upstream.summary}, ${describeToasts(run.toasts)}, ${await cachedModelFiles(view)}`)
}

const captionsAssemblyAi: Driver = async (ctx) => {
  const { view } = ctx
  await watchToasts(view)
  await openRailTab(view, 'captions')
  const field = view.locator('[data-slot="transcription-key-field"]')
  check((await field.count()) === 1, `the AssemblyAI key field is present on the ${ctx.surface} surface`)
  if ((await onDeviceSwitch(view).count()) > 0) await setOnDevice(view, false)
  const key = ctx.assemblyAiKey ?? `smoke-invalid-${Date.now()}`
  await field.getByLabel('AssemblyAI API key').fill(key)
  await field.getByRole('button', { name: 'Save' }).click()
  await view.getByText('AssemblyAI key saved').waitFor({ state: 'visible', timeout: 10_000 })
  await field.getByText('Configured', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 })
  await selectSpeechClip(ctx)
  const run = await runAutoCaption(view, REMOTE_WAIT_MS)
  ctx.log(`toasts: ${quote(run.toasts)}`)
  const outcome =
    ctx.assemblyAiKey === null
      ? check(
          run.error !== undefined && !/^Failed to fetch$/i.test(run.error) && !/\b404\b/.test(run.error) && !/^Transcription failed(?: \(\d+\))?$/.test(run.error),
          run.error === undefined
            ? `an error toast names the failure for an invalid key (none within ${run.ms} ms, toasts ${quote(run.toasts)})`
            : `toast "${run.error}" after ${run.ms} ms names the failure for an invalid key`,
        )
      : check(run.error === undefined && run.captions.length > 0, `${run.captions.length} caption(s) ${quote(run.captions)} from AssemblyAI after ${run.ms} ms${run.error === undefined ? '' : `, toast "${run.error}"`}`)
  await field.getByRole('button', { name: 'Remove' }).click()
  await view.getByText('AssemblyAI key removed').waitFor({ state: 'visible', timeout: 10_000 })
  await field.getByText('Configured', { exact: true }).waitFor({ state: 'hidden', timeout: 5_000 })
  return pass(`"AssemblyAI key saved" and Configured after Save, ${outcome}, "AssemblyAI key removed" and no Configured after Remove`)
}

async function downloadSubtitles(ctx: SurfaceContext, format: 'SRT' | 'VTT'): Promise<string> {
  const pending = ctx.nextDownload(20_000)
  await ctx.view.waitForTimeout(300)
  await ctx.view.getByRole('button', { name: format, exact: true }).click()
  const file = await pending
  const firstLine = (await readFile(file.path, 'utf8')).split(/\r?\n/)[0] ?? ''
  const expected = format === 'SRT' ? '1' : 'WEBVTT'
  return check(file.bytes > 0 && firstLine === expected, `${path.basename(file.path)} has ${file.bytes} bytes and starts with "${firstLine}"`)
}

const captionsExport: Driver = async (ctx) => {
  await openRailTab(ctx.view, 'captions')
  const count = await captionClips(ctx.view).count()
  check(count > 0, `${count} caption clip(s) on the timeline before export`)
  const srt = await downloadSubtitles(ctx, 'SRT')
  const vtt = await downloadSubtitles(ctx, 'VTT')
  return pass(`${count} caption(s), ${srt}, ${vtt}`)
}

const transcriptPanel: Driver = async ({ view }) => {
  await openRailTab(view, 'transcript')
  const search = view.getByPlaceholder('Find in transcript…')
  await search.waitFor({ state: 'visible', timeout: 10_000 })
  const heading = (await view.getByText('Transcript', { exact: true }).first().textContent()) ?? ''
  check(heading === 'Transcript', `panel heading reads "${heading}"`)
  const captions = await captionTexts(view)
  if (captions.length === 0) {
    const empty = view.getByText('No transcript yet. Auto-caption a clip in the Captions tab first.')
    await empty.waitFor({ state: 'visible', timeout: 5_000 })
    return pass(`heading "${heading}", empty state "${await empty.innerText()}" with no captions on the timeline`)
  }
  const rows = await view.getByTitle('Seek to caption').count()
  check(rows === captions.length, `${rows} transcript row(s) for ${captions.length} caption clip(s)`)
  const word = captions.flatMap((text) => text.split(/\s+/)).find((candidate) => /^[a-z]{4,}$/i.test(candidate)) ?? ''
  await search.fill(word)
  const counterSpan = search.locator('..').locator('xpath=following-sibling::span[1]')
  const counter = await poll(() => counterSpan.innerText({ timeout: 2_000 }), (text) => /^\d+\/[1-9]\d*$/.test(text), 5_000)
  await search.fill('')
  return pass(check(/^\d+\/[1-9]\d*$/.test(counter), `heading "${heading}", ${rows} row(s), searching "${word}" shows the match counter "${counter}"`))
}

export const CAPTION_DRIVERS = {
  'captions-on-device': captionsOnDevice,
  'captions-on-device-cached': captionsOnDeviceCached,
  'captions-assemblyai': captionsAssemblyAi,
  'captions-export': captionsExport,
  'transcript-panel': transcriptPanel,
} satisfies Partial<Record<string, Driver | null>>
