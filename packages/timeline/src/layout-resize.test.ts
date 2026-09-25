import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { describeLayoutChange } from './layout-summary'
import { createProject, type Project } from './model'

const full = { x: 0, y: 0, w: 1, h: 1 }
const camera = { x: 0.863, y: 0.45, w: 0.112, h: 0.5 }

function pipProject(): Project {
  return applyCommand(createProject({ width: 1920, height: 1080 }), {
    type: 'saveLayout',
    layout: {
      id: 'l-pip',
      name: 'PiP',
      slots: [
        { source: 'screen', rect: full },
        { source: 'camera', rect: camera },
      ],
    },
  })
}

const rectOf = (project: Project, source: string) => project.layouts[0]?.slots.find((slot) => slot.source === source)?.rect

describe('resizeLayoutSlot', () => {
  test('a bottom-right camera given a 9:16 aspect stays bottom-right at the same area', () => {
    const before = pipProject()
    const after = applyCommand(before, { type: 'resizeLayoutSlot', layoutId: 'l-pip', source: 'camera', aspect: 9 / 16 })

    expect(rectOf(after, 'camera')).toEqual({ x: 0.8419, y: 0.5293, w: 0.1331, h: 0.4207 })
    expect(describeLayoutChange(before, after, 'l-pip')).toEqual([
      'Layout "PiP" (picture-in-picture), before → after:',
      '  screen full-frame 1920×1080 px, aspect 1.78 (16:9) (unchanged)',
      '  camera overlay bottom-right 215×540 px, aspect 0.40 → camera overlay bottom-right 256×454 px, aspect 0.56 (9:16) (width +19%, height -16%)',
    ])
  })

  test('a slot too large for the frame shrinks with its aspect and keeps its anchor', () => {
    const after = applyCommand(pipProject(), { type: 'resizeLayoutSlot', layoutId: 'l-pip', source: 'camera', scale: 3 })

    expect(rectOf(after, 'camera')).toEqual({ x: 0.7622, y: 0, w: 0.2128, h: 0.95 })
  })

  test('a full-frame slot resizes around its center', () => {
    const after = applyCommand(pipProject(), { type: 'resizeLayoutSlot', layoutId: 'l-pip', source: 'screen', aspect: 9 / 16 })

    expect(rectOf(after, 'screen')).toEqual({ x: 0.3418, y: 0, w: 0.3164, h: 1 })
  })

  test('widthPx sets the width and the height follows the current aspect', () => {
    const after = applyCommand(pipProject(), { type: 'resizeLayoutSlot', layoutId: 'l-pip', source: 'camera', widthPx: 300 })

    expect(rectOf(after, 'camera')).toEqual({ x: 0.8187, y: 0.2525, w: 0.1563, h: 0.6975 })
  })

  test('rejects scale next to an explicit width', () => {
    expect(() => applyCommand(pipProject(), { type: 'resizeLayoutSlot', layoutId: 'l-pip', source: 'camera', widthPx: 300, scale: 2 })).toThrow(
      'scale and keep apply only when neither widthPx nor heightPx is given',
    )
  })
})

describe('describeLayoutChange', () => {
  test('warns when saveLayout moves an overlay to another corner', () => {
    const before = pipProject()
    const after = applyCommand(before, {
      type: 'saveLayout',
      layout: {
        id: 'l-pip',
        name: 'PiP',
        slots: [
          { source: 'screen', rect: full },
          { source: 'camera', rect: { ...camera, y: 0.05 } },
        ],
      },
    })

    expect(describeLayoutChange(before, after, 'l-pip').at(-1)).toBe(
      'Warning: camera moved from bottom-right to top-right. Use resizeLayoutSlot to change size or aspect in place.',
    )
  })
})
