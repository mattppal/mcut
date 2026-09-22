import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { check, keyboardOf, pass, poll, type Driver, type SurfaceContext, type View } from '../context.ts'
import { clips, closeMenus, selectFirstClip } from './core.ts'

const PROJECT_NAME = 'Smoke project'

const savedProjectSchema = z.object({
  name: z.string(),
  tracks: z.array(z.object({ elements: z.array(z.unknown()) })),
})

interface SavedProject {
  path: string
  name: string
  clips: number
}

let saved: SavedProject | null = null

async function readSavedProject(file: string): Promise<{ bytes: number; name: string; elements: number }> {
  const bytes = (await stat(file)).size
  const project = savedProjectSchema.parse(JSON.parse(await readFile(file, 'utf8')))
  const elements = project.tracks.reduce((total, track) => total + track.elements.length, 0)
  return { bytes, name: project.name, elements }
}

async function runFileMenuItem(view: View, label: RegExp): Promise<void> {
  await view.getByRole('button', { name: 'Main menu' }).click()
  await view.getByRole('menuitem', { name: 'MCP tools' }).waitFor({ state: 'visible', timeout: 10_000 })
  await view.getByRole('menuitem', { name: 'File', exact: true }).click()
  const target = view.getByRole('menuitem', { name: label })
  await target.waitFor({ state: 'visible', timeout: 5_000 })
  await target.click()
  await closeMenus(view)
}

async function saveThroughMenu(ctx: SurfaceContext): Promise<{ file: string; toast: string }> {
  const { view } = ctx
  switch (ctx.surface) {
    case 'embed': {
      const download = ctx.nextDownload(15_000)
      download.catch((error: unknown) => ctx.log(`save-project download did not arrive, ${String(error)}`))
      await runFileMenuItem(view, /^Save project file/)
      const toast = view.getByText(/^Project file saved/)
      await toast.waitFor({ state: 'visible', timeout: 10_000 })
      const file = await download
      check(file.bytes > 0, `download ${path.basename(file.path)} has ${file.bytes} bytes`)
      return { file: file.path, toast: await toast.innerText() }
    }
    case 'electron-dev':
    case 'installed': {
      const file = path.join(ctx.outDir, 'smoke.mcut.json')
      await ctx.stubSaveDialog(file)
      await runFileMenuItem(view, /^Save project file/)
      const toast = view.getByText(/^Saved /)
      await toast.waitFor({ state: 'visible', timeout: 10_000 })
      const text = await toast.innerText()
      check(text === `Saved ${file}`, `toast reads "${text}"`)
      return { file, toast: text }
    }
    default: {
      const exhaustive: never = ctx.surface
      return exhaustive
    }
  }
}

const saveProject: Driver = async (ctx) => {
  const { view } = ctx
  const nameInput = view.getByLabel('Project name')
  await nameInput.fill(PROJECT_NAME)
  const name = await poll(() => nameInput.inputValue(), (value) => value === PROJECT_NAME, 3_000)
  check(name === PROJECT_NAME, `Project name input reads "${name}"`)
  const count = await clips(view).count()
  const { file, toast } = await saveThroughMenu(ctx)
  const onDisk = await readSavedProject(file)
  check(onDisk.bytes > 0, `${path.basename(file)} has ${onDisk.bytes} bytes`)
  check(onDisk.name === PROJECT_NAME, `saved project name is "${onDisk.name}"`)
  check(onDisk.elements === count, `saved file holds ${onDisk.elements} element(s), timeline shows ${count}`)
  if (ctx.surface === 'embed') check(path.basename(file) === `${PROJECT_NAME}.mcut.json`, `download named ${path.basename(file)}`)
  saved = { path: file, name: onDisk.name, clips: count }
  return pass(`${path.basename(file)} has ${onDisk.bytes} bytes, name "${onDisk.name}", ${onDisk.elements} element(s) matching ${count} clip(s), toast "${toast}"`)
}

const openProject: Driver = async (ctx) => {
  const { view } = ctx
  if (saved === null) throw new Error('open-project needs save-project to run first')
  const target = saved
  await selectFirstClip(view)
  await keyboardOf(view).press('Delete')
  const fewer = await poll(() => clips(view).count(), (count) => count === target.clips - 1, 5_000)
  check(fewer === target.clips - 1, `clip count ${target.clips} became ${fewer} after Delete`)
  await ctx.stubOpenDialog(target.path)
  await runFileMenuItem(view, /^Open project file/)
  const restored = await poll(() => clips(view).count(), (count) => count === target.clips, 10_000)
  check(restored === target.clips, `clip count ${fewer} became ${restored} after opening ${path.basename(target.path)}`)
  const name = await view.getByLabel('Project name').inputValue()
  check(name === target.name, `Project name input reads "${name}", file says "${target.name}"`)
  return pass(`clip count ${target.clips} dropped to ${fewer} after Delete and returned to ${restored} after opening ${path.basename(target.path)}, project name "${name}"`)
}

const commandPalette: Driver = async ({ view }) => {
  const before = await clips(view).count()
  await keyboardOf(view).press('ControlOrMeta+k')
  const input = view.getByPlaceholder('Type a command…')
  await input.waitFor({ state: 'visible', timeout: 5_000 })
  await input.fill('Add text')
  const item = view.getByRole('option', { name: 'Add text at playhead' })
  await item.waitFor({ state: 'visible', timeout: 5_000 })
  await item.click()
  await input.waitFor({ state: 'hidden', timeout: 5_000 })
  const after = await poll(() => clips(view).count(), (count) => count === before + 1, 5_000)
  return pass(check(after === before + 1, `${before} clip(s) became ${after} after picking Add text at playhead from the palette`))
}

const shortcutsDialog: Driver = async ({ view }) => {
  await view.locator('[data-mcut-shortcuts-trigger]').click()
  const dialog = view.getByRole('dialog')
  const heading = dialog.getByRole('heading', { name: 'Keyboard shortcuts' })
  await heading.waitFor({ state: 'visible', timeout: 5_000 })
  const title = await heading.innerText()
  const description = await dialog.getByText('Everything is reachable without the mouse.').innerText()
  const row = dialog.locator('div', { hasText: /^Split selection at playhead/ }).last()
  const keys = await row.locator('kbd').innerText()
  check(keys === 'S', `Split selection at playhead row shows key "${keys}"`)
  await keyboardOf(view).press('Escape')
  await dialog.waitFor({ state: 'hidden', timeout: 5_000 })
  return pass(`dialog heading reads "${title}", description "${description}", Split selection at playhead row shows "${keys}", closed with Escape`)
}

const darkClass = (view: View): Promise<boolean> => view.evaluate(() => document.documentElement.classList.contains('dark'))

const settingsTheme: Driver = async ({ view }) => {
  const before = await darkClass(view)
  const toggle = view.getByRole('button', { name: 'Toggle theme' })
  await toggle.click()
  const flipped = await poll(() => darkClass(view), (value) => value !== before, 3_000)
  check(flipped !== before, `html.dark ${before} became ${flipped} after Toggle theme`)
  await toggle.click()
  const restored = await poll(() => darkClass(view), (value) => value === before, 3_000)
  return pass(check(restored === before, `html.dark ${before} became ${flipped} after Toggle theme, then ${restored} after toggling back`))
}

async function readSnapping(view: View): Promise<{ checked: string; bar: string }> {
  await view.getByRole('button', { name: 'Main menu' }).click()
  await view.getByRole('menuitem', { name: 'MCP tools' }).waitFor({ state: 'visible', timeout: 10_000 })
  await view.getByRole('menuitem', { name: 'View', exact: true }).click()
  const item = view.getByRole('menuitemcheckbox', { name: 'Snapping' })
  await item.waitFor({ state: 'visible', timeout: 5_000 })
  const checked = z.string().parse(await item.getAttribute('aria-checked'))
  const bar = checked === 'true' ? 'Snapping on' : 'Snapping off'
  await view.getByRole('button', { name: bar, exact: true }).waitFor({ state: 'visible', timeout: 3_000 })
  return { checked, bar }
}

async function clickSnapping(view: View): Promise<void> {
  await view.getByRole('menuitemcheckbox', { name: 'Snapping' }).click()
  await closeMenus(view)
}

const settingsSnapping: Driver = async ({ view }) => {
  const before = await readSnapping(view)
  await clickSnapping(view)
  const flipped = await readSnapping(view)
  check(flipped.checked !== before.checked, `View > Snapping aria-checked ${before.checked} became ${flipped.checked}`)
  await clickSnapping(view)
  const restored = await readSnapping(view)
  await closeMenus(view)
  return pass(
    check(
      restored.checked === before.checked,
      `View > Snapping aria-checked ${before.checked} became ${flipped.checked} (transport button "${flipped.bar}"), then ${restored.checked} after toggling back`,
    ),
  )
}

export const PROJECT_DRIVERS = {
  'save-project': saveProject,
  'open-project': openProject,
  'command-palette': commandPalette,
  'shortcuts-dialog': shortcutsDialog,
  'settings-theme': settingsTheme,
  'settings-snapping': settingsSnapping,
} satisfies Partial<Record<string, Driver>>
