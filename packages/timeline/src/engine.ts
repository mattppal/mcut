import { batch, createStore, type Store } from '@tanstack/store'
import type { ElementId } from './id'
import { applyCommand, type AnyCommand } from './commands'
import { createProject, parseProject, type Project } from './model'

export interface SelectionState {
  elementIds: ElementId[]
}

interface HistoryEntry {
  project: Project
  selection: SelectionState
  /**
   * True when the edit declared a selection override (see DispatchOptions):
   * undo restores `selection`, redo re-applies the override. Entries without
   * one leave the user's current selection alone (pruned against the restored
   * project), so UI-driven selection made after the edit survives undo.
   */
  restoresSelection: boolean
}

export interface EditorState {
  project: Project
  selection: SelectionState
  canUndo: boolean
  canRedo: boolean
}

export interface PlaybackState {
  currentTimeMs: number
  isPlaying: boolean
  playbackRate: number
  volume: number
  muted: boolean
}

export interface EditorEngineOptions {
  project?: Project
  /** History entries kept for undo. Default 100. */
  maxHistorySize?: number
}

export interface DispatchOptions {
  /** Record this edit in undo history (default true). */
  history?: boolean
  /**
   * Selection this edit conceptually produces (e.g. `[]` for a delete, the
   * new ids for a paste). Applied after the command, and it marks the history
   * entry: undoing restores the pre-edit selection, redoing re-applies this
   * one. Edits that don't declare it leave selection untouched across
   * undo/redo (beyond pruning removed ids).
   */
  selection?: ElementId[]
}

export interface TransactionOptions {
  /** Selection override for the whole gesture; see DispatchOptions.selection. */
  selection?: ElementId[]
}

/**
 * The headless editor: one validated, undoable command stream over a project,
 * plus a playback store for transport state.
 *
 * This facade is the only public surface over the underlying reactive stores,
 * which keeps the (alpha) `@tanstack/store` dependency contained to this
 * package. UIs read via `engine.store`/`engine.playback` subscriptions; all
 * writes go through {@link dispatch} (or the transport setters).
 */
export class EditorEngine {
  readonly store: Store<EditorState>
  readonly playback: Store<PlaybackState>

  private past: HistoryEntry[] = []
  private future: HistoryEntry[] = []
  private readonly maxHistorySize: number
  private transactionDepth = 0
  private transactionBase: HistoryEntry | null = null
  private transactionDeclaredSelection = false

  constructor(options: EditorEngineOptions = {}) {
    this.maxHistorySize = options.maxHistorySize ?? 100
    this.store = createStore<EditorState>({
      project: options.project ?? createProject(),
      selection: { elementIds: [] },
      canUndo: false,
      canRedo: false,
    })
    this.playback = createStore<PlaybackState>({
      currentTimeMs: 0,
      isPlaying: false,
      playbackRate: 1,
      volume: 1,
      muted: false,
    })
  }

  get project(): Project {
    return this.store.state.project
  }

  get selection(): SelectionState {
    return this.store.state.selection
  }

  /** Apply a command. Returns the resulting project. */
  dispatch(command: AnyCommand, options: DispatchOptions = {}): Project {
    const previous = this.project
    const previousSelection = this.selection
    const next = applyCommand(previous, command)
    if (next === previous) {
      // No project change: apply any declared selection without recording a
      // no-op history entry.
      if (options.selection !== undefined) {
        this.commitProject(next, { elementIds: options.selection })
      }
      return next
    }

    if (this.transactionDepth > 0 && options.selection !== undefined) {
      this.transactionDeclaredSelection = true
    }
    const recordHistory = options.history !== false && this.transactionDepth === 0
    if (recordHistory) {
      this.pushHistory({
        project: previous,
        selection: previousSelection,
        restoresSelection: options.selection !== undefined,
      })
    }
    this.commitProject(next, options.selection ? { elementIds: options.selection } : undefined)
    return next
  }

  /**
   * Group multiple dispatches into a single undo entry (and a single store
   * notification). Used for drag gestures and multi-step operations.
   */
  transact(fn: () => void, options: TransactionOptions = {}): void {
    this.beginTransaction()
    try {
      batch(fn)
      if (options.selection !== undefined) {
        this.transactionDeclaredSelection = true
        this.commitProject(this.project, { elementIds: options.selection })
      }
    } finally {
      this.endTransaction()
    }
  }

  /**
   * Open a transaction that spans multiple event-loop turns (e.g. a pointer
   * drag): dispatches in between record no history; `endTransaction` pushes
   * one entry for the whole gesture. Prefer {@link transact} for synchronous
   * batches.
   */
  beginTransaction(): void {
    if (this.transactionDepth === 0) {
      this.transactionBase = {
        project: this.project,
        selection: this.selection,
        restoresSelection: false,
      }
      this.transactionDeclaredSelection = false
    }
    this.transactionDepth++
  }

  endTransaction(): void {
    if (this.transactionDepth === 0) return
    this.transactionDepth--
    if (this.transactionDepth === 0) {
      const base = this.transactionBase
      this.transactionBase = null
      if (base && base.project !== this.project) {
        this.pushHistory({ ...base, restoresSelection: this.transactionDeclaredSelection })
        this.refreshHistoryFlags()
      }
      this.transactionDeclaredSelection = false
    }
  }

  /**
   * Abort the open transaction (the whole stack, if nested): restore the
   * project and selection from when it began, recording no history. Used by
   * escape-to-cancel on drag gestures. No-op without an open transaction.
   */
  cancelTransaction(): void {
    if (this.transactionDepth === 0) return
    const base = this.transactionBase
    this.transactionDepth = 0
    this.transactionBase = null
    this.transactionDeclaredSelection = false
    if (base && base.project !== this.project) {
      this.commitProject(base.project, base.selection)
    }
  }

  canUndo(): boolean {
    return this.past.length > 0
  }

  canRedo(): boolean {
    return this.future.length > 0
  }

  undo(): boolean {
    const previous = this.past.pop()
    if (!previous) return false
    this.future.push({
      project: this.project,
      selection: this.selection,
      restoresSelection: previous.restoresSelection,
    })
    this.commitProject(previous.project, previous.restoresSelection ? previous.selection : undefined)
    return true
  }

  redo(): boolean {
    const next = this.future.pop()
    if (!next) return false
    this.past.push({
      project: this.project,
      selection: this.selection,
      restoresSelection: next.restoresSelection,
    })
    this.commitProject(next.project, next.restoresSelection ? next.selection : undefined)
    return true
  }

  select(elementIds: ElementId[]): void {
    this.store.setState((s) => ({ ...s, selection: { elementIds } }))
  }

  clearSelection(): void {
    this.select([])
  }

  /** Replace the project (e.g. loading a saved file). Resets history. */
  loadProject(project: Project): void {
    const parsed = parseProject(project)
    this.past = []
    this.future = []
    this.transactionBase = null
    this.store.setState((s) => ({
      ...s,
      project: parsed,
      selection: { elementIds: [] },
      canUndo: false,
      canRedo: false,
    }))
  }

  /** The project as a JSON-serializable value. */
  toJSON(): Project {
    return this.project
  }

  static fromJSON(data: unknown, options: Omit<EditorEngineOptions, 'project'> = {}): EditorEngine {
    return new EditorEngine({ ...options, project: parseProject(data) })
  }

  // -- transport ------------------------------------------------------------

  seek(timeMs: number): void {
    const clamped = Math.max(0, timeMs)
    this.playback.setState((s) => ({ ...s, currentTimeMs: clamped }))
  }

  play(): void {
    this.playback.setState((s) => ({ ...s, isPlaying: true }))
  }

  pause(): void {
    this.playback.setState((s) => ({ ...s, isPlaying: false }))
  }

  setVolume(volume: number): void {
    this.playback.setState((s) => ({ ...s, volume: Math.max(0, Math.min(1, volume)) }))
  }

  setMuted(muted: boolean): void {
    this.playback.setState((s) => ({ ...s, muted }))
  }

  setPlaybackRate(playbackRate: number): void {
    this.playback.setState((s) => ({ ...s, playbackRate }))
  }

  // -- internals ------------------------------------------------------------

  private pushHistory(entry: HistoryEntry): void {
    this.past.push(entry)
    if (this.past.length > this.maxHistorySize) {
      this.past.splice(0, this.past.length - this.maxHistorySize)
    }
    this.future = []
  }

  /**
   * Commit a project, pruning selection against it. Undo/redo pass the
   * recorded selection only for entries whose edit declared one (delete,
   * paste, ...), so restoring a deleted clip restores its selection while
   * plain edits leave UI-driven selection alone.
   */
  private commitProject(project: Project, selection?: SelectionState): void {
    this.store.setState((s) => ({
      ...s,
      project,
      selection: pruneSelection(selection ?? s.selection, project),
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
    }))
  }

  private refreshHistoryFlags(): void {
    this.store.setState((s) => ({
      ...s,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
    }))
  }
}

function pruneSelection(selection: SelectionState, project: Project): SelectionState {
  if (selection.elementIds.length === 0) return selection
  const existing = new Set<string>()
  for (const track of project.tracks) {
    for (const element of track.elements) existing.add(element.id)
  }
  const elementIds = selection.elementIds.filter((id) => existing.has(id))
  return elementIds.length === selection.elementIds.length ? selection : { elementIds }
}
