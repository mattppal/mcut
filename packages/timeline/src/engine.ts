import { batch, createStore, type Store } from '@tanstack/store'
import type { ElementId } from './id'
import { applyCommand, type BuiltinCommand } from './commands'
import { createProject, parseProject, type Project } from './model'

export interface SelectionState {
  elementIds: ElementId[]
}

interface HistoryEntry {
  project: Project
  selection: SelectionState
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
  maxHistorySize?: number
}

export interface DispatchOptions {
  history?: boolean
  selection?: ElementId[]
}

export interface TransactionOptions {
  selection?: ElementId[]
}

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

  dispatch(command: BuiltinCommand, options: DispatchOptions = {}): Project {
    const previous = this.project
    const previousSelection = this.selection
    const next = applyCommand(previous, command)
    if (next === previous) {
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

  transact(fn: () => void, options: TransactionOptions = {}): void {
    const entry = { project: this.project, selection: this.selection }
    this.beginTransaction()
    try {
      batch(() => {
        try {
          fn()
        } catch (error) {
          this.commitProject(entry.project, entry.selection)
          throw error
        }
      })
      if (options.selection !== undefined) {
        this.transactionDeclaredSelection = true
        this.commitProject(this.project, { elementIds: options.selection })
      }
    } finally {
      this.endTransaction()
    }
  }

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

  toJSON(): Project {
    return this.project
  }

  static fromJSON(data: unknown, options: Omit<EditorEngineOptions, 'project'> = {}): EditorEngine {
    return new EditorEngine({ ...options, project: parseProject(data) })
  }

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

  private pushHistory(entry: HistoryEntry): void {
    this.past.push(entry)
    if (this.past.length > this.maxHistorySize) {
      this.past.splice(0, this.past.length - this.maxHistorySize)
    }
    this.future = []
  }

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
