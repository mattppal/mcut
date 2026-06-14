import { describe, expect, test } from 'bun:test'
import {
  applyRunStyle,
  getRunStyleAt,
  normalizeRuns,
  shiftRunsForEdit,
  type TextRun,
} from './rich-text'

const bold = { fontWeight: 700 }
const red = { color: '#ff0000' }

describe('normalizeRuns', () => {
  test('clamps, drops empties, merges adjacent equals', () => {
    const runs: TextRun[] = [
      { start: 6, end: 10, style: bold },
      { start: 0, end: 6, style: bold },
      { start: 12, end: 20, style: {} },
      { start: 18, end: 30, style: red },
    ]
    expect(normalizeRuns(runs, 24)).toEqual([
      { start: 0, end: 10, style: bold },
      { start: 18, end: 24, style: red },
    ])
  })
})

describe('applyRunStyle', () => {
  test('styles a plain range', () => {
    expect(applyRunStyle([], 2, 5, { fontWeight: 700 }, 10)).toEqual([
      { start: 2, end: 5, style: bold },
    ])
  })

  test('splits a covering run and merges the patch', () => {
    const runs: TextRun[] = [{ start: 0, end: 10, style: red }]
    expect(applyRunStyle(runs, 3, 6, { fontWeight: 700 }, 10)).toEqual([
      { start: 0, end: 3, style: red },
      { start: 3, end: 6, style: { ...red, ...bold } },
      { start: 6, end: 10, style: red },
    ])
  })

  test('null clears an override (unbold a sub-range)', () => {
    const runs: TextRun[] = [{ start: 0, end: 10, style: { ...red, ...bold } }]
    expect(applyRunStyle(runs, 4, 10, { fontWeight: null }, 10)).toEqual([
      { start: 0, end: 4, style: { ...red, ...bold } },
      { start: 4, end: 10, style: red },
    ])
  })

  test('clearing the only override removes the run entirely', () => {
    const runs: TextRun[] = [{ start: 2, end: 5, style: bold }]
    expect(applyRunStyle(runs, 0, 10, { fontWeight: null }, 10)).toEqual([])
  })
})

describe('shiftRunsForEdit', () => {
  const runs: TextRun[] = [{ start: 6, end: 11, style: bold }] // "world" in "hello world!"

  test('insertion before the run shifts it', () => {
    expect(shiftRunsForEdit(runs, 'hello world!', 'hey hello world!')).toEqual([
      { start: 10, end: 15, style: bold },
    ])
  })

  test('typing inside the run grows it', () => {
    // "wor|ld" → "worXYld"
    expect(shiftRunsForEdit(runs, 'hello world!', 'hello worXYld!')).toEqual([
      { start: 6, end: 13, style: bold },
    ])
  })

  test('typing right after the run keeps typing styled', () => {
    expect(shiftRunsForEdit(runs, 'hello world!', 'hello worldZZ!')).toEqual([
      { start: 6, end: 13, style: bold },
    ])
  })

  test('deleting across the run boundary clamps it', () => {
    // delete "o wo" (4 chars at 4..8)
    expect(shiftRunsForEdit(runs, 'hello world!', 'hellrld!')).toEqual([
      { start: 4, end: 7, style: bold },
    ])
  })

  test('deleting the whole styled span drops the run', () => {
    expect(shiftRunsForEdit(runs, 'hello world!', 'hello !')).toEqual([])
  })

  test('adjacent runs at an insertion point stay disjoint', () => {
    const two: TextRun[] = [
      { start: 0, end: 5, style: bold },
      { start: 5, end: 10, style: red },
    ]
    // insert "++" exactly at offset 5 — left run absorbs, right run shifts
    const next = shiftRunsForEdit(two, '0123456789', '01234++56789')
    expect(next).toEqual([
      { start: 0, end: 7, style: bold },
      { start: 7, end: 12, style: red },
    ])
  })
})

describe('getRunStyleAt', () => {
  test('returns the covering style or {}', () => {
    const runs: TextRun[] = [{ start: 2, end: 5, style: bold }]
    expect(getRunStyleAt(runs, 3)).toEqual(bold)
    expect(getRunStyleAt(runs, 5)).toEqual({})
  })
})
