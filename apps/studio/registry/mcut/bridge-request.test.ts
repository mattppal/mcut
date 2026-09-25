import { describe, expect, test } from 'bun:test'
import { parseBridgeFrame } from './bridge-request'

describe('parseBridgeFrame', () => {
  test('a valid frame parses to the exact request', () => {
    expect(parseBridgeFrame('{"id":"1","type":"search_transcript","payload":{"query":"hello"}}')).toEqual({
      ok: true,
      request: { id: '1', type: 'search_transcript', payload: { query: 'hello' } },
    })
  })

  test("a frame without a payload gets the tool's empty default", () => {
    expect(parseBridgeFrame('{"id":"4","type":"get_transcript"}')).toEqual({
      ok: true,
      request: { id: '4', type: 'get_transcript', payload: {} },
    })
  })

  test('an ensure_voice_stems frame keeps its clip ids and names a bad one by index', () => {
    expect(parseBridgeFrame('{"id":"6","type":"ensure_voice_stems","payload":{"elementIds":["e-talk"],"wait":false}}')).toEqual({
      ok: true,
      request: { id: '6', type: 'ensure_voice_stems', payload: { elementIds: ['e-talk'], wait: false } },
    })
    expect(parseBridgeFrame('{"id":"7","type":"ensure_voice_stems","payload":{"elementIds":["e-talk","talk"]}}')).toEqual({
      ok: false,
      id: '7',
      error: {
        name: 'BridgeRequestError',
        code: 'invalid-request',
        message: '✖ invalid element id (expected "e-..." prefix)\n  → at payload.elementIds[1]',
      },
    })
  })

  test('a center_person frame without a payload gets the default aspect and smoothing', () => {
    expect(parseBridgeFrame('{"id":"6","type":"center_person"}')).toEqual({
      ok: true,
      request: { id: '6', type: 'center_person', payload: { aspect: 9 / 16, smoothing: 0.5 } },
    })
  })

  test('a frame missing a required field is rejected with the field named and the id kept', () => {
    expect(parseBridgeFrame('{"id":"2","type":"search_transcript","payload":{}}')).toEqual({
      ok: false,
      id: '2',
      error: {
        name: 'BridgeRequestError',
        code: 'invalid-request',
        message: '✖ Invalid input: expected string, received undefined\n  → at payload.query',
      },
    })
  })

  test('a wrong-typed payload field is rejected with the field named', () => {
    expect(parseBridgeFrame('{"id":"5","type":"ensure_transcript","payload":{"elementId":"e-video","replace":"yes"}}')).toEqual({
      ok: false,
      id: '5',
      error: {
        name: 'BridgeRequestError',
        code: 'invalid-request',
        message: '✖ Invalid input: expected boolean, received string\n  → at payload.replace',
      },
    })
  })

  test('a transact frame parses each sub-request in the closed union', () => {
    expect(
      parseBridgeFrame(
        '{"id":"8","type":"transact","payload":{"requests":[{"type":"dispatch_command","commandName":"applyAnimationPreset","input":{"elementId":"e-video","preset":"fade-in"}},{"type":"run_operator","operatorId":"playback.toggle"}]}}',
      ),
    ).toEqual({
      ok: true,
      request: {
        id: '8',
        type: 'transact',
        payload: {
          requests: [
            {
              type: 'dispatch_command',
              commandName: 'applyAnimationPreset',
              input: { elementId: 'e-video', preset: 'fade-in' },
            },
            { type: 'run_operator', operatorId: 'playback.toggle', input: {} },
          ],
        },
      },
    })
  })

  test('a transact sub-request outside the closed union is rejected', () => {
    const frame = parseBridgeFrame('{"id":"9","type":"transact","payload":{"requests":[{"type":"undo"}]}}')
    expect(frame.ok).toBe(false)
    if (frame.ok) return
    expect(frame.id).toBe('9')
    expect(frame.error.code).toBe('invalid-request')
    expect(frame.error.message).toBe(
      "✖ Invalid discriminator value. Expected 'dispatch_command' | 'run_operator' | 'run_action' | 'apply_commands'\n  → at payload.requests[0].type",
    )
  })

  test('an unknown request type is rejected at the type field', () => {
    const frame = parseBridgeFrame('{"id":"3","type":"nope"}')
    expect(frame.ok).toBe(false)
    if (frame.ok) return
    expect(frame.id).toBe('3')
    expect(frame.error.code).toBe('invalid-request')
    expect(frame.error.message).toEndWith('→ at type')
  })

  test('a frame that is not JSON is rejected without an id', () => {
    expect(parseBridgeFrame('nope')).toEqual({
      ok: false,
      id: undefined,
      error: {
        name: 'BridgeRequestError',
        code: 'invalid-request',
        message: 'Bridge frame is not valid JSON.',
      },
    })
  })

  test('a JSON value that is not an object is rejected without an id', () => {
    expect(parseBridgeFrame('[1,2]')).toEqual({
      ok: false,
      id: undefined,
      error: {
        name: 'BridgeRequestError',
        code: 'invalid-request',
        message: '✖ Invalid input: expected object, received array',
      },
    })
  })
})
