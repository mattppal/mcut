import {
  animatableProperties,
  canPlace,
  createElementId,
  createLinkId,
  createTrackId,
  findNearestFreeSlot,
  quantizeMsToFrame,
  getAnimatedValue,
  getElement,
  getElementLocation,
  getLinkedElementIds,
  getKeyframes,
  hasKeyframes,
  isOnKeyframe,
  type AnimatableProperty,
  type AssetRef,
  type EditorEngine,
  type TextStyle,
  type TimelineElement,
  type TimelineElementInput,
  type Track,
  type TrackId,
} from '@mcut/timeline'

function getFitScale(project: { width: number; height: number }, width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1
  return Math.min(project.width / width, project.height / height)
}

/** Tracks that hold only captions are reserved for the caption workflow. */
function isCaptionTrack(track: Track): boolean {
  return track.elements.length > 0 && track.elements.every((e) => e.type === 'caption')
}

/**
 * Insert an element at the playhead on the topmost unlocked track with room,
 * creating a new track when none fits. Returns the new element's id.
 */
export function insertElementAtPlayhead(engine: EditorEngine, element: TimelineElementInput): string {
  const startMs = quantizeMsToFrame(engine.playback.state.currentTimeMs, engine.project.fps)
  const id = element.id ?? createElementId()
  engine.transact(
    () => {
      const project = engine.project
      let trackId: Track['id'] | undefined
      for (let i = project.tracks.length - 1; i >= 0; i--) {
        const track = project.tracks[i]!
        if (track.locked || isCaptionTrack(track)) continue
        if (canPlace(track, startMs, element.durationMs)) {
          trackId = track.id
          break
        }
      }
      if (!trackId) {
        trackId = createTrackId()
        engine.dispatch({ type: 'addTrack', id: trackId })
      }
      engine.dispatch({
        type: 'addElement',
        trackId,
        element: { ...element, id, startMs },
      })
    },
    { selection: [id] },
  )
  return id
}

/** Default timeline element for a media-bin asset. */
export function elementForAsset(engine: EditorEngine, asset: AssetRef): TimelineElementInput {
  const fit = asset.width && asset.height ? getFitScale(engine.project, asset.width, asset.height) : 1
  const transform = { x: 0, y: 0, scaleX: fit, scaleY: fit, rotation: 0 }
  if (asset.kind === 'video') {
    return {
      type: 'video',
      startMs: 0,
      durationMs: asset.durationMs ?? 3000,
      assetId: asset.id,
      trimStartMs: 0,
      transform,
      opacity: 1,
      volume: 1,
      muted: false,
    }
  }
  if (asset.kind === 'audio') {
    return {
      type: 'audio',
      startMs: 0,
      durationMs: asset.durationMs ?? 3000,
      assetId: asset.id,
      trimStartMs: 0,
      volume: 1,
      muted: false,
    }
  }
  return {
    type: 'image',
    startMs: 0,
    durationMs: 4000,
    assetId: asset.id,
    transform,
    opacity: 1,
  }
}

/**
 * Split every selected element at the playhead, when it crosses one. Linked
 * partners (shared `linkId`, e.g. detached audio) split along with their
 * selected element, and the right halves are re-paired under a fresh linkId
 * so each side stays a coherent pair.
 */
export function splitSelectionAtPlayhead(engine: EditorEngine): void {
  // Cuts land on frame boundaries (the documented editing-surface contract).
  const atMs = quantizeMsToFrame(engine.playback.state.currentTimeMs, engine.project.fps)
  if (engine.selection.elementIds.length === 0) return
  const ids = [
    ...new Set(
      engine.selection.elementIds.flatMap((id) => getLinkedElementIds(engine.project, id)),
    ),
  ]
  engine.transact(() => {
    // Right-half ids grouped by the original linkId, for re-pairing below.
    const rightsByLink = new Map<string, `e-${string}`[]>()
    for (const elementId of ids) {
      const location = getElementLocation(engine.project, elementId)
      if (!location) continue
      const { element } = location
      if (atMs <= element.startMs || atMs >= element.startMs + element.durationMs) continue
      const rightElementId = createElementId()
      try {
        engine.dispatch({ type: 'splitElement', elementId, atMs, rightElementId })
      } catch {
        // Split point too close to an edge: skip this element.
        continue
      }
      if (element.linkId) {
        rightsByLink.set(element.linkId, [...(rightsByLink.get(element.linkId) ?? []), rightElementId])
      }
    }
    for (const rightIds of rightsByLink.values()) {
      const linkId = rightIds.length > 1 ? createLinkId() : undefined
      for (const elementId of rightIds) {
        // Single right half (partner didn't split): drop the stale link
        // rather than leave it paired with the partner's left half.
        engine.dispatch({ type: 'updateElement', elementId, patch: { linkId } })
      }
    }
  })
}

/** Clear the `linkId` pairing on an element and all its linked partners. */
export function unlinkElements(engine: EditorEngine, elementId: `e-${string}`): void {
  const ids = getLinkedElementIds(engine.project, elementId)
  engine.transact(() => {
    for (const id of ids) {
      engine.dispatch({ type: 'updateElement', elementId: id, patch: { linkId: undefined } })
    }
  })
}

/** Remove every selected element. */
export function removeSelection(engine: EditorEngine): void {
  const ids = engine.selection.elementIds
  if (ids.length === 0) return
  engine.transact(
    () => {
      for (const elementId of ids) {
        try {
          engine.dispatch({ type: 'removeElement', elementId })
        } catch {
          // Already removed.
        }
      }
    },
    // Declared so undo restores the deleted clips' selection.
    { selection: [] },
  )
}

/** Insert a default text element at the playhead. */
export function addTextAtPlayhead(engine: EditorEngine, text = 'Your text'): string {
  return insertElementAtPlayhead(engine, {
    type: 'text',
    startMs: 0,
    durationMs: 3000,
    text,
    style: {
      fontFamily: 'sans-serif',
      fontSize: 96,
      fontWeight: 700,
      fontStyle: 'normal',
      color: '#ffffff',
      align: 'center',
    },
    box: { width: Math.round(engine.project.width * 0.7), overflow: 'clip' },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    opacity: 1,
  })
}

/**
 * Place an element on a specific track near `startMs`. In `normal` mode the
 * position clamps to free space; `overwrite` and `insert` keep the requested
 * position and let the engine carve or ripple (see addElement's editMode).
 */
export function insertElementOnTrack(
  engine: EditorEngine,
  trackId: TrackId,
  element: TimelineElementInput,
  startMs: number,
  editMode: 'normal' | 'overwrite' | 'insert' = 'normal',
): string {
  const id = element.id ?? createElementId()
  const track = engine.project.tracks.find((t) => t.id === trackId)
  const placedStartMs =
    track && editMode === 'normal'
      ? findNearestFreeSlot(track, startMs, element.durationMs)
      : Math.max(0, Math.round(startMs))
  engine.dispatch(
    {
      type: 'addElement',
      trackId,
      element: { ...element, id, startMs: placedStartMs },
      editMode,
    },
    { selection: [id] },
  )
  return id
}

/** Create a new topmost track and place the element there. */
export function insertElementOnNewTrack(
  engine: EditorEngine,
  element: TimelineElementInput,
  startMs: number,
): string {
  const id = element.id ?? createElementId()
  const trackId = createTrackId()
  engine.transact(
    () => {
      engine.dispatch({ type: 'addTrack', id: trackId })
      engine.dispatch({
        type: 'addElement',
        trackId,
        element: { ...element, id, startMs: Math.max(0, Math.round(startMs)) },
      })
    },
    { selection: [id] },
  )
  return id
}

/** Duplicate an element right after itself on the same track. */
export function duplicateElement(engine: EditorEngine, elementId: string): string | null {
  const location = getElementLocation(engine.project, elementId as `e-${string}`)
  if (!location) return null
  const { track, element } = location
  const id = createElementId()
  const startMs = findNearestFreeSlot(track, element.startMs + element.durationMs, element.durationMs)
  engine.dispatch(
    {
      type: 'addElement',
      trackId: track.id,
      element: { ...element, id, startMs },
    },
    { selection: [id] },
  )
  return id
}

export interface TextPreset {
  name: string
  text: string
  durationMs: number
  style: Partial<TextStyle>
  /** Vertical offset in project px, center-origin. */
  y?: number
}

export const TEXT_PRESETS: TextPreset[] = [
  {
    name: 'Title',
    text: 'Title',
    durationMs: 3000,
    style: { fontSize: 140, fontWeight: 800 },
  },
  {
    name: 'Subtitle',
    text: 'Subtitle',
    durationMs: 3000,
    style: { fontSize: 72, fontWeight: 500, color: '#e4e4e7' },
  },
  {
    name: 'Lower third',
    text: 'Name Surname',
    durationMs: 4000,
    style: {
      fontSize: 56,
      fontWeight: 700,
      align: 'left',
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
    },
    y: 380,
  },
  {
    name: 'Pop label',
    text: 'WOW',
    durationMs: 1500,
    style: { fontSize: 120, fontWeight: 900, color: '#0a0a0a', backgroundColor: '#facc15' },
  },
]

export function elementForTextPreset(engine: EditorEngine, preset: TextPreset): TimelineElementInput {
  return {
    type: 'text',
    startMs: 0,
    durationMs: preset.durationMs,
    text: preset.text,
    style: preset.style,
    box: { width: Math.round(engine.project.width * 0.7), overflow: 'clip' },
    transform: { x: 0, y: preset.y ?? 0, scaleX: 1, scaleY: 1, rotation: 0 },
    opacity: 1,
  }
}

/** Every element id in the project. */
export function allElementIds(engine: EditorEngine): `e-${string}`[] {
  return engine.project.tracks.flatMap((track) => track.elements.map((e) => e.id))
}

/** Select every clip on one track. */
export function selectTrackElements(engine: EditorEngine, trackId: TrackId): void {
  const track = engine.project.tracks.find((t) => t.id === trackId)
  if (track) engine.select(track.elements.map((e) => e.id))
}

/** The track containing the current selection's first element, if any. */
export function trackOfSelection(engine: EditorEngine): Track | undefined {
  const id = engine.selection.elementIds[0]
  if (!id) return undefined
  return getElementLocation(engine.project, id)?.track
}

/** Duplicate every selected element, one undo entry, duplicates selected. */
export function duplicateSelection(engine: EditorEngine): void {
  const ids = [...engine.selection.elementIds]
  if (ids.length === 0) return
  const duplicated: `e-${string}`[] = []
  engine.transact(() => {
    for (const id of ids) {
      const location = getElementLocation(engine.project, id)
      if (!location) continue
      const newId = createElementId()
      const startMs = findNearestFreeSlot(
        location.track,
        location.element.startMs + location.element.durationMs,
        location.element.durationMs,
      )
      try {
        engine.dispatch(
          {
            type: 'addElement',
            trackId: location.track.id,
            element: { ...location.element, id: newId, startMs },
          },
          // Declared per dispatch (the full id list isn't known up front);
          // the gesture's single history entry restores the old selection.
          { selection: [...duplicated, newId] },
        )
        duplicated.push(newId)
      } catch {
        // No room on this track: skip.
      }
    }
  })
}

/**
 * Solo a track: mute every other track; toggling again unmutes everything.
 * No schema change is needed because solo is a derived mute state.
 */
export function toggleSoloTrack(engine: EditorEngine, trackId: TrackId): void {
  const tracks = engine.project.tracks
  const target = tracks.find((t) => t.id === trackId)
  if (!target || tracks.length < 2) return
  const others = tracks.filter((t) => t.id !== trackId)
  const isSoloed = !target.muted && others.every((t) => t.muted)
  engine.transact(() => {
    if (isSoloed) {
      for (const track of tracks) {
        engine.dispatch({ type: 'setTrackFlags', trackId: track.id, muted: false })
      }
    } else {
      engine.dispatch({ type: 'setTrackFlags', trackId, muted: false })
      for (const track of others) {
        engine.dispatch({ type: 'setTrackFlags', trackId: track.id, muted: true })
      }
    }
  })
}

/** Is this track the current solo, unmuted while every other track is muted? */
export function isSoloTrack(engine: EditorEngine, trackId: TrackId): boolean {
  const tracks = engine.project.tracks
  if (tracks.length < 2) return false
  const target = tracks.find((t) => t.id === trackId)
  if (!target || target.muted) return false
  return tracks.every((t) => t.id === trackId || t.muted)
}

/** Every clip boundary plus 0, sorted. */
export function clipEdges(engine: EditorEngine): number[] {
  const edges = new Set<number>([0])
  for (const track of engine.project.tracks) {
    for (const element of track.elements) {
      edges.add(element.startMs)
      edges.add(element.startMs + element.durationMs)
    }
  }
  return [...edges].sort((a, b) => a - b)
}

/** J/K/L shuttle behavior. */
export function shuttle(engine: EditorEngine, direction: -1 | 0 | 1): void {
  if (direction === 0) {
    engine.pause()
    engine.setPlaybackRate(1)
    return
  }
  const current = engine.playback.state
  const sameDirection = current.isPlaying && Math.sign(current.playbackRate) === direction
  const magnitude = sameDirection ? Math.min(Math.abs(current.playbackRate) * 2, 8) : 1
  engine.setPlaybackRate(direction * magnitude)
  engine.play()
}

/** Trim the selected clips' start/end to the playhead. */
export function trimSelectionToPlayhead(engine: EditorEngine, edge: 'start' | 'end'): void {
  const now = quantizeMsToFrame(engine.playback.state.currentTimeMs, engine.project.fps)
  const ids = engine.selection.elementIds
  if (ids.length === 0) return
  engine.transact(() => {
    for (const id of ids) {
      const location = getElementLocation(engine.project, id)
      if (!location) continue
      const { element } = location
      const endMs = element.startMs + element.durationMs
      if (now <= element.startMs || now >= endMs) continue
      try {
        if (edge === 'end') {
          engine.dispatch({ type: 'trimElement', elementId: id, durationMs: now - element.startMs })
        } else {
          const shiftMs = now - element.startMs
          engine.dispatch({
            type: 'trimElement',
            elementId: id,
            startMs: now,
            durationMs: element.durationMs - shiftMs,
            ...('trimStartMs' in element ? { trimStartMs: element.trimStartMs + shiftMs } : {}),
          })
        }
      } catch {
        // Min-duration or asset bounds: skip this clip.
      }
    }
  })
}

/** Split every clip under the playhead on every unlocked track. */
export function splitAllAtPlayhead(engine: EditorEngine): void {
  const atMs = quantizeMsToFrame(engine.playback.state.currentTimeMs, engine.project.fps)
  engine.transact(() => {
    for (const track of engine.project.tracks) {
      if (track.locked) continue
      const hit = track.elements.find((e) => atMs > e.startMs && atMs < e.startMs + e.durationMs)
      if (!hit) continue
      try {
        engine.dispatch({ type: 'splitElement', elementId: hit.id, atMs })
      } catch {
        // Too close to an edge.
      }
    }
  })
}

/** Unique, sorted element-local keyframe times across every animatable property. */
export function keyframeTimes(element: TimelineElement): number[] {
  const times = new Set<number>()
  for (const property of animatableProperties(element)) {
    for (const keyframe of getKeyframes(element, property)) times.add(keyframe.timeMs)
  }
  return [...times].sort((a, b) => a - b)
}

/**
 * Toggle a keyframe at the playhead across the selected element's visual
 * properties. On a keyframe it removes armed keyframes; otherwise it adds
 * keyframes at current resolved values.
 */
export function toggleMasterKeyframe(engine: EditorEngine): void {
  const id = engine.selection.elementIds[0]
  if (!id) return
  const element = getElement(engine.project, id)
  if (!element) return
  const masterProperties = animatableProperties(element).filter((p) => p !== 'volume' && p !== 'blur')
  if (masterProperties.length === 0) return

  const now = Math.round(engine.playback.state.currentTimeMs)
  const localMs = Math.max(0, Math.min(element.durationMs, now - element.startMs))
  const armed = masterProperties.filter((p) => hasKeyframes(element, p))
  const onKeyframe = armed.length > 0 && armed.some((p) => isOnKeyframe(element, p, now))

  engine.transact(() => {
    if (onKeyframe) {
      for (const property of armed) {
        if (!isOnKeyframe(element, property, now)) continue
        try {
          engine.dispatch({ type: 'removeKeyframe', elementId: id, property, timeMs: localMs })
        } catch {
          // Keyframe at a slightly different ms: skip.
        }
      }
    } else {
      const targets = armed.length > 0 ? armed : masterProperties
      for (const property of targets) {
        engine.dispatch({
          type: 'setKeyframe',
          elementId: id,
          property,
          timeMs: localMs,
          value: getAnimatedValue(element, property, now),
        })
      }
    }
  })
}

export function moveKeyframesAtTime(
  engine: EditorEngine,
  elementId: `e-${string}`,
  fromTimeMs: number,
  toTimeMs: number,
  properties?: AnimatableProperty[],
): void {
  const element = getElement(engine.project, elementId)
  if (!element) return
  const targetProperties = properties ?? animatableProperties(element)
  engine.transact(() => {
    for (const property of targetProperties) {
      if (!getKeyframes(element, property).some((k) => k.timeMs === fromTimeMs)) continue
      try {
        engine.dispatch({ type: 'moveKeyframe', elementId, property, fromTimeMs, toTimeMs })
      } catch {
        // Collision on this property: leave it.
      }
    }
  })
}

export function removeKeyframesAtTime(
  engine: EditorEngine,
  elementId: `e-${string}`,
  timeMs: number,
  properties?: AnimatableProperty[],
): void {
  const element = getElement(engine.project, elementId)
  if (!element) return
  const targetProperties = properties ?? animatableProperties(element)
  engine.transact(() => {
    for (const property of targetProperties) {
      if (!getKeyframes(element, property).some((k) => k.timeMs === timeMs)) continue
      try {
        engine.dispatch({ type: 'removeKeyframe', elementId, property, timeMs })
      } catch {
        // Already gone.
      }
    }
  })
}
