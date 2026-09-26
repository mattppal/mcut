import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { EditorEngine, createProject } from '@mcut/timeline'
import type { ActionContext, EditorAction } from './action-registry'
import type { EditorUIValue } from './editor-ui'

const errorToasts: string[] = []

mock.module('sonner', () => ({
  toast: {
    error: (message: string) => {
      errorToasts.push(message)
    },
  },
}))

const { runEditorAction } = await import('./action-registry')

const blownUp = 'palette blew up'
const duplicateTrack = 'track "t-default" already exists'

function idle(): void {}

function context(throwOnError = false): ActionContext {
  const ui: EditorUIValue = {
    layout: 'full',
    timelineHeaderPx: 288,
    theme: 'dark',
    setTheme: idle,
    mode: 'edit',
    setMode: idle,
    editingLayoutId: null,
    setEditingLayoutId: idle,
    editingSlotIndex: null,
    setEditingSlotIndex: idle,
    editingTextId: null,
    setEditingTextId: idle,
    pxPerMs: 0.05,
    setPxPerMs: idle,
    zoomBy: idle,
    snapEnabled: true,
    setSnapEnabled: idle,
    timelineTool: 'select',
    setTimelineTool: idle,
    editMode: 'normal',
    setEditMode: idle,
    autoCrossfade: false,
    setAutoCrossfade: idle,
    previewQuality: 'auto',
    setPreviewQuality: idle,
    leftTab: 'media',
    setLeftTab: idle,
    revealLeftTab: idle,
    layoutResetToken: 0,
    resetLayout: idle,
    curveEditorTarget: null,
    setCurveEditorTarget: idle,
    setDropPreview: idle,
    timelineScrollRef: { current: null },
    setSnapGuideMs: idle,
  }
  return {
    engine: new EditorEngine({ project: createProject() }),
    ui,
    clipboard: { entries: [] },
    ...(throwOnError ? { throwOnError: true } : {}),
  }
}

const asyncFailure: EditorAction = {
  id: 'test.async-failure',
  label: 'Async failure',
  category: 'edit',
  run: async () => {
    throw new Error(blownUp)
  },
}

const asyncSuccess: EditorAction = {
  id: 'test.async-success',
  label: 'Async success',
  category: 'edit',
  run: async () => 'saved',
}

const operatorFailure: EditorAction = {
  id: 'test.operator-failure',
  label: 'Operator failure',
  category: 'track',
  operator: { id: 'edit.addTrack', input: { id: 't-default' } },
}

describe('runEditorAction', () => {
  beforeEach(() => {
    errorToasts.length = 0
  })

  test('an async action whose run rejects shows exactly one toast with its message', async () => {
    await expect(runEditorAction(asyncFailure, context())).resolves.toBeUndefined()
    expect(errorToasts).toEqual([blownUp])
  })

  test('the same action under throwOnError rejects to the caller and shows no toast', async () => {
    await expect(runEditorAction(asyncFailure, context(true))).rejects.toThrow(blownUp)
    expect(errorToasts).toEqual([])
  })

  test('a failing operator-backed action toasts its message', async () => {
    await expect(runEditorAction(operatorFailure, context())).resolves.toBeUndefined()
    expect(errorToasts).toEqual([duplicateTrack])
  })

  test('the same operator action under throwOnError rejects and shows no toast', async () => {
    await expect(runEditorAction(operatorFailure, context(true))).rejects.toThrow(duplicateTrack)
    expect(errorToasts).toEqual([])
  })

  test('a successful async action shows no toast', async () => {
    await expect(runEditorAction(asyncSuccess, context())).resolves.toBe('saved')
    expect(errorToasts).toEqual([])
  })
})
