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

  test('the same restart counts inside the lookahead window and not past it', () => {
    const restart = (gapMs: number) => [
      ...spoken('Every morning there is a page on my desk.', 0),
      ...spoken('every morning there is a page on my printer.', gapMs),
    ]
    expect(findRetakes(restart(10_000)).map((c) => [c.startMs, c.endMs])).toEqual([[0, 10_000]])
    expect(findRetakes(restart(30_000))).toEqual([])
  })

  test('a restart may drift two opening words when it begins a phrase', () => {
    const words = [...spoken('Well so every morning there is a page on my', 0), ...spoken('Okay now every morning there is a page on my printer.', 5000)]
    expect(findRetakes(words)).toEqual([
      {
        startMs: 0,
        endMs: 5000,
        abandonedText: 'Well so every morning there is a page on my',
        keptText: 'Okay now every morning there is a page on my',
        matchedWords: 10,
      },
    ])
  })

  test('chained attempts merge into one range ending at the last take', () => {
    const words = [
      ...spoken('Now the neat thing is that it can use your computer.', 0),
      ...spoken('Now the neat thing is that it can route traffic.', 12_000),
      ...spoken('Now the neat thing is that it can run commands.', 24_000),
    ]
    expect(findRetakes(words).map((c) => [c.startMs, c.endMs, c.keptText])).toEqual([[0, 24_000, 'Now the neat thing is that it can']])
  })

  test('a pause broken by a filler still starts a phrase, and words that name Object members are plain words', () => {
    const words = [
      ...spoken('Here it is', 0),
      { text: 'um', startMs: 1000, endMs: 1200 },
      ...spoken('the constructor builds a page every single morning the constructor builds a page every single day.', 1500),
    ]
    expect(findRetakes(words).map((c) => [c.startMs, c.endMs])).toEqual([[1500, 3900]])
  })

  test('a period that arrives as its own word still ends the phrase', () => {
    const words = [
      ...spoken('Here it is', 0),
      { text: '.', startMs: 800, endMs: 800 },
      ...spoken('we print the page every single day we print the page every single morning.', 900),
    ]
    expect(findRetakes(words).map((c) => [c.startMs, c.endMs])).toEqual([[900, 3000]])
  })

  test('gotta and got to are the same words', () => {
    const words = [...spoken('I gotta shout out the team who built this', 0), ...spoken('I got to shout out the team who built this for me.', 4000)]
    expect(findRetakes(words).map((c) => [c.startMs, c.endMs])).toEqual([[0, 4000]])
  })

  test('candidates come last to first so cutting them in order never shifts a later range', () => {
    const words = [
      ...spoken('Every morning there is a page on my desk.', 0),
      ...spoken('every morning there is a page on my printer.', 5000),
      ...spoken('Now the neat thing is that it can print.', 40_000),
      ...spoken('now the neat thing is that it can run commands.', 45_000),
    ]
    expect(findRetakes(words).map((c) => [c.startMs, c.endMs])).toEqual([
      [40_000, 45_000],
      [0, 5000],
    ])
  })
})
