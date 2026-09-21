'use client'

import { useQuery } from '@tanstack/react-query'
import { useEditor, useEngineSubscription, useWindowEvent } from '@mcut/react'
import { getElementLocation, getProjectDurationMs, type EditorEngine, type ElementId } from '@mcut/timeline'
import { elementForAsset, insertElementAtPlayhead } from './editor-actions'
import { parentMessageSchema, postToParent, type EmbedOptions, type ParentMessage } from './embed'
import { importMediaFiles } from './media-import'

function clipFileName(clip: string): string {
  const last = new URL(clip, window.location.href).pathname.split('/').pop() ?? ''
  return last.length > 0 ? decodeURIComponent(last) : 'clip'
}

async function fetchClipFile(clip: string): Promise<File> {
  const response = await fetch(clip)
  if (!response.ok) throw new Error(`Could not load the clip (${response.status})`)
  const blob = await response.blob()
  return new File([blob], clipFileName(clip), { type: blob.type })
}

async function bootstrapEmbed(engine: EditorEngine, options: EmbedOptions): Promise<ElementId> {
  const [asset] = await importMediaFiles(engine, [await fetchClipFile(options.clip)])
  if (!asset) throw new Error('Could not import the clip')
  if (asset.width !== undefined && asset.height !== undefined) {
    engine.dispatch({ type: 'updateProject', width: asset.width, height: asset.height }, { history: false })
  }
  engine.seek(0)
  const elementId = insertElementAtPlayhead(engine, elementForAsset(engine, asset))
  const location = getElementLocation(engine.project, elementId)
  if (options.muted && location) {
    engine.dispatch({ type: 'setTrackFlags', trackId: location.track.id, muted: true }, { history: false })
  }
  engine.loadProject(engine.project)
  engine.seek(0)
  if (options.autoplay) engine.play()
  postToParent({ type: 'mcut:embed:ready' })
  return elementId
}

function applyParentMessage(engine: EditorEngine, message: ParentMessage, onCollapsed: (collapsed: boolean) => void): void {
  switch (message.type) {
    case 'mcut:embed:play':
      engine.play()
      return
    case 'mcut:embed:pause':
      engine.pause()
      return
    case 'mcut:embed:collapsed':
      onCollapsed(message.collapsed)
      return
    default: {
      const unhandled: never = message
      throw new Error(`Unhandled parent message ${JSON.stringify(unhandled)}`)
    }
  }
}

export function EmbedBootstrap({ options, loop, onCollapsed }: { options: EmbedOptions; loop: boolean; onCollapsed: (collapsed: boolean) => void }) {
  const engine = useEditor()
  const bootstrap = useQuery({
    queryKey: ['mcut', 'embed', options.clip],
    queryFn: () => bootstrapEmbed(engine, options),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })

  useEngineSubscription(engine.playback, (state, previous) => {
    if (state.isPlaying === previous.isPlaying) return
    const atEnd = state.currentTimeMs >= getProjectDurationMs(engine.project)
    if (loop && previous.isPlaying && atEnd) {
      engine.seek(0)
      engine.play()
      return
    }
    postToParent({ type: 'mcut:embed:playing', playing: state.isPlaying })
  })

  useWindowEvent('message', (event) => {
    if (event.origin !== window.location.origin) return
    const parsed = parentMessageSchema.safeParse(event.data)
    if (parsed.success) applyParentMessage(engine, parsed.data, onCollapsed)
  })

  if (!bootstrap.isError) return null
  return (
    <div role="alert" className="fixed right-4 bottom-4 z-50 rounded-lg border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg">
      {bootstrap.error.message}
    </div>
  )
}
