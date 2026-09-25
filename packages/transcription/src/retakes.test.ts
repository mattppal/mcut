import { describe, expect, test } from 'bun:test'
import { findRetakes } from './retakes'

const spoken = (line: string, fromMs: number, gapMs = 0) =>
  line.split(' ').map((text, i) => ({ text, startMs: fromMs + i * 300 + (i > 0 ? gapMs : 0), endMs: fromMs + i * 300 + 250 + (i > 0 ? gapMs : 0) }))

describe('findRetakes', () => {
  test('a restarted sentence yields the abandoned take up to the kept take', () => {
    const words = [
      ...spoken('Today we look at the brief.', 0),
      ...spoken('Every morning there is a page on my', 3000),
      ...spoken('um each morning there is a page on my printer.', 6000),
    ]
    expect(findRetakes(words)).toEqual([
      { startMs: 3000, endMs: 6300, abandonedText: 'Every morning there is a page on my', keptText: 'each morning there is a page on my', matchedWords: 8 },
    ])
  })

  test('a restart with no pause still counts, and three attempts keep only the last', () => {
    const words = spoken('the events box shows the events box shows the events box shows my day', 0)
    expect(findRetakes(words, { minMatchWords: 4 })).toEqual([
      { startMs: 0, endMs: 2400, abandonedText: 'the events box shows the events box shows', keptText: 'the events box shows', matchedWords: 4 },
    ])
  })

  test('an enumeration that repeats only its opener is not a retake unless minMatchWords allows it', () => {
    const words = spoken('I need some way to print. I need some way to draw. I need some way to sync.', 0)
    expect(findRetakes(words)).toEqual([])
    expect(findRetakes(words, { minMatchWords: 4 }).map((c) => c.keptText)).toEqual(['I need some way to'])
  })

  test('a phrase repeated after the lookahead window is not a retake', () => {
    const words = [...spoken('I think this is great.', 0), ...spoken('I think this layout works.', 30_000)]
    expect(findRetakes(words)).toEqual([])
  })
})
