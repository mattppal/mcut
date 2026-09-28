import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { check, pass, poll, type Driver, type SurfaceContext, type View } from '../context.ts'
import { percentRange, toastsSeen, watchToasts } from './captions.ts'
import { clips } from './core.ts'
import { openRailTab } from './edit.ts'
import { switchToPortrait } from './modes.ts'
import { saveThroughMenu } from './project.ts'

const SUCCESS_TOAST = 'Person centered'
const DETECT_TOAST = /^Finding the person… (\d+)%$/
const QUIET_TOASTS = [/^Imported \d+ files?$/, /^Autosaved/]
const MODEL_FILE = 'face_detection_yunet_2023mar.onnx'
const TARGET_ASPECT = 9 / 16
const MIN_TRAVEL = 0.3
const CENTER_WAIT_MS = 150_000

const keySchema = z.object({ sourceMs: z.number(), x: z.number(), y: z.number() })
const savedProjectSchema = z.object({
  width: z.number(),
  height: z.number(),
  assets: z.record(z.string(), z.object({ name: z.string().optional(), width: z.number().optional(), height: z.number().optional() })),
  tracks: z.array(
    z.object({
      elements: z.array(
        z.object({
          type: z.string(),
          assetId: z.string().optional(),
          crop: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
          reframe: z.array(keySchema).optional(),
          transform: z.object({ x: z.number(), y: z.number(), scaleX: z.number(), scaleY: z.number() }).optional(),
        }),
      ),
    }),
  ),
})

const isError = (text: string): boolean => text !== SUCCESS_TOAST && !DETECT_TOAST.test(text) && !QUIET_TOASTS.some((pattern) => pattern.test(text))

function describeToasts(toasts: readonly string[]): string {
  const detect = percentRange(toasts, DETECT_TOAST)
  const rest = toasts.filter((text) => !DETECT_TOAST.test(text))
  return [
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
  const { crop, reframe = [], transform } = match.element
  const { width, height } = match.asset
  const first = reframe.at(0)
  const last = reframe.at(-1)
  if (
    crop === undefined ||
    transform === undefined ||
    first === undefined ||
    last === undefined ||
    reframe.length < 2 ||
    width === undefined ||
    height === undefined
  ) {
    throw new Error(
      `assertion failed: the saved "${name}" clip has ${reframe.length} reframe key(s), ${crop === undefined ? 'no crop' : 'a crop'}, ${transform === undefined ? 'no transform' : 'a transform'}, and a ${width ?? '?'}x${height ?? '?'} asset`,
    )
  }
  return { crop, transform, keys: reframe.length, first, last, width, height, frame: { width: project.width, height: project.height } }
}

const centerPerson: Driver = async (ctx) => {
  const { view } = ctx
  await watchToasts(view)
  const portrait = await switchToPortrait(view)
  const name = await placeFaceClip(ctx)
  await ctx.upstreamRequests()
  const run = await centerFromClipMenu(view, name)
  const upstream = await ctx.upstreamRequests()
  const modelRequests = upstream.filter((url) => url.endsWith(`/${MODEL_FILE}`)).length
  const toasts = describeToasts(run.toasts)
  ctx.log(`toasts: ${toasts}, ${upstream.length} upstream request(s)`)
  if (run.error !== undefined) {
    throw new Error(`Center person failed with the toast "${run.error}" after ${run.ms} ms, ${toasts}`)
  }
  check(run.toasts.includes(SUCCESS_TOAST), `"${SUCCESS_TOAST}" within ${run.ms} ms, ${toasts}`)
  const model = check(modelRequests === 0, `the bundled face model made ${modelRequests} model download request(s)`)
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
  const cover = Math.max(saved.frame.width / (saved.crop.w * saved.width), saved.frame.height / (saved.crop.h * saved.height))
  const { x, y, scaleX, scaleY } = saved.transform
  const fill = check(
    x === 0 && y === 0 && scaleX === scaleY && Math.abs(scaleX - cover) < 0.001,
    `transform x ${x} y ${y} scale ${scaleX} by ${scaleY} against a cover scale of ${cover.toFixed(4)} for the ${saved.frame.width}x${saved.frame.height} frame`,
  )
  return pass(
    `${portrait}, ${model}, ${toasts} in ${run.ms} ms at 9:16 and ${run.smoothing}, then ${path.basename(file)} shows ${follow}, ${crop}, and ${fill}`,
  )
}

export const REFRAME_DRIVERS = {
  'center-person': centerPerson,
} satisfies Partial<Record<string, Driver>>
