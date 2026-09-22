import path from 'node:path'
import { z } from 'zod'
import { blocked, check, keyboardOf, mouseOf, pass, poll, type Driver, type SurfaceContext, type View } from '../context.ts'

const boxSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
const statusSchema = z.object({ ok: z.literal(true), result: z.object({ connected: z.boolean() }) })

export const clips = (view: View) => view.locator('[data-mcut-clip]')
export const timecode = (view: View) => view.locator('[data-mcut-timeline] .text-primary').first().innerText()

export async function box(view: View, selector: string, nth = 0) {
  return boxSchema.parse(await view.locator(selector).nth(nth).boundingBox())
}

export function parseTimecode(text: string): number {
  const match = /^(\d+):(\d\d)\.(\d)$/.exec(text.trim())
  if (!match) throw new Error(`timecode "${text}" does not match m:ss.t`)
  return Number(match[1]) * 60_000 + Number(match[2]) * 1_000 + Number(match[3]) * 100
}

export const previewLit = (view: View): Promise<number> =>
  view.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-mcut-player] canvas')
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return -1
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    let lit = 0
    for (let i = 0; i < data.length; i += 64) {
      if ((data[i] ?? 0) > 60 || (data[i + 1] ?? 0) > 60 || (data[i + 2] ?? 0) > 60) lit++
    }
    return lit
  })

export async function discardRestoredSession(view: View): Promise<void> {
  await view
    .getByRole('button', { name: 'Discard' })
    .click({ timeout: 1_500 })
    .catch(() => {})
}

export async function selectFirstClip(view: View): Promise<void> {
  const clip = await box(view, '[data-mcut-clip]')
  await view
    .locator('[data-mcut-clip]')
    .first()
    .click({ position: { x: clip.width / 2, y: clip.height / 2 } })
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const menuLabel = (label: string): RegExp => new RegExp(`^${escapeRegExp(label)}`)

const TITLEBAR_AREA_RECT = 'navigator.windowControlsOverlay?.visible ? navigator.windowControlsOverlay.getTitlebarAreaRect().toJSON() : undefined'

export async function openMainMenu(view: View, geometry: 'assert' | 'ignore'): Promise<string> {
  const button = view.getByRole('button', { name: 'Main menu' })
  const menu = boxSchema.parse(await button.boundingBox())
  const titlebar = boxSchema.optional().parse(await view.evaluate(TITLEBAR_AREA_RECT))
  let observed = 'Main menu opens'
  if (geometry === 'assert' && titlebar !== undefined) {
    const inside = menu.x >= titlebar.x && menu.x + menu.width <= titlebar.x + titlebar.width
    observed = check(
      inside,
      `Main menu spans x ${Math.round(menu.x)}..${Math.round(menu.x + menu.width)} inside the titlebar area x ${Math.round(titlebar.x)}..${Math.round(titlebar.x + titlebar.width)}, clear of the window controls`,
    )
  }
  await button.click()
  await view.getByRole('menuitem', { name: 'MCP tools' }).waitFor({ state: 'visible', timeout: 10_000 })
  return observed
}

export async function openMenuPath(view: View, section: string, item: string): Promise<void> {
  await openMainMenu(view, 'ignore')
  await view.getByRole('menuitem', { name: section, exact: true }).click()
  const target = view.getByRole('menuitem', { name: menuLabel(item) })
  await target.waitFor({ state: 'visible', timeout: 5_000 })
  await target.click()
  await closeMenus(view)
}

export async function closeMenus(view: View): Promise<void> {
  const root = view.getByRole('menuitem', { name: 'MCP tools' })
  for (let attempt = 0; attempt < 3 && (await root.isVisible()); attempt += 1) {
    await keyboardOf(view).press('Escape')
    await view.waitForTimeout(200)
  }
  await root.waitFor({ state: 'hidden', timeout: 5_000 })
}

const openEditor: Driver = async ({ view }) => {
  await view.getByRole('button', { name: 'Go to start' }).waitFor({ state: 'visible', timeout: 60_000 })
  await discardRestoredSession(view)
  const name = await view.getByLabel('Project name').inputValue()
  const count = await clips(view).count()
  return pass(check(name.length > 0, `project name reads "${name}", Go to start visible, ${count} clip(s) on the timeline`))
}

const importMedia: Driver = async (ctx) => {
  const name = path.basename(ctx.fixtures.clip)
  await ctx.importFile(ctx.fixtures.clip)
  const card = ctx.view.getByTitle(name).first()
  await card.waitFor({ state: 'visible', timeout: 15_000 })
  await card.getByText('0:02', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
  return pass(`media card "${name}" shows the 0:02 duration badge`)
}

const addToTimeline: Driver = async (ctx) => {
  const before = await clips(ctx.view).count()
  await ctx.view.getByTitle(path.basename(ctx.fixtures.clip)).first().dblclick()
  const after = await poll(
    () => clips(ctx.view).count(),
    (count) => count === before + 1,
    15_000,
  )
  check(after === before + 1, `timeline shows ${after} clip(s) after double-clicking the card, ${before} before`)
  const lit = await poll(
    () => previewLit(ctx.view),
    (value) => value > 100,
    15_000,
  )
  return pass(check(lit > 100, `${after} clip(s) on the timeline, preview canvas has ${lit} lit samples`))
}

const playback: Driver = async ({ view }) => {
  await view.getByRole('button', { name: 'Go to start' }).click()
  const start = await timecode(view)
  await view.locator('[data-mcut-player]').click()
  await keyboardOf(view).press('Space')
  const moving = await poll(
    () => timecode(view),
    (value) => value !== start,
    5_000,
  )
  check(moving !== start, `timecode left "${start}" after Space, reads "${moving}"`)
  await keyboardOf(view).press('Space')
  await view.waitForTimeout(600)
  const paused = await timecode(view)
  await view.waitForTimeout(600)
  const still = await timecode(view)
  return pass(check(paused === still, `playback moved "${start}" to "${moving}", paused at "${paused}" and stayed there`))
}

const seek: Driver = async ({ view }) => {
  await view.getByRole('button', { name: 'Go to start' }).click()
  const start = await timecode(view)
  const clip = await box(view, '[data-mcut-clip]')
  const ruler = await box(view, 'div.cursor-col-resize.bg-card')
  const y = ruler.y + ruler.height / 2
  await view.locator('body').hover({ position: { x: clip.x + clip.width * 0.1, y } })
  const mouse = mouseOf(view)
  await mouse.move(clip.x + clip.width * 0.1, y)
  await mouse.down()
  await mouse.move(clip.x + clip.width * 0.3, y, { steps: 12 })
  await mouse.up()
  const scrubbed = await poll(
    () => timecode(view),
    (value) => value !== start,
    3_000,
  )
  check(scrubbed !== start, `timecode after scrub reads "${scrubbed}"`)
  await keyboardOf(view).press('Shift+ArrowRight')
  const nudged = await poll(
    () => timecode(view),
    (value) => value !== scrubbed,
    3_000,
  )
  const delta = parseTimecode(nudged) - parseTimecode(scrubbed)
  return pass(check(delta === 1_000, `timecode "${start}" then "${scrubbed}" after scrub then "${nudged}" after Shift+ArrowRight`))
}

const trim: Driver = async ({ view }) => {
  await selectFirstClip(view)
  const before = await box(view, '[data-mcut-clip]')
  const mouse = mouseOf(view)
  const y = before.y + before.height / 2
  await mouse.move(before.x + before.width - 2, y)
  await mouse.down()
  await mouse.move(before.x + before.width - 30, y, { steps: 6 })
  await mouse.move(before.x + before.width - 60, y, { steps: 6 })
  await mouse.up()
  const after = await poll(
    () => box(view, '[data-mcut-clip]'),
    (value) => value.width < before.width - 20,
    5_000,
  )
  return pass(
    check(after.width < before.width - 20, `clip width ${Math.round(before.width)} px shrank to ${Math.round(after.width)} px after dragging the right edge`),
  )
}

const split: Driver = async ({ view }) => {
  const before = await clips(view).count()
  const clip = await box(view, '[data-mcut-clip]')
  const ruler = await box(view, 'div.cursor-col-resize.bg-card')
  await view
    .locator('div.cursor-col-resize.bg-card')
    .first()
    .click({ position: { x: clip.x - ruler.x + clip.width / 2, y: ruler.height / 2 } })
  await selectFirstClip(view)
  await keyboardOf(view).press('s')
  const after = await poll(
    () => clips(view).count(),
    (count) => count === before + 1,
    5_000,
  )
  return pass(check(after === before + 1, `${before} clip(s) became ${after} after pressing S with the playhead inside the clip`))
}

const undoRedo: Driver = async ({ view }) => {
  const before = await clips(view).count()
  await view.getByRole('button', { name: 'Undo' }).click()
  const undone = await poll(
    () => clips(view).count(),
    (count) => count !== before,
    5_000,
  )
  check(undone !== before, `clip count ${before} changed to ${undone} after Undo`)
  await view.getByRole('button', { name: 'Redo' }).click()
  const redone = await poll(
    () => clips(view).count(),
    (count) => count === before,
    5_000,
  )
  return pass(check(redone === before, `clip count ${before}, ${undone} after Undo, ${redone} after Redo`))
}

const mainMenu: Driver = async ({ view }) => {
  const geometry = await openMainMenu(view, 'assert')
  await view.getByRole('menuitem', { name: 'File', exact: true }).click()
  const save = view.getByRole('menuitem', { name: menuLabel('Save project file') })
  await save.waitFor({ state: 'visible', timeout: 5_000 })
  await closeMenus(view)
  return pass(`${geometry}, lists MCP tools, and the File submenu lists Save project file…`)
}

export async function exportAs(ctx: SurfaceContext, format: 'WebM' | 'MP4' | 'MKV') {
  const { view } = ctx
  await view.locator('[data-mcut-export-trigger]').click()
  await view.getByRole('dialog').getByText('Export video', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
  await view.getByRole('button', { name: format, exact: true }).click()
  const button = view.getByRole('button', { name: `Export ${format}` })
  await button.waitFor({ state: 'visible', timeout: 10_000 })
  const unsupported = view.getByText("This browser can't encode")
  if (await unsupported.isVisible({ timeout: 1_500 }).catch(() => false)) {
    const text = await unsupported.innerText()
    await closeDialog(view)
    return blocked(`export dialog says "${text}"`)
  }
  const download = ctx.nextDownload(150_000)
  await button.click()
  const file = await download
  await button.waitFor({ state: 'visible', timeout: 30_000 })
  await closeDialog(view)
  return pass(check(file.bytes > 0, `downloaded ${path.basename(file.path)} with ${file.bytes} bytes`))
}

async function closeDialog(view: View): Promise<void> {
  await view.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click()
  await view.getByRole('dialog').waitFor({ state: 'hidden', timeout: 10_000 })
}

const mcpBridge: Driver = async ({ page }) => {
  const port = Number(new URL(page.url()).searchParams.get('mcpBridge'))
  check(Number.isInteger(port) && port > 0, `window URL names bridge port ${port}`)
  const connected = await poll(
    async () => statusSchema.parse(await (await fetch(`http://127.0.0.1:${port}/status`)).json()).result.connected,
    (value) => value,
    15_000,
  )
  return pass(check(connected, `GET http://127.0.0.1:${port}/status reports connected ${connected}`))
}

export const CORE_DRIVERS = {
  'open-editor': openEditor,
  'import-media': importMedia,
  'add-to-timeline': addToTimeline,
  playback,
  seek,
  trim,
  split,
  'undo-redo': undoRedo,
  'main-menu': mainMenu,
  'export-webm': (ctx: SurfaceContext) => exportAs(ctx, 'WebM'),
  'export-mp4': (ctx: SurfaceContext) => exportAs(ctx, 'MP4'),
  'export-mkv': (ctx: SurfaceContext) => exportAs(ctx, 'MKV'),
  'mcp-bridge': mcpBridge,
} satisfies Partial<Record<string, Driver>>
