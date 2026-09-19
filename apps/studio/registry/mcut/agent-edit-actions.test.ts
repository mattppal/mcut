import { describe, expect, test } from 'bun:test'
import { EditorEngine, createProject } from '@mcut/timeline'
import { applyOpeningClosingFades, removeTranscriptSilence } from './agent-edit-actions'

describe('agent edit action inputs', () => {
  test('a wrong-typed field is rejected with the field named', () => {
    const engine = new EditorEngine({ project: createProject() })

    expect(() => removeTranscriptSilence(engine, { paddingMs: '0' })).toThrow('✖ Invalid input: expected number, received string\n  → at paddingMs')
  })

  test("a field outside the action's schema is rejected", () => {
    const engine = new EditorEngine({ project: createProject() })

    expect(() => applyOpeningClosingFades(engine, { durationMs: 500, fadeMs: 1 })).toThrow('✖ Unrecognized key: "fadeMs"')
  })

  test('an element id without the e- prefix is rejected before any lookup', () => {
    const engine = new EditorEngine({ project: createProject() })

    expect(() => applyOpeningClosingFades(engine, { elementId: 'video' })).toThrow('✖ invalid element id (expected "e-..." prefix)\n  → at elementId')
  })
})
