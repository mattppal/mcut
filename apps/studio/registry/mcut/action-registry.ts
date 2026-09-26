import type { ComponentType } from 'react'
import { toast } from 'sonner'
import { enabledStatus, operators, runOperator, type OperatorId } from '@mcut/editor'
import type { EditorEngine } from '@mcut/timeline'
import type { EditorUIValue } from './editor-ui'
import type { EditorClipboard } from './editor-clipboard'

export interface ActionContext {
  engine: EditorEngine
  ui: EditorUIValue
  clipboard: EditorClipboard
  input?: unknown
  throwOnError?: boolean
}

export interface Shortcut {
  key: string
  meta?: boolean
  shift?: boolean
  alt?: boolean
}

export type ActionCategory =
  | 'file'
  | 'playback'
  | 'selection'
  | 'clipboard'
  | 'edit'
  | 'track'
  | 'keyframes'
  | 'markers'
  | 'transcript'
  | 'multicam'
  | 'view'
  | 'help'

export const CATEGORY_ORDER: ActionCategory[] = [
  'file',
  'playback',
  'selection',
  'clipboard',
  'edit',
  'track',
  'keyframes',
  'markers',
  'transcript',
  'multicam',
  'view',
  'help',
]

export const CATEGORY_LABELS: Record<ActionCategory, string> = {
  file: 'File',
  playback: 'Playback',
  selection: 'Selection',
  clipboard: 'Clipboard',
  edit: 'Edit',
  track: 'Tracks',
  keyframes: 'Keyframes',
  markers: 'Markers',
  transcript: 'Transcript',
  multicam: 'Multicam',
  view: 'View',
  help: 'Help',
}

export interface EditorAction {
  id: string
  label: string
  description?: string
  category: ActionCategory
  shortcut?: Shortcut | Shortcut[]
  icon?: ComponentType<{ className?: string }>
  palette?: boolean
  humanOnly?: string
  inputSchema?: Record<string, unknown>
  operator?: {
    id: OperatorId
    input?: Record<string, unknown> | ((context: ActionContext) => Record<string, unknown>)
  }
  enabled?: (context: ActionContext) => boolean
  run?: (context: ActionContext) => unknown
}

const registry = new Map<string, EditorAction>()

function operatorInput(action: EditorAction, context: ActionContext): unknown {
  const input = action.operator?.input
  return typeof input === 'function' ? input(context) : (input ?? {})
}

export function defineAction(action: EditorAction): EditorAction {
  if (registry.has(action.id)) {
    if (process.env.NODE_ENV !== 'production') {
      registry.set(action.id, action)
      return action
    }
    throw new Error(`editor action "${action.id}" is already defined`)
  }
  if (!action.operator && !action.run) {
    throw new Error(`editor action "${action.id}" needs an operator or a run()`)
  }
  registry.set(action.id, action)
  return action
}

export function listEditorActions(): EditorAction[] {
  return [...registry.values()]
}

export function getEditorAction(id: string): EditorAction | undefined {
  return registry.get(id)
}

export function isActionEnabled(action: EditorAction, context: ActionContext): boolean {
  try {
    if (action.enabled) return action.enabled(context)
    if (action.operator) {
      return enabledStatus(operators[action.operator.id], { engine: context.engine }, operatorInput(action, context)).enabled
    }
    return true
  } catch {
    return false
  }
}

export function runEditorAction(idOrAction: string | EditorAction, context: ActionContext): unknown {
  const action = typeof idOrAction === 'string' ? registry.get(idOrAction) : idOrAction
  if (!action || !isActionEnabled(action, context)) return
  try {
    if (action.run) return action.run(context)
    else if (action.operator) {
      void runOperator(action.operator.id, { engine: context.engine }, operatorInput(action, context))
    }
  } catch (error) {
    if (context.throwOnError) throw error
    toast.error(error instanceof Error ? error.message : 'Action failed')
  }
}

export function shortcutsOf(action: EditorAction): Shortcut[] {
  if (!action.shortcut) return []
  return Array.isArray(action.shortcut) ? action.shortcut : [action.shortcut]
}

export function matchShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'> & {
    code?: string
  },
  shortcut: Shortcut,
): boolean {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  const wantedKey = shortcut.key.length === 1 ? shortcut.key.toLowerCase() : shortcut.key
  const codeMatches = shortcut.alt && /^[a-z]$/.test(wantedKey) && event.code === `Key${wantedKey.toUpperCase()}`
  if (key !== wantedKey && !codeMatches) return false
  const meta = event.metaKey || event.ctrlKey
  if (meta !== Boolean(shortcut.meta)) return false
  if (event.shiftKey !== Boolean(shortcut.shift)) return false
  if (event.altKey !== Boolean(shortcut.alt)) return false
  return true
}

export function actionForEvent(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): EditorAction | undefined {
  for (const action of registry.values()) {
    if (shortcutsOf(action).some((shortcut) => matchShortcut(event, shortcut))) {
      return action
    }
  }
  return undefined
}

const KEY_GLYPHS: Record<string, string> = {
  ' ': 'Space',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Backspace: '⌫',
  Delete: '⌦',
  Escape: 'Esc',
  Home: 'Home',
  End: 'End',
}

export function formatShortcut(shortcut: Shortcut | Shortcut[] | undefined): string {
  if (!shortcut) return ''
  const first = Array.isArray(shortcut) ? shortcut[0] : shortcut
  if (!first) return ''
  const key = KEY_GLYPHS[first.key] ?? first.key.toUpperCase()
  return `${first.alt ? '⌥' : ''}${first.shift ? '⇧' : ''}${first.meta ? '⌘' : ''}${key}`
}
