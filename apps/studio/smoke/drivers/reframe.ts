import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { blocked, check, pass, poll, type Driver, type SurfaceContext, type View } from '../context.ts'
import { percentRange, toastsSeen, watchToasts } from './captions.ts'
import { clips } from './core.ts'
import { openRailTab } from './edit.ts'
import { saveThroughMenu } from './project.ts'

const SUCCESS_TOAST = 'Person centered'
const DOWNLOAD_TOAST = /^Downloading face model… (\d+)% \(one-time, cached after this\)$/
const DETECT_TOAST = /^Finding the person… (\d+)%$/
const QUIET_TOASTS = [/^Imported \d+ files?$/, /^Autosaved/]
const MODEL_DOWNLOAD_ERROR = /^Could not download the face detection model/
const MODEL_FILE = 'face_detection_yunet_2023mar.onnx'
const TARGET_ASPECT = 9 / 16
const MIN_TRAVEL = 0.3
const CENTER_WAIT_MS = 150_000

const keySchema = z.object({ sourceMs: z.number(), x: z.number(), y: z.number() })
const savedProjectSchema = z.object({
  assets: z.record(z.string(), z.object({ name: z.string().optional(), width: z.number().optional(), height: z.number().optional() })),
  tracks: z.array(
    z.object({
      elements: z.array(
        z.object({
          type: z.string(),
          assetId: z.string().optional(),
          crop: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
          reframe: z.array(keySchema).optional(),
        }),
      ),
    }),
  ),
})

const isError = (text: string): boolean =>
  text !== SUCCESS_TOAST && !DOWNLOAD_TOAST.test(text) && !DETECT_TOAST.test(text) && !QUIET_TOASTS.some((pattern) => pattern.test(text))

async function faceModelCached(view: View): Promise<boolean> {
  const raw: unknown = await view.evaluate(async (file) => {
    if (!('caches' in window)) return false
    for (const name of await caches.keys()) {
      const requests = await (await caches.open(name)).keys()
      if (requests.some((request) => request.url.endsWith(`/${file}`))) return true
    }
    return false
  }, MODEL_FILE)
  return z.boolean().parse(raw)
}

function describeToasts(toasts: readonly string[]): string {
  const download = percentRange(toasts, DOWNLOAD_TOAST)
  const detect = percentRange(toasts, DETECT_TOAST)
  const rest = toasts.filter((text) => !DOWNLOAD_TOAST.test(text) && !DETECT_TOAST.test(text))
  return [
    download.updates > 0 ? `"Downloading face model… N%" ${download.updates} update(s) from ${download.min}% to ${download.max}%` : 'no Downloading toast',
    detect.updates > 0 ? `"Finding the person… N%" ${detect.updates} update(s) from ${detect.min}% to ${detect.max}%` : 'no Finding toast',
    rest.length > 0 ? `then ${rest.map((text) => `"${text}"`).join(', ')}` : 'no other toast',
  ].join(', ')
}

async function placeFaceClip(ctx: SurfaceContext): Promise<string> {
  const { view } = ctx
  const name = path.basename(ctx.fixtures.face)
  await openRailTab(view, 'media')
  const before = await clips(view).count()
  await ctx.importFile(ctx.fixtures.face)
  const card = view.getByTitle(name).first()
  await card.getByText('0:05', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
  await card.dblclick()
  const after = await poll(
    () => clips(view).count(),
    (count) => count === before + 1,
    15_000,
  )
  check(after === before + 1, `${before} clip(s) became ${after} after double-clicking the "${name}" card`)
  return name
}

async function centerFromClipMenu(view: View, name: string) {
  const clip = view.locator(`[data-mcut-clip="video"][title="${name}"]`)
  check((await clip.count()) === 1, `timeline holds one "${name}" video clip`)
  await clip.click({ button: 'right' })
  await view.getByRole('menuitem', { name: 'Center person…' }).click()
  const dialog = view.getByRole('dialog')
  await dialog.getByRole('heading', { name: 'Center person' }).waitFor({ state: 'visible', timeout: 5_000 })
  await dialog.getByRole('group', { name: 'Aspect' }).getByRole('button', { name: '9:16', exact: true }).click()
  const smoothing = await dialog.getByRole('group', { name: 'Smoothing' }).getByRole('button', { pressed: true }).innerText()
  const start = (await toastsSeen(view)).length
  const started = Date.now()
  await dialog.getByRole('button', { name: 'Center person', exact: true }).click()
  const toasts = await poll(
    async () => (await toastsSeen(view)).slice(start),
    (seen) => seen.some((text) => text === SUCCESS_TOAST || isError(text)),
    CENTER_WAIT_MS,
  )
  return { smoothing, toasts, error: toasts.find(isError), ms: Date.now() - started }
}

async function readCenteredClip(file: string, name: string) {
  const project = savedProjectSchema.parse(JSON.parse(await readFile(file, 'utf8')))
  const matches = project.tracks
    .flatMap((track) => track.elements)
    .flatMap((element) => {
      const asset = element.type === 'video' && element.assetId !== undefined ? project.assets[element.assetId] : undefined
      return asset?.name === name ? [{ element, asset }] : []
    })
  const match = matches.at(0)
  if (match === undefined || matches.length > 1) throw new Error(`assertion failed: ${path.basename(file)} holds ${matches.length} "${name}" video clips`)
  const { crop, reframe = [] } = match.element
  const { width, height } = match.asset
  const first = reframe.at(0)
  const last = reframe.at(-1)
  if (crop === undefined || first === undefined || last === undefined || reframe.length < 2 || width === undefined || height === undefined) {
    throw new Error(
      `assertion failed: the saved "${name}" clip has ${reframe.length} reframe key(s), ${crop === undefined ? 'no crop' : 'a crop'}, and a ${width ?? '?'}x${height ?? '?'} asset`,
    )
  }
  return { crop, keys: reframe.length, first, last, width, height }
}

const centerPerson: Driver = async (ctx) => {
  const { view } = ctx
  await watchToasts(view)
  const cached = await faceModelCached(view)
  if (!cached && ctx.whisper.mode === 'offline') return blocked(`${ctx.whisper.reason}, and the face model downloads from the same host`)
  const name = await placeFaceClip(ctx)
  await ctx.upstreamRequests()
  const run = await centerFromClipMenu(view, name)
  const upstream = await ctx.upstreamRequests()
  const modelRequests = upstream.filter((url) => url.endsWith(`/${MODEL_FILE}`)).length
  const toasts = describeToasts(run.toasts)
  ctx.log(`toasts: ${toasts}, ${upstream.length} upstream request(s)`)
  if (run.error !== undefined) {
    if (ctx.whisper.mode === 'mirror' && MODEL_DOWNLOAD_ERROR.test(run.error))
      return blocked(`the mirror at ${ctx.whisper.url} holds no opencv/face_detection_yunet/${MODEL_FILE}, so the toast reads "${run.error}"`)
    throw new Error(`Center person failed with the toast "${run.error}" after ${run.ms} ms, ${toasts}`)
  }
  check(run.toasts.includes(SUCCESS_TOAST), `"${SUCCESS_TOAST}" within ${run.ms} ms, ${toasts}`)
  const download = percentRange(run.toasts, DOWNLOAD_TOAST)
  const model = cached
    ? check(
        download.updates === 0 && modelRequests === 0,
        `the cached model showed ${download.updates} Downloading toast(s) and fetched ${modelRequests} model file(s)`,
      )
    : check(
        download.max > 0 && modelRequests > 0,
        `the first run fetched ${modelRequests} model file(s) under a Downloading toast that reached ${download.max}%`,
      )
  const { file } = await saveThroughMenu(ctx)
  const saved = await readCenteredClip(file, name)
  const aspect = (saved.crop.w * saved.width) / (saved.crop.h * saved.height)
  const crop = check(
    Math.abs(aspect - TARGET_ASPECT) < 0.01,
    `crop w ${saved.crop.w} h ${saved.crop.h} of the ${saved.width}x${saved.height} source is ${aspect.toFixed(4)} wide per unit of height`,
  )
  const follow = check(
    saved.last.x - saved.first.x >= MIN_TRAVEL,
    `${saved.keys} reframe keys move from x ${saved.first.x} at ${saved.first.sourceMs} ms to x ${saved.last.x} at ${saved.last.sourceMs} ms`,
  )
  return pass(`${model}, ${toasts} in ${run.ms} ms at 9:16 and ${run.smoothing}, then ${path.basename(file)} shows ${follow} and ${crop}`)
}

export const REFRAME_DRIVERS = {
  'center-person': centerPerson,
} satisfies Partial<Record<string, Driver>>
