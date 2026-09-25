import path from 'node:path'
import type { Locator } from '@playwright/test'
import { check, keyboardOf, mouseOf, pass, poll, type Driver, type View } from '../context.ts'
import { box, clips } from './core.ts'

const RULER = 'div.cursor-col-resize.bg-card'
const VIDEO_CLIP = '[data-mcut-clip=video]'
const TEXT_CLIP = '[data-mcut-clip=text]'
const KEYFRAME_MARKER = "button[title*='Keyframe']"
const DIAMOND = "[title^='Arm keyframes'], [title='Add keyframe at playhead'], [title='Remove keyframe at playhead']"
const VOICE_WAIT_MS = 840_000

const round = (value: number) => Math.round(value)
const lanes = (view: View) => view.locator('[data-mcut-lane]')
const numberField = (view: View, label: string) => view.getByLabel(label, { exact: true })

export async function openRailTab(view: View, tab: 'media' | 'text' | 'animate'): Promise<void> {
  const button = view.locator(`[data-rail-tab="${tab}"]`)
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
}

async function selectClip(view: View, selector: string, nth: number): Promise<void> {
  const clip = await box(view, selector, nth)
  await view
    .locator(selector)
    .nth(nth)
    .click({ position: { x: clip.width / 2, y: clip.height / 2 } })
}

async function seekInsideClip(view: View, selector: string, nth: number, fraction: number): Promise<void> {
  const clip = await box(view, selector, nth)
  const ruler = await box(view, RULER)
  await view
    .locator(RULER)
    .first()
    .click({ position: { x: clip.x - ruler.x + clip.width * fraction, y: ruler.height / 2 } })
}

async function widestClip(view: View, selector: string): Promise<number> {
  const count = await view.locator(selector).count()
  check(count > 0, `at least one ${selector} clip on the timeline`)
  let widest = 0
  let width = -1
  for (let index = 0; index < count; index += 1) {
    const clip = await box(view, selector, index)
    if (clip.width > width) {
      width = clip.width
      widest = index
    }
  }
  return widest
}

async function rightmostClip(view: View): Promise<number> {
  const count = await clips(view).count()
  check(count > 0, 'at least one clip on the timeline')
  let rightmost = 0
  let edge = -1
  for (let index = 0; index < count; index += 1) {
    const clip = await box(view, '[data-mcut-clip]', index)
    if (clip.x + clip.width > edge) {
      edge = clip.x + clip.width
      rightmost = index
    }
  }
  return rightmost
}

async function openSection(view: View, title: string, probe: Locator): Promise<void> {
  if (await probe.isVisible()) return
  await view.getByRole('button', { name: title, exact: true }).click()
  await probe.waitFor({ state: 'visible', timeout: 5_000 })
}

async function commitNumberField(view: View, label: string, value: string): Promise<string> {
  const field = numberField(view, label)
  await field.fill(value)
  await keyboardOf(view).press('Enter')
  return poll(
    () => field.inputValue(),
    (text) => text === value,
    5_000,
  )
}

const canvasSignature = (view: View): Promise<number> =>
  view.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-mcut-player] canvas')
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return -1
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    let hash = 0
    for (let i = 0; i < data.length; i += 64) hash = (hash * 31 + (data[i] ?? 0) + (data[i + 1] ?? 0) * 7) % 1_000_003
    return hash
  })

const move: Driver = async ({ view }) => {
  const target = await rightmostClip(view)
  await selectClip(view, '[data-mcut-clip]', target)
  const before = await box(view, '[data-mcut-clip]', target)
  const startBefore = await numberField(view, 'Start').inputValue()
  const mouse = mouseOf(view)
  const y = before.y + before.height / 2
  await mouse.move(before.x + before.width / 2, y)
  await mouse.down()
  await mouse.move(before.x + before.width / 2 + 60, y, { steps: 6 })
  await mouse.move(before.x + before.width / 2 + 160, y, { steps: 10 })
  await mouse.up()
  const after = await poll(
    () => box(view, '[data-mcut-clip]', target),
    (value) => value.x > before.x + 20,
    5_000,
  )
  check(after.x > before.x + 20, `clip x ${round(before.x)} px became ${round(after.x)} px after dragging right`)
  const startAfter = await poll(
    () => numberField(view, 'Start').inputValue(),
    (value) => value !== startBefore,
    5_000,
  )
  check(Number(startAfter) > Number(startBefore), `Start ${startBefore} s became ${startAfter} s`)
  return pass(`clip x ${round(before.x)} px became ${round(after.x)} px, inspector Start ${startBefore} s became ${startAfter} s`)
}

const remove: Driver = async (ctx) => {
  const { view } = ctx
  const before = await clips(view).count()
  await selectClip(view, '[data-mcut-clip]', before - 1)
  await keyboardOf(view).press('Delete')
  const deleted = await poll(
    () => clips(view).count(),
    (count) => count === before - 1,
    5_000,
  )
  check(deleted === before - 1, `${before} clip(s) became ${deleted} after Delete`)
  await openRailTab(view, 'media')
  await view.getByTitle(path.basename(ctx.fixtures.clip)).first().dblclick()
  const restored = await poll(
    () => clips(view).count(),
    (count) => count === before,
    15_000,
  )
  return pass(check(restored === before, `${before} clip(s) became ${deleted} after Delete, ${restored} after adding the card again`))
}

const textTitle: Driver = async ({ view }) => {
  const before = await clips(view).count()
  const textBefore = await view.locator(TEXT_CLIP).count()
  const lanesBefore = await lanes(view).count()
  await openRailTab(view, 'text')
  await view.getByTitle(/^Title .+ drag/).click()
  const textAfter = await poll(
    () => view.locator(TEXT_CLIP).count(),
    (count) => count === textBefore + 1,
    5_000,
  )
  check(textAfter === textBefore + 1, `text clip count ${textBefore} became ${textAfter}`)
  const label = await view.locator(TEXT_CLIP).last().innerText()
  check(label.includes('Title'), `new text clip label reads "${label}"`)
  const after = await clips(view).count()
  const lanesAfter = await lanes(view).count()
  return pass(`${before} clip(s) became ${after}, text clips ${textBefore} became ${textAfter} labelled "Title", ${lanesBefore} lane(s) became ${lanesAfter}`)
}

const textInlineEdit: Driver = async ({ view }) => {
  const player = await box(view, '[data-mcut-player]')
  await mouseOf(view).dblclick(player.x + player.width / 2, player.y + player.height / 2)
  const editor = view.locator('[data-mcut-text-editor]')
  await editor.waitFor({ state: 'visible', timeout: 5_000 })
  await keyboardOf(view).type('Smoke title')
  const typed = await poll(
    () => editor.innerText(),
    (text) => text === 'Smoke title',
    5_000,
  )
  check(typed === 'Smoke title', `inline editor reads "${typed}"`)
  await keyboardOf(view).press('Escape')
  await editor.waitFor({ state: 'hidden', timeout: 5_000 })
  const label = view.locator(TEXT_CLIP).getByText('Smoke title', { exact: true }).first()
  await label.waitFor({ state: 'visible', timeout: 5_000 })
  return pass(`inline editor read "${typed}" after typing, text clip label reads "${await label.innerText()}" after Escape`)
}

const effects: Driver = async ({ view }) => {
  const target = await widestClip(view, VIDEO_CLIP)
  await seekInsideClip(view, VIDEO_CLIP, target, 0.5)
  await selectClip(view, VIDEO_CLIP, target)
  await openSection(view, 'Effects', numberField(view, 'Blur'))
  const before = await numberField(view, 'Blur').inputValue()
  const signatureBefore = await canvasSignature(view)
  const after = await commitNumberField(view, 'Blur', '20')
  check(after === '20', `Blur ${before} px became ${after} px in the inspector`)
  const signatureAfter = await poll(
    () => canvasSignature(view),
    (value) => value !== signatureBefore,
    10_000,
  )
  check(signatureAfter !== signatureBefore, `preview canvas signature ${signatureBefore} changed after Blur 20 px`)
  return pass(`Blur ${before} px became ${after} px in the inspector, preview canvas signature ${signatureBefore} became ${signatureAfter}`)
}

const cleanVoice: Driver = async ({ view }) => {
  const target = await widestClip(view, VIDEO_CLIP)
  const name = await view.locator(VIDEO_CLIP).nth(target).getAttribute('title')
  await selectClip(view, VIDEO_CLIP, target)
  const toggle = view.getByRole('switch', { name: 'Clean up voice' })
  await openSection(view, 'Audio', toggle)
  const before = await toggle.getAttribute('aria-checked')
  check(before === 'false', `"Clean up voice" switch reads aria-checked ${before} before the click`)
  const stem = view.locator('[data-mcut-voice-stem]')
  const progress = view.getByText(/^Cleaning voice… \d+%$/)
  let peak = -1
  const started = Date.now()
  await toggle.click()
  const state = await poll(
    async () => {
      const [value, lines] = await Promise.all([stem.getAttribute('data-mcut-voice-stem'), progress.allTextContents()])
      for (const line of lines) peak = Math.max(peak, Number(/(\d+)%$/.exec(line)?.[1] ?? peak))
      return value
    },
    (value) => value === 'ready' || value === 'failed',
    VOICE_WAIT_MS,
  )
  const ms = Date.now() - started
  const failure = (await view.getByText(/^Voice cleanup failed\./).allTextContents())[0]
  check(state === 'ready', `stem for "${name}" reads "${state}" ${ms} ms after the click${failure ? `, "${failure}"` : ''}`)
  const amount = (await stem.getByText(/^\d+%$/).allTextContents())[0]
  check(amount === '100%', `Amount reads ${amount} after turning Clean up voice on`)
  const seen = peak >= 0 ? `progress line seen up to ${peak}%` : 'finished before a progress line rendered'
  return pass(`Clean up voice on for "${name}", Amount ${amount}, stem ready ${ms} ms after the click, ${seen}`)
}

const transitions: Driver = async ({ view }) => {
  const before = await clips(view).count()
  const target = await widestClip(view, VIDEO_CLIP)
  const whole = await box(view, VIDEO_CLIP, target)
  await seekInsideClip(view, VIDEO_CLIP, target, 0.5)
  await selectClip(view, VIDEO_CLIP, target)
  await keyboardOf(view).press('s')
  const split = await poll(
    () => clips(view).count(),
    (count) => count === before + 1,
    5_000,
  )
  check(split === before + 1, `${before} clip(s) became ${split} after S`)
  const count = await view.locator(VIDEO_CLIP).count()
  let left = -1
  for (let index = 0; index < count && left < 0; index += 1) {
    const clip = await box(view, VIDEO_CLIP, index)
    if (Math.abs(clip.x - whole.x) < 2 && Math.abs(clip.y - whole.y) < 2) left = index
  }
  check(left >= 0, `found the left half of the split at x ${round(whole.x)} px`)
  await selectClip(view, VIDEO_CLIP, left)
  const picker = view.getByText('Add a transition…')
  await openSection(view, 'Transition', picker)
  await picker.click()
  await view.getByRole('option', { name: /^dissolve$/i }).click()
  const marker = view.locator('[data-mcut-clip] [title="dissolve → next clip"]')
  await marker.waitFor({ state: 'visible', timeout: 5_000 })
  const type = await view
    .getByRole('combobox')
    .filter({ hasText: /dissolve/i })
    .first()
    .innerText()
  const length = await numberField(view, 'Length').inputValue()
  return pass(`split ${before} clip(s) into ${split}, Type reads "${type.trim()}", Length ${length} s, clip marker "dissolve → next clip" visible`)
}

const keyframes: Driver = async ({ view }) => {
  const target = await widestClip(view, VIDEO_CLIP)
  await seekInsideClip(view, VIDEO_CLIP, target, 0.2)
  await selectClip(view, VIDEO_CLIP, target)
  const markers = view.locator(VIDEO_CLIP).nth(target).locator(KEYFRAME_MARKER)
  const before = await markers.count()
  await openSection(view, 'Motion', numberField(view, 'X'))
  const diamond = view.locator(DIAMOND).first()
  const armTitle = await diamond.getAttribute('title')
  await diamond.click()
  const first = await poll(
    () => markers.count(),
    (count) => count === before + 1,
    5_000,
  )
  check(first === before + 1, `keyframe markers ${before} became ${first} after clicking the X diamond`)
  const onKeyframe = await diamond.getAttribute('title')
  check(onKeyframe === 'Remove keyframe at playhead', `X diamond title reads "${onKeyframe}"`)
  for (let step = 0; step < 5; step += 1) await keyboardOf(view).press('ArrowRight')
  const armed = await poll(
    () => diamond.getAttribute('title'),
    (title) => title === 'Add keyframe at playhead',
    5_000,
  )
  check(armed === 'Add keyframe at playhead', `X diamond title reads "${armed}" five frames later`)
  await diamond.click()
  const second = await poll(
    () => markers.count(),
    (count) => count === before + 2,
    5_000,
  )
  check(second === before + 2, `keyframe markers ${first} became ${second} after the second diamond click`)
  return pass(`X diamond "${armTitle}" then "${onKeyframe}", markers ${before} became ${first} then ${second} at two playhead positions`)
}

const animationPresets: Driver = async ({ view }) => {
  const target = await widestClip(view, VIDEO_CLIP)
  await selectClip(view, VIDEO_CLIP, target)
  const markers = view.locator(VIDEO_CLIP).nth(target).locator(KEYFRAME_MARKER)
  const before = await markers.count()
  await openRailTab(view, 'animate')
  await view.locator('[data-preset="fade-in"]').click()
  const toast = view.getByText(/fade in applied/)
  await toast.waitFor({ state: 'visible', timeout: 5_000 })
  const text = await toast.innerText()
  const after = await poll(
    () => markers.count(),
    (count) => count > before,
    5_000,
  )
  check(after > before, `keyframe markers ${before} became ${after} after Fade in`)
  await openRailTab(view, 'media')
  return pass(`toast "${text}", keyframe markers on the clip ${before} became ${after}`)
}

export const EDIT_DRIVERS = {
  move,
  delete: remove,
  'text-title': textTitle,
  'text-inline-edit': textInlineEdit,
  effects,
  'clean-voice': cleanVoice,
  transitions,
  keyframes,
  'animation-presets': animationPresets,
} satisfies Partial<Record<string, Driver>>
