import { check, keyboardOf, mouseOf, pass, poll, type Driver, type View } from '../context.ts'
import { box } from './core.ts'

const ROW = '[data-mcut-track-row]'
const GRIP = '[data-mcut-track-grip]'

const rowOrder = (view: View): Promise<string[]> => view.locator(ROW).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-mcut-track-row') ?? ''))
const laneClips = (view: View, trackId: string) => view.locator(`[data-mcut-lane="${trackId}"] [data-mcut-clip]`)
const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, index) => id === b[index])

async function drag(view: View, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const mouse = mouseOf(view)
  await mouse.move(from.x, from.y)
  await mouse.down()
  await mouse.move(to.x, to.y, { steps: 14 })
  await mouse.up()
}

async function undo(view: View): Promise<void> {
  await view.getByRole('button', { name: 'Undo' }).click()
}

async function emptyAndFilledRows(view: View): Promise<{ order: string[]; empty: number; filled: number }> {
  let order = await rowOrder(view)
  const counts = async () => Promise.all(order.map((id) => laneClips(view, id).count()))
  let perRow = await counts()
  if (!perRow.includes(0)) {
    const before = order.length
    await view.getByTitle('Add track').first().click()
    order = await poll(
      () => rowOrder(view),
      (next) => next.length === before + 1,
      5_000,
    )
    perRow = await counts()
  }
  const empty = perRow.indexOf(0)
  const filled = perRow.findIndex((count) => count > 0)
  check(empty >= 0 && filled >= 0, `found an empty row and a row with clips among ${order.length} rows`)
  return { order, empty, filled }
}

const moveAcrossTracks: Driver = async ({ view }) => {
  const { order, empty, filled } = await emptyAndFilledRows(view)
  const source = order[filled] ?? ''
  const target = order[empty] ?? ''
  const sourceBefore = await laneClips(view, source).count()
  const clip = await laneClips(view, source).first().boundingBox()
  check(clip !== null, `a clip is visible on row ${filled}`)
  const sourceLane = await box(view, `[data-mcut-lane="${source}"]`)
  const targetLane = await box(view, `[data-mcut-lane="${target}"]`)
  const from = { x: (clip?.x ?? 0) + Math.min(40, (clip?.width ?? 0) / 2), y: (clip?.y ?? 0) + (clip?.height ?? 0) / 2 }
  await drag(view, from, { x: from.x, y: from.y + targetLane.y - sourceLane.y })
  const landed = await poll(
    () => laneClips(view, target).count(),
    (count) => count === 1,
    5_000,
  )
  check(landed === 1, `row ${empty} holds ${landed} clip(s) after dragging a clip from row ${filled}`)
  const sourceAfter = await laneClips(view, source).count()
  check(sourceAfter === sourceBefore - 1, `row ${filled} went from ${sourceBefore} to ${sourceAfter} clip(s)`)
  await undo(view)
  const restored = await poll(
    () => laneClips(view, source).count(),
    (count) => count === sourceBefore,
    5_000,
  )
  const targetAfterUndo = await laneClips(view, target).count()
  check(
    restored === sourceBefore && targetAfterUndo === 0,
    `one Undo put the clip back, row ${filled} holds ${restored}, row ${empty} holds ${targetAfterUndo}`,
  )
  return pass(
    `dragged a clip from row ${filled} to row ${empty} (${sourceBefore} to ${sourceAfter} clip(s)), one Undo restored ${restored} and emptied row ${empty}`,
  )
}

const reorderTracks: Driver = async ({ view }) => {
  await emptyAndFilledRows(view)
  const before = await rowOrder(view)
  const grip = await box(view, GRIP, 0)
  const row = await box(view, ROW, 0)
  const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }
  await drag(view, from, { x: from.x, y: from.y + row.height + 4 })
  const dragged = await poll(
    () => rowOrder(view),
    (order) => order[1] === before[0],
    5_000,
  )
  check(dragged[1] === before[0], `the top track moved to row 1 after dragging its grip down one row`)
  await undo(view)
  const undone = await poll(
    () => rowOrder(view),
    (order) => sameOrder(order, before),
    5_000,
  )
  check(sameOrder(undone, before), 'one Undo restored the track order')
  const moved = before[0] ?? ''
  await view.locator(`[data-mcut-track-grip="${moved}"]`).focus()
  await keyboardOf(view).press('ArrowDown')
  const down = await poll(
    () => rowOrder(view),
    (order) => order[1] === moved,
    5_000,
  )
  check(down[1] === moved, 'ArrowDown on the focused grip moved the track down one row')
  await keyboardOf(view).press('ArrowUp')
  const up = await poll(
    () => rowOrder(view),
    (order) => sameOrder(order, before),
    5_000,
  )
  check(sameOrder(up, before), 'ArrowUp on the refocused grip moved it back')
  return pass(
    `dragging the grip moved the top track to row 1, one Undo restored ${before.length} rows, ArrowDown then ArrowUp on the grip moved it down and back`,
  )
}

export const TIMELINE_DRIVERS = {
  'move-across-tracks': moveAcrossTracks,
  'reorder-tracks': reorderTracks,
} satisfies Partial<Record<string, Driver>>
