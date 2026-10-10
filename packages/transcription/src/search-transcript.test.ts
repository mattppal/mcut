import { expect, test } from 'bun:test'
import { applyCommand, createProject, type Project } from '@mcut/timeline'
import { searchProjectTranscript } from './search-transcript'

function captioned(lines: Array<{ startMs: number; words: Array<[string, number, number]> }>): Project {
  let project = applyCommand(createProject(), { type: 'addTrack', id: 't-captions', name: 'Captions' })
  for (const [i, { startMs, words }] of lines.entries()) {
    const last = words.at(-1)?.[2] ?? 0
    project = applyCommand(project, {
      type: 'addElement',
      trackId: 't-captions',
      element: {
        id: `e-cap-${i}`,
        type: 'caption',
        startMs,
        durationMs: last,
        text: words.map(([text]) => text).join(' '),
        words: words.map(([text, from, to]) => ({ text, startMs: from, endMs: to })),
      },
    })
  }
  return project
}

const project = captioned([
  {
    startMs: 10_000,
    words: [
      ['I', 0, 100],
      ['bought', 150, 400],
      ['a', 450, 500],
      ['printer.', 550, 1000],
    ],
  },
  {
    startMs: 11_600,
    words: [
      ['And', 0, 200],
      ['it', 250, 350],
      ['works.', 400, 800],
    ],
  },
])

test('a phrase across a caption boundary matches with punctuation ignored, its context, and the pause after the clause', () => {
  const [result] = searchProjectTranscript(project, ['printer and'])
  expect(result?.matches).toEqual([
    {
      text: 'printer. And',
      startMs: 10_550,
      endMs: 11_800,
      before: 'I bought a',
      after: 'it works.',
      pauseBeforeMs: 50,
      pauseAfterMs: 50,
      captionId: 'e-cap-0',
      trackId: 't-captions',
      trackName: 'Captions',
    },
  ])
  expect(searchProjectTranscript(project, ['printer'])[0]?.matches[0]?.pauseAfterMs).toBe(600)
})

test('several queries come back as one result each, in order', () => {
  expect(searchProjectTranscript(project, ['works', 'fax', 'print']).map(({ query, count }) => ({ query, count }))).toEqual([
    { query: 'works', count: 1 },
    { query: 'fax', count: 0 },
    { query: 'print', count: 1 },
  ])
})
