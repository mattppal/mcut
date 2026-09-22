'use client'

import { useQuery } from '@tanstack/react-query'
import { useEditor, useEngineSubscription, useWindowEvent } from '@mcut/react'
import { getElementLocation, getProjectDurationMs, type EditorEngine, type ElementId, type Project } from '@mcut/timeline'
import { preloadMediabunny } from '@mcut/media'
import { z } from 'zod'
import { bridgeRequestSchema } from './bridge-request'
import { elementForAsset, insertElementAtPlayhead } from './editor-actions'
import { parentMessageSchema, postToParent, type EmbedOptions, type ParentMessage } from './embed'
import { useEditorUI } from './editor-ui'
import { handleLiveMcpRequest } from './live-mcp-bridge'
import { importMediaFiles } from './media-import'

declare global {
  interface Window {
    mcutEmbedClip?: Promise<Response>
  }
}

function clipFileName(clip: string): string {
  const last = new URL(clip, window.location.href).pathname.split('/').pop() ?? ''
  return last.length > 0 ? decodeURIComponent(last) : 'clip'
}

async function fetchClipFile(clip: string): Promise<File> {
  const response = await (window.mcutEmbedClip ?? fetch(clip))
  window.mcutEmbedClip = undefined
  if (!response.ok) throw new Error(`Could not load the clip (${response.status})`)
  const blob = await response.blob()
  return new File([blob], clipFileName(clip), { type: blob.type })
}

async function bootstrapEmbed(engine: EditorEngine, options: EmbedOptions): Promise<{ elementId: ElementId; project: Project }> {
  const [file] = await Promise.all([fetchClipFile(options.clip), preloadMediabunny()])
  const [asset] = await importMediaFiles(engine, [file])
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
  return { elementId, project: engine.project }
}

function requestId(raw: unknown): string {
  const parsed = z.object({ id: z.string() }).safeParse(raw)
  return parsed.success ? parsed.data.id : ''
}

function applyParentMessage(
  engine: EditorEngine,
  ui: ReturnType<typeof useEditorUI>,
  message: ParentMessage,
  onCollapsed: (collapsed: boolean) => void,
  project: Project | undefined,
): void {
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
    case 'mcut:embed:reset':
      if (!project) return
      engine.pause()
      engine.loadProject(project)
      engine.seek(0)
      engine.play()
      return
    case 'mcut:embed:request': {
      const parsed = bridgeRequestSchema.safeParse(message.request)
      if (!parsed.success) {
        postToParent({
          type: 'mcut:embed:result',
          id: requestId(message.request),
          ok: false,
          message: z.prettifyError(parsed.error),
        })
        return
      }
      const request = parsed.data
      void (async () => {
        try {
          const result = await handleLiveMcpRequest(engine, ui, request)
          postToParent({ type: 'mcut:embed:result', id: request.id, ok: true, result })
        } catch (error) {
          postToParent({
            type: 'mcut:embed:result',
            id: request.id,
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          })
        }
      })()
      return
    }
    default: {
      const unhandled: never = message
      throw new Error(`Unhandled parent message ${JSON.stringify(unhandled)}`)
    }
  }
}

export function EmbedBootstrap({ options, loop, onCollapsed }: { options: EmbedOptions; loop: boolean; onCollapsed: (collapsed: boolean) => void }) {
  const engine = useEditor()
  const ui = useEditorUI()
  const bootstrap = useQuery({
    queryKey: ['mcut', 'embed', options.clip],
    queryFn: () => bootstrapEmbed(engine, options),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })
  const project = bootstrap.data?.project

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
    if (parsed.success) applyParentMessage(engine, ui, parsed.data, onCollapsed, project)
  })

  if (!bootstrap.isError) return null
  return (
    <div role="alert" className="fixed right-4 bottom-4 z-50 rounded-lg border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg">
      {bootstrap.error.message}
    </div>
  )
}
