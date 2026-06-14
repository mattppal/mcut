import { z } from 'zod'
import {
  animatableProperties,
  animatablePropertySchema,
  assetIdSchema,
  createMarkerId,
  elementIdSchema,
  getElement,
  getLinkedElementIds,
  getProjectDurationMs,
  quantizeMsToFrame,
  toOtioJson,
  trackIdSchema,
} from '@mcut/timeline'
import type { AnimatableProperty } from '@mcut/timeline'
import { emptyInputSchema, type EditorOperatorRegistry } from './operators'
import {
  addTextAtPlayhead,
  allElementIds,
  clipEdges,
  duplicateSelection,
  elementForAsset,
  insertElementAtPlayhead,
  keyframeTimes,
  moveKeyframesAtTime,
  removeKeyframesAtTime,
  removeSelection,
  selectTrackElements,
  shuttle,
  splitAllAtPlayhead,
  splitSelectionAtPlayhead,
  toggleMasterKeyframe,
  toggleSoloTrack,
  trackOfSelection,
  trimSelectionToPlayhead,
} from './timeline-operators'

const hasSelection = ({ engine }: { engine: import('@mcut/timeline').EditorEngine }) =>
  engine.selection.elementIds.length > 0

const hasClips = ({ engine }: { engine: import('@mcut/timeline').EditorEngine }) =>
  engine.project.tracks.some((track) => track.elements.length > 0)

const propertiesSchema = z.array(animatablePropertySchema).optional()

/**
 * Register SDK-level user operations. These are contextual editor operators,
 * not just document reducers: UI buttons, hotkeys, agent transports, and tests
 * can all execute the same operation by id.
 */
export function registerCoreOperators(registry: EditorOperatorRegistry): EditorOperatorRegistry {
  registry.define({
    id: 'playback.toggle',
    label: 'Play / pause',
    description: 'Toggle timeline playback.',
    category: 'playback',
    inputSchema: emptyInputSchema,
    run: ({ engine }) => (engine.playback.state.isPlaying ? engine.pause() : engine.play()),
  })

  registry.define({
    id: 'playback.seek',
    label: 'Seek',
    description: 'Move the playhead to an absolute timeline time in milliseconds.',
    category: 'playback',
    inputSchema: z.object({ timeMs: z.number().nonnegative() }),
    run: ({ engine }, { timeMs }) => engine.seek(timeMs),
  })

  registry.define({
    id: 'playback.goStart',
    label: 'Go to start',
    description: 'Move the playhead to the beginning of the project.',
    category: 'playback',
    inputSchema: emptyInputSchema,
    run: ({ engine }) => engine.seek(0),
  })

  registry.define({
    id: 'playback.goEnd',
    label: 'Go to end',
    description: 'Move the playhead to the end of the project.',
    category: 'playback',
    inputSchema: emptyInputSchema,
    run: ({ engine }) => engine.seek(getProjectDurationMs(engine.project)),
  })

  registry.define({
    id: 'playback.step',
    label: 'Step playhead',
    description: 'Move the playhead by a relative delta in milliseconds.',
    category: 'playback',
    inputSchema: z.object({ deltaMs: z.number() }),
    run: ({ engine }, { deltaMs }) => engine.seek(engine.playback.state.currentTimeMs + deltaMs),
  })

  registry.define({
    id: 'playback.edgePrevious',
    label: 'Jump to previous clip edge',
    description: 'Seek to the nearest previous clip boundary.',
    category: 'playback',
    inputSchema: emptyInputSchema,
    run: ({ engine }) => {
      const now = Math.round(engine.playback.state.currentTimeMs)
      const target = [...clipEdges(engine)].reverse().find((edge) => edge < now)
      if (target !== undefined) engine.seek(target)
    },
  })

  registry.define({
    id: 'playback.edgeNext',
    label: 'Jump to next clip edge',
    description: 'Seek to the nearest next clip boundary.',
    category: 'playback',
    inputSchema: emptyInputSchema,
    run: ({ engine }) => {
      const now = Math.round(engine.playback.state.currentTimeMs)
      const target = clipEdges(engine).find((edge) => edge > now)
      if (target !== undefined) engine.seek(target)
    },
  })

  registry.define({
    id: 'playback.shuttle',
    label: 'Shuttle playback',
    description: 'Apply J/K/L-style shuttle playback. Direction is -1, 0, or 1.',
    category: 'playback',
    inputSchema: z.object({ direction: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }),
    run: ({ engine }, { direction }) => shuttle(engine, direction),
  })

  registry.define({
    id: 'selection.selectAll',
    label: 'Select all clips',
    description: 'Select every timeline element in the project.',
    category: 'selection',
    inputSchema: emptyInputSchema,
    enabled: hasClips,
    run: ({ engine }) => engine.select(allElementIds(engine)),
  })

  registry.define({
    id: 'selection.select',
    label: 'Select clips',
    description: 'Replace the current element selection.',
    category: 'selection',
    inputSchema: z.object({ elementIds: z.array(elementIdSchema) }),
    run: ({ engine }, { elementIds }) => engine.select(elementIds),
  })

  registry.define({
    id: 'selection.clear',
    label: 'Clear selection',
    description: 'Clear the current timeline selection.',
    category: 'selection',
    inputSchema: emptyInputSchema,
    enabled: hasSelection,
    run: ({ engine }) => engine.clearSelection(),
  })

  registry.define({
    id: 'selection.selectTrack',
    label: 'Select all clips on track',
    description: 'Select every timeline element on a specific track.',
    category: 'selection',
    inputSchema: z.object({ trackId: trackIdSchema }),
    run: ({ engine }, { trackId }) => selectTrackElements(engine, trackId),
  })

  registry.define({
    id: 'edit.undo',
    label: 'Undo',
    description: 'Undo the most recent undoable edit.',
    category: 'edit',
    inputSchema: emptyInputSchema,
    enabled: ({ engine }) => engine.canUndo(),
    run: ({ engine }) => engine.undo(),
  })

  registry.define({
    id: 'edit.redo',
    label: 'Redo',
    description: 'Redo the most recently undone edit.',
    category: 'edit',
    inputSchema: emptyInputSchema,
    enabled: ({ engine }) => engine.canRedo(),
    run: ({ engine }) => engine.redo(),
  })

  registry.define({
    id: 'edit.splitSelectionAtPlayhead',
    label: 'Split selection at playhead',
    description: 'Split every selected clip crossed by the current playhead.',
    category: 'edit',
    inputSchema: emptyInputSchema,
    enabled: hasSelection,
    run: ({ engine }) => splitSelectionAtPlayhead(engine),
  })

  registry.define({
    id: 'edit.deleteSelection',
    label: 'Delete selection',
    description: 'Remove all selected timeline elements.',
    category: 'edit',
    inputSchema: emptyInputSchema,
    enabled: hasSelection,
    run: ({ engine }) => removeSelection(engine),
  })

  registry.define({
    id: 'edit.duplicateSelection',
    label: 'Duplicate selection',
    description: 'Duplicate all selected elements directly after themselves on their tracks.',
    category: 'edit',
    inputSchema: emptyInputSchema,
    enabled: hasSelection,
    run: ({ engine }) => duplicateSelection(engine),
  })

  registry.define({
    id: 'edit.rippleDeleteSelection',
    label: 'Ripple delete selection',
    description: 'Remove selected elements and close the resulting gaps.',
    category: 'edit',
    inputSchema: emptyInputSchema,
    enabled: hasSelection,
    run: ({ engine }) =>
      engine.dispatch(
        { type: 'rippleDelete', elementIds: [...engine.selection.elementIds] },
        // Declared so undo restores the deleted clips' selection.
        { selection: [] },
      ),
  })

  registry.define({
    id: 'edit.trimSelectionToPlayhead',
    label: 'Trim selection to playhead',
    description: 'Trim the start or end of each selected clip to the playhead.',
    category: 'edit',
    inputSchema: z.object({ edge: z.enum(['start', 'end']) }),
    enabled: hasSelection,
    run: ({ engine }, { edge }) => trimSelectionToPlayhead(engine, edge),
  })

  registry.define({
    id: 'edit.splitAllAtPlayhead',
    label: 'Split all tracks at playhead',
    description: 'Split every unlocked clip crossed by the current playhead.',
    category: 'edit',
    inputSchema: emptyInputSchema,
    run: ({ engine }) => splitAllAtPlayhead(engine),
  })

  registry.define({
    id: 'edit.addTextAtPlayhead',
    label: 'Add text at playhead',
    description: 'Insert a default text clip at the playhead.',
    category: 'edit',
    inputSchema: z.object({ text: z.string().optional() }),
    run: ({ engine }, { text }) => ({ elementId: addTextAtPlayhead(engine, text) }),
  })

  registry.define({
    id: 'edit.addTrack',
    label: 'Add track',
    description: 'Add a new empty timeline track.',
    category: 'track',
    inputSchema: z.object({ id: trackIdSchema.optional(), name: z.string().optional() }),
    run: ({ engine }, input) => engine.dispatch({ type: 'addTrack', ...input }),
  })

  registry.define({
    id: 'track.deleteCurrent',
    label: 'Delete current track',
    description: 'Delete the track containing the first selected element.',
    category: 'track',
    inputSchema: emptyInputSchema,
    enabled: ({ engine }) => trackOfSelection(engine) !== undefined,
    run: ({ engine }) => {
      const track = trackOfSelection(engine)
      if (track) engine.dispatch({ type: 'removeTrack', trackId: track.id })
    },
  })

  registry.define({
    id: 'track.solo',
    label: 'Solo track',
    description: 'Toggle solo for the requested track, muting or unmuting all other tracks.',
    category: 'track',
    inputSchema: z.object({ trackId: trackIdSchema }),
    enabled: ({ engine }) => engine.project.tracks.length > 1,
    run: ({ engine }, { trackId }) => toggleSoloTrack(engine, trackId),
  })

  registry.define({
    id: 'track.soloCurrent',
    label: 'Solo current track',
    description: 'Toggle solo for the track containing the first selected element.',
    category: 'track',
    inputSchema: emptyInputSchema,
    enabled: ({ engine }) => trackOfSelection(engine) !== undefined && engine.project.tracks.length > 1,
    run: ({ engine }) => {
      const track = trackOfSelection(engine)
      if (track) toggleSoloTrack(engine, track.id)
    },
  })

  registry.define({
    id: 'media.insertAssetAtPlayhead',
    label: 'Insert asset at playhead',
    description: 'Insert a media-bin asset at the playhead using the same default placement as the UI.',
    category: 'media',
    inputSchema: z.object({ assetId: assetIdSchema }),
    run: ({ engine }, { assetId }) => {
      const asset = engine.project.assets[assetId]
      if (!asset) throw new Error(`no asset "${assetId}"`)
      return { elementId: insertElementAtPlayhead(engine, elementForAsset(engine, asset)) }
    },
  })

  registry.define({
    id: 'keyframes.previous',
    label: 'Previous keyframe',
    description: 'Seek to the previous keyframe time on the first selected element.',
    category: 'keyframes',
    inputSchema: emptyInputSchema,
    enabled: ({ engine }) => {
      const id = engine.selection.elementIds[0]
      const element = id ? getElement(engine.project, id) : undefined
      return Boolean(element && keyframeTimes(element).length > 0)
    },
    run: ({ engine }) => {
      const id = engine.selection.elementIds[0]
      const element = id ? getElement(engine.project, id) : undefined
      if (!element) return
      const now = Math.round(engine.playback.state.currentTimeMs)
      const target = [...keyframeTimes(element)].reverse().find((t) => element.startMs + t < now)
      if (target !== undefined) engine.seek(element.startMs + target)
    },
  })

  registry.define({
    id: 'keyframes.next',
    label: 'Next keyframe',
    description: 'Seek to the next keyframe time on the first selected element.',
    category: 'keyframes',
    inputSchema: emptyInputSchema,
    enabled: ({ engine }) => {
      const id = engine.selection.elementIds[0]
      const element = id ? getElement(engine.project, id) : undefined
      return Boolean(element && keyframeTimes(element).length > 0)
    },
    run: ({ engine }) => {
      const id = engine.selection.elementIds[0]
      const element = id ? getElement(engine.project, id) : undefined
      if (!element) return
      const now = Math.round(engine.playback.state.currentTimeMs)
      const target = keyframeTimes(element).find((t) => element.startMs + t > now)
      if (target !== undefined) engine.seek(element.startMs + target)
    },
  })

  registry.define({
    id: 'keyframes.toggleMasterAtPlayhead',
    label: 'Add/remove keyframe at playhead',
    description: 'Toggle master visual keyframes on the first selected element at the playhead.',
    category: 'keyframes',
    inputSchema: emptyInputSchema,
    enabled: hasSelection,
    run: ({ engine }) => toggleMasterKeyframe(engine),
  })

  registry.define({
    id: 'keyframes.moveAtTime',
    label: 'Move keyframes at time',
    description: 'Move every keyframe at an element-local time, optionally restricted to properties.',
    category: 'keyframes',
    inputSchema: z.object({
      elementId: elementIdSchema,
      fromTimeMs: z.number().int().nonnegative(),
      toTimeMs: z.number().int().nonnegative(),
      properties: propertiesSchema,
    }),
    run: ({ engine }, { elementId, fromTimeMs, toTimeMs, properties }) =>
      moveKeyframesAtTime(engine, elementId, fromTimeMs, toTimeMs, properties),
  })

  registry.define({
    id: 'keyframes.removeAtTime',
    label: 'Remove keyframes at time',
    description: 'Remove every keyframe at an element-local time, optionally restricted to properties.',
    category: 'keyframes',
    inputSchema: z.object({
      elementId: elementIdSchema,
      timeMs: z.number().int().nonnegative(),
      properties: propertiesSchema,
    }),
    run: ({ engine }, { elementId, timeMs, properties }) =>
      removeKeyframesAtTime(engine, elementId, timeMs, properties),
  })

  registry.define({
    id: 'keyframes.setAtTime',
    label: 'Set keyframe values',
    description: 'Set one or more property keyframes at an element-local time.',
    category: 'keyframes',
    inputSchema: z.object({
      elementId: elementIdSchema,
      timeMs: z.number().int().nonnegative(),
      values: z.partialRecord(animatablePropertySchema, z.number()),
    }),
    run: ({ engine }, { elementId, timeMs, values }) => {
      const element = getElement(engine.project, elementId)
      if (!element) return
      const allowed = new Set<AnimatableProperty>(animatableProperties(element))
      engine.transact(() => {
        for (const [property, value] of Object.entries(values)) {
          if (!allowed.has(property as AnimatableProperty) || value === undefined) continue
          engine.dispatch({
            type: 'setKeyframe',
            elementId,
            property: property as AnimatableProperty,
            timeMs,
            value,
          })
        }
      })
    },
  })

  // Toggle within half a frame: pressing M on an existing marker removes it.
  const markerNear = (engine: import('@mcut/timeline').EditorEngine, timeMs: number) => {
    const toleranceMs = 500 / engine.project.fps
    return engine.project.markers.find((m) => Math.abs(m.timeMs - timeMs) <= toleranceMs)
  }

  registry.define({
    id: 'markers.toggleAtPlayhead',
    label: 'Add/remove marker at playhead',
    description: 'Add a timeline marker at the playhead, or remove the one already there.',
    category: 'markers',
    inputSchema: z.object({ label: z.string().optional(), color: z.string().optional() }),
    run: ({ engine }, input) => {
      const timeMs = quantizeMsToFrame(engine.playback.state.currentTimeMs, engine.project.fps)
      const existing = markerNear(engine, timeMs)
      if (existing) {
        engine.dispatch({ type: 'removeMarker', markerId: existing.id })
        return { removed: existing.id }
      }
      const markerId = createMarkerId()
      engine.dispatch({ type: 'addMarker', id: markerId, timeMs, ...input })
      return { added: markerId }
    },
  })

  registry.define({
    id: 'markers.previous',
    label: 'Previous marker',
    description: 'Seek to the nearest marker before the playhead.',
    category: 'markers',
    inputSchema: emptyInputSchema,
    enabled: ({ engine }) => engine.project.markers.length > 0,
    run: ({ engine }) => {
      const now = Math.round(engine.playback.state.currentTimeMs)
      const target = [...engine.project.markers].reverse().find((m) => m.timeMs < now)
      if (target) engine.seek(target.timeMs)
    },
  })

  registry.define({
    id: 'markers.next',
    label: 'Next marker',
    description: 'Seek to the nearest marker after the playhead.',
    category: 'markers',
    inputSchema: emptyInputSchema,
    enabled: ({ engine }) => engine.project.markers.length > 0,
    run: ({ engine }) => {
      const now = Math.round(engine.playback.state.currentTimeMs)
      const target = engine.project.markers.find((m) => m.timeMs > now)
      if (target) engine.seek(target.timeMs)
    },
  })

  registry.define({
    id: 'edit.toggleReverseSelection',
    label: 'Reverse selected clips',
    description: 'Toggle reverse playback on the selected video/audio clips.',
    category: 'edit',
    inputSchema: emptyInputSchema,
    enabled: ({ engine }) =>
      engine.selection.elementIds.some((id) => {
        const element = getElement(engine.project, id)
        return element?.type === 'video' || element?.type === 'audio'
      }),
    run: ({ engine }) => {
      engine.transact(() => {
        for (const id of engine.selection.elementIds) {
          const element = getElement(engine.project, id)
          if (element?.type !== 'video' && element?.type !== 'audio') continue
          engine.dispatch({
            type: 'updateElement',
            elementId: id,
            patch: { reversed: !element.reversed },
          })
        }
      })
    },
  })

  registry.define({
    id: 'edit.slipSelection',
    label: 'Slip selection',
    description:
      'Slip the selected clips: shift which part of the source plays without moving them. ' +
      'Linked partners (detached audio) slip together.',
    category: 'edit',
    inputSchema: z.object({ deltaMs: z.number().int() }),
    enabled: hasSelection,
    run: ({ engine }, { deltaMs }) => {
      const ids = [
        ...new Set(
          engine.selection.elementIds.flatMap((id) => getLinkedElementIds(engine.project, id)),
        ),
      ]
      engine.transact(() => {
        for (const elementId of ids) {
          try {
            engine.dispatch({ type: 'slipElement', elementId, deltaMs })
          } catch {
            // Not slippable or out of media: skip this clip.
          }
        }
      })
    },
  })

  registry.define({
    id: 'edit.rollEdit',
    label: 'Roll edit',
    description:
      'Roll the cut between the first selected clip and its exactly-adjacent next clip ' +
      'by deltaMs. The boundary moves; everything else stays put.',
    category: 'edit',
    inputSchema: z.object({ deltaMs: z.number().int(), elementId: elementIdSchema.optional() }),
    enabled: hasSelection,
    run: ({ engine }, { deltaMs, elementId }) => {
      const target = elementId ?? engine.selection.elementIds[0]
      if (!target) return
      engine.dispatch({ type: 'rollEdit', elementId: target, deltaMs })
    },
  })

  registry.define({
    id: 'edit.slideSelection',
    label: 'Slide selection',
    description:
      'Slide the first selected clip along its exactly-adjacent neighbors by deltaMs: ' +
      'the clip moves keeping its content; the neighbors absorb the change.',
    category: 'edit',
    inputSchema: z.object({ deltaMs: z.number().int() }),
    enabled: hasSelection,
    run: ({ engine }, { deltaMs }) => {
      const target = engine.selection.elementIds[0]
      if (!target) return
      engine.dispatch({ type: 'slideElement', elementId: target, deltaMs })
    },
  })

  registry.define({
    id: 'edit.rippleTrimToPlayhead',
    label: 'Ripple trim to playhead',
    description:
      'Ripple-trim the first selected clip\'s start or end to the playhead: the clip edge ' +
      'moves to the playhead and everything downstream shifts to keep the timeline gap-free.',
    category: 'edit',
    inputSchema: z.object({
      edge: z.enum(['start', 'end']),
      scope: z.enum(['track', 'timeline']).optional(),
    }),
    enabled: hasSelection,
    run: ({ engine }, { edge, scope }) => {
      const id = engine.selection.elementIds[0]
      const element = id ? getElement(engine.project, id) : undefined
      if (!element) return
      const playheadMs = quantizeMsToFrame(engine.playback.state.currentTimeMs, engine.project.fps)
      const deltaMs =
        edge === 'end'
          ? playheadMs - (element.startMs + element.durationMs)
          : playheadMs - element.startMs
      if (deltaMs === 0) return
      engine.dispatch({
        type: 'rippleTrim',
        elementId: element.id,
        edge,
        deltaMs,
        ...(scope ? { scope } : {}),
      })
    },
  })

  registry.define({
    id: 'media.exportOtio',
    label: 'Export OpenTimelineIO',
    description:
      'Serialize the project as an OpenTimelineIO (.otio) JSON document for interchange ' +
      'with Resolve and other NLEs.',
    category: 'media',
    inputSchema: emptyInputSchema,
    enabled: hasClips,
    run: ({ engine }) => ({ otio: toOtioJson(engine.project) }),
  })

  registry.define({
    id: 'multicam.createFromSelection',
    label: 'Create multicam from selected clips',
    description: 'Create a multicam element from selected video clips.',
    category: 'multicam',
    inputSchema: emptyInputSchema,
    enabled: ({ engine }) =>
      engine.selection.elementIds.some((id) =>
        engine.project.tracks.some((t) => t.elements.some((e) => e.id === id && e.type === 'video')),
      ),
    run: ({ engine }) => {
      const videoIds = engine.selection.elementIds.filter((id) =>
        engine.project.tracks.some((t) => t.elements.some((e) => e.id === id && e.type === 'video')),
      )
      engine.dispatch({ type: 'createMulticam', elementIds: videoIds })
    },
  })

  return registry
}
