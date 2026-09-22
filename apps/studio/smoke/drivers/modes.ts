import path from 'node:path'
import { check, keyboardOf, pageOf, pass, poll, type Driver, type SurfaceContext, type View } from '../context.ts'
import { clips } from './core.ts'
import { openRailTab } from './edit.ts'

const lanes = (view: View) => view.locator('[data-mcut-lane]')
const numberField = (view: View, label: string) => view.getByLabel(label, { exact: true })
const modeTab = (view: View, name: 'Edit' | 'Multicam' | 'Collage') => view.getByRole('button', { name, exact: true })

async function ensureSpeechCard(ctx: SurfaceContext): Promise<string> {
  const name = path.basename(ctx.fixtures.speech)
  await openRailTab(ctx.view, 'media')
  const card = ctx.view.getByTitle(name).first()
  if ((await card.count()) === 0) await ctx.importFile(ctx.fixtures.speech)
  await card.waitFor({ state: 'visible', timeout: 15_000 })
  await card.getByText('0:04', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
  return name
}

async function selectTwoCards(ctx: SurfaceContext): Promise<[string, string]> {
  const speech = await ensureSpeechCard(ctx)
  const clip = path.basename(ctx.fixtures.clip)
  await ctx.view.getByTitle(clip).first().click()
  await ctx.view.getByTitle(speech).first().click()
  return [clip, speech]
}

const multicam: Driver = async (ctx) => {
  const { view } = ctx
  const multicamClips = view.locator('[data-mcut-clip=multicam]')
  const before = await multicamClips.count()
  const total = await clips(view).count()
  await modeTab(view, 'Multicam').click()
  const [clip, speech] = await selectTwoCards(ctx)
  const setup = view.locator('[data-mcut-multicam-setup]')
  await setup.getByText('New multicam').waitFor({ state: 'visible', timeout: 5_000 })
  const screen = await setup.locator('span.truncate').first().innerText()
  await setup.getByRole('button', { name: 'Create multicam' }).click()
  const after = await poll(
    () => multicamClips.count(),
    (count) => count === before + 1,
    15_000,
  )
  check(after === before + 1, `multicam clip count ${before} became ${after}`)
  await view.getByText(/Layouts · 1–/).waitFor({ state: 'visible', timeout: 5_000 })
  const tiles = await view.getByTitle(/cuts while playing/).count()
  const totalAfter = await clips(view).count()
  await modeTab(view, 'Edit').click()
  return pass(
    `multicam clips ${before} became ${after} from ${clip} and ${speech} with "${screen}" as the screen, ${total} clip(s) became ${totalAfter}, layout bank lists ${tiles} tiles`,
  )
}

const collage: Driver = async (ctx) => {
  const { view } = ctx
  const page = pageOf(view)
  const lanesBefore = await lanes(view).count()
  await modeTab(view, 'Collage').click()
  await selectTwoCards(ctx)
  const setup = view.locator('[data-mcut-collage-setup]')
  await setup.getByText('Sequential collage').waitFor({ state: 'visible', timeout: 5_000 })
  const confirms: string[] = []
  const accept = (dialog: { message(): string; accept(): Promise<void> }) => {
    confirms.push(dialog.message())
    void dialog.accept()
  }
  page.once('dialog', accept)
  await setup.getByRole('button', { name: 'Build collage' }).click()
  const toast = view.getByText(/^Collage created/)
  await toast.waitFor({ state: 'visible', timeout: 15_000 })
  page.off('dialog', accept)
  const text = await toast.innerText()
  const names = await poll(
    () => view.locator('[data-mcut-timeline] span.truncate').allInnerTexts(),
    (list) => list.some((name) => name.startsWith('Collage 1:')) && list.some((name) => name.startsWith('Collage 2:')),
    10_000,
  )
  const collageNames = names.filter((name) => name.startsWith('Collage'))
  check(collageNames.length >= 3, `timeline tracks read ${JSON.stringify(collageNames)}`)
  await setup.getByText('Stack order').waitFor({ state: 'visible', timeout: 5_000 })
  await setup.getByText('Bottom', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 })
  await setup.getByText('Top', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 })
  const lanesAfter = await lanes(view).count()
  await modeTab(view, 'Edit').click()
  return pass(
    `toast "${text}", confirm "${confirms.join('') || 'none'}" accepted, ${lanesBefore} lane(s) became ${lanesAfter} named ${JSON.stringify(collageNames)}, stack order lists Bottom and Top`,
  )
}

const aspectPresets: Driver = async ({ view }) => {
  await keyboardOf(view).press('ControlOrMeta+Shift+a')
  await view.getByText('Nothing selected.').waitFor({ state: 'visible', timeout: 5_000 })
  const widthBefore = await numberField(view, 'Width').inputValue()
  const heightBefore = await numberField(view, 'Height').inputValue()
  await view.getByRole('button', { name: '9:16', exact: true }).click()
  const width = await poll(
    () => numberField(view, 'Width').inputValue(),
    (value) => value === '1080',
    5_000,
  )
  const height = await poll(
    () => numberField(view, 'Height').inputValue(),
    (value) => value === '1920',
    5_000,
  )
  check(width === '1080' && height === '1920', `Width ${width} px, Height ${height} px after 9:16`)
  return pass(`Width ${widthBefore} px, Height ${heightBefore} px became Width ${width} px, Height ${height} px after clicking 9:16`)
}

export const MODE_DRIVERS = {
  multicam,
  collage,
  'aspect-presets': aspectPresets,
} satisfies Partial<Record<string, Driver>>
