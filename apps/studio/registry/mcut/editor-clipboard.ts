import { createElementId, findNearestFreeSlot, getElementLocation, type EditorEngine, type ElementId, type TimelineElement } from '@mcut/timeline'

interface ClipboardEntry {
  element: TimelineElement
  trackIndex: number
  offsetMs: number
}

export interface EditorClipboard {
  entries: ClipboardEntry[]
}

export const editorClipboard: EditorClipboard = { entries: [] }

const ENVELOPE_VERSION = 1

interface ClipboardEnvelope {
  mcutClipboard: number
  entries: ClipboardEntry[]
}

function isEnvelope(value: unknown): value is ClipboardEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ClipboardEnvelope).mcutClipboard === ENVELOPE_VERSION &&
    Array.isArray((value as ClipboardEnvelope).entries)
  )
}

function writeOsClipboard(): void {
  const envelope: ClipboardEnvelope = {
    mcutClipboard: ENVELOPE_VERSION,
    entries: editorClipboard.entries,
  }
  navigator.clipboard?.writeText(JSON.stringify(envelope)).catch(() => {})
}

export function copySelection(engine: EditorEngine): number {
  const located = engine.selection.elementIds.map((id) => getElementLocation(engine.project, id)).filter((location) => location !== undefined)
  if (located.length === 0) return 0
  const earliestMs = Math.min(...located.map((l) => l.element.startMs))
  editorClipboard.entries = located.map(({ element, trackIndex }) => ({
    element: structuredClone(element),
    trackIndex,
    offsetMs: element.startMs - earliestMs,
  }))
  writeOsClipboard()
  return editorClipboard.entries.length
}

export function cutSelection(engine: EditorEngine): number {
  const count = copySelection(engine)
  if (count === 0) return 0
  engine.transact(() => {
    for (const elementId of engine.selection.elementIds) {
      try {
        engine.dispatch({ type: 'removeElement', elementId })
      } catch {}
    }
  })
  return count
}

export function pasteAtPlayhead(engine: EditorEngine): ElementId[] {
  if (editorClipboard.entries.length === 0) return []
  const anchorMs = Math.max(0, Math.round(engine.playback.state.currentTimeMs))
  const pastedIds: ElementId[] = []
  engine.transact(() => {
    for (const entry of editorClipboard.entries) {
      const project = engine.project
      const trackIndex = Math.min(entry.trackIndex, project.tracks.length - 1)
      const track = project.tracks[trackIndex]!
      const id = createElementId()
      const startMs = findNearestFreeSlot(track, anchorMs + entry.offsetMs, entry.element.durationMs)
      try {
        engine.dispatch({
          type: 'addElement',
          trackId: track.id,
          element: { ...entry.element, id, startMs },
        })
        pastedIds.push(id)
      } catch {}
    }
  })
  if (pastedIds.length > 0) engine.select(pastedIds)
  return pastedIds
}

export async function pasteAtPlayheadFromAnywhere(engine: EditorEngine): Promise<ElementId[]> {
  try {
    const text = await navigator.clipboard?.readText()
    if (text) {
      const parsed: unknown = JSON.parse(text)
      if (isEnvelope(parsed) && parsed.entries.length > 0) {
        editorClipboard.entries = parsed.entries
      }
    }
  } catch {}
  return pasteAtPlayhead(engine)
}
