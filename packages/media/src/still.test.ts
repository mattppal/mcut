import { describe, expect, test } from 'bun:test'
import { parseProject } from '@mcut/timeline'
import { renderProjectStill } from './still'

const project = parseProject({
  id: 'p-still',
  name: 'Still',
  width: 320,
  height: 180,
  fps: 30,
  assets: {
    'a-audio': { id: 'a-audio', kind: 'audio', src: 'blob:audio', durationMs: 2000 },
  },
  tracks: [
    {
      id: 't-video',
      name: 'Video',
      elements: [
        { id: 'e-title', type: 'text', text: 'Hi', startMs: 0, durationMs: 1000 },
        { id: 'e-late', type: 'text', text: 'Later', startMs: 1500, durationMs: 500 },
      ],
    },
    {
      id: 't-hidden',
      name: 'Hidden',
      hidden: true,
      elements: [{ id: 'e-hidden', type: 'text', text: 'Nope', startMs: 0, durationMs: 2000 }],
    },
    {
      id: 't-audio',
      name: 'Audio',
      elements: [{ id: 'e-audio', type: 'audio', assetId: 'a-audio', startMs: 0, durationMs: 2000 }],
    },
  ],
})

describe('renderProjectStill', () => {
  test('a time past the project end names the duration', async () => {
    await expect(renderProjectStill(project, 2500)).rejects.toThrow('Cannot grab a frame at 2.5 s. The project ends at 2 s.')
  })

  test('a time at the project end is judged against the last frame', async () => {
    await expect(renderProjectStill(project, 2000, { soloElementId: 'e-title' })).rejects.toThrow(
      'Element e-title is not on screen at 1.967 s. It spans 0 to 1 s.',
    )
  })

  test('an unknown element is named', async () => {
    await expect(renderProjectStill(project, 0, { soloElementId: 'e-missing' })).rejects.toThrow('Element e-missing is not in the project.')
  })

  test('an element outside its span names that span', async () => {
    await expect(renderProjectStill(project, 500, { soloElementId: 'e-late' })).rejects.toThrow(
      'Element e-late is not on screen at 0.5 s. It spans 1.5 to 2 s.',
    )
  })

  test('a hidden track is not on screen', async () => {
    await expect(renderProjectStill(project, 0, { soloElementId: 'e-hidden' })).rejects.toThrow(
      'Element e-hidden is not on screen at 0 s. Its track is hidden.',
    )
  })

  test('audio has no picture', async () => {
    await expect(renderProjectStill(project, 0, { soloElementId: 'e-audio' })).rejects.toThrow('Element e-audio is audio and has no picture.')
  })
})
