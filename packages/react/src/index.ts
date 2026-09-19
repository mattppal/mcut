'use client'

export {
  EditorProvider,
  useEditorContext,
  type EditorContextValue,
  type EditorProviderProps,
} from './context'

export {
  useEditor,
  useEditorState,
  usePlayback,
  useProject,
  useSelectedElement,
  useSelection,
} from './hooks'

export { PlayerCanvas, type PlayerCanvasProps, type PreviewQuality } from './player-canvas'

export { useWindowEvent } from './sync/use-window-event'
export { useDocumentEvent } from './sync/use-document-event'
export { useElementEvent } from './sync/use-element-event'
export { useEngineSubscription, type EngineStore } from './sync/use-engine-subscription'
export { useEngineSync } from './sync/use-engine-sync'
export { useWebSocket, type WebSocketHandlers } from './sync/use-web-socket'
export { useDocumentRootClass } from './sync/use-document-root-class'
export { useDocumentRootAttribute } from './sync/use-document-root-attribute'
export { useDisposable, type Disposable } from './sync/use-disposable'
export { useLatest } from './sync/use-latest'

export {
  applyMove,
  applyBoxResize,
  applyResize,
  applyRotate,
  type BoxResizeResult,
  type GesturePoint,
} from './gestures'
