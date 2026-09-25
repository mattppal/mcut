'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { isWebGPUSupported } from '@mcut/compositor'
import { PlayerCanvas, useEditor, useEditorState } from '@mcut/react'
import { getElement } from '@mcut/timeline'
import { PanelCard } from './editor-primitives'
import { useEditorUI } from './editor-ui'
import { LayoutBank } from './layout-bank'
import { LayoutSlotEditor } from './layout-slot-editor'
import { TextEditOverlay } from './text-edit-overlay'
import { TransportBar } from './transport-bar'

function usePreviewRenderer(): 'canvas2d' | 'webgpu' {
  const [renderer] = useState<'canvas2d' | 'webgpu'>(() => {
    if (typeof window === 'undefined') return 'canvas2d'
    const requested = new URLSearchParams(window.location.search).get('renderer')
    if (requested !== 'webgpu') return 'canvas2d'
    if (!isWebGPUSupported()) {
      setTimeout(() => {
        toast.error('This browser has no WebGPU (needs Chrome 113+, Safari 26+, or Firefox 141+) — using the canvas2d renderer.')
      }, 0)
      return 'canvas2d'
    }
    return 'webgpu'
  })
  return renderer
}

export function PreviewArea() {
  const engine = useEditor()
  const width = useEditorState((s) => s.project.width)
  const height = useEditorState((s) => s.project.height)
  const { mode, previewQuality, editingTextId, setEditingTextId } = useEditorUI()
  const renderer = usePreviewRenderer()
  return (
    <PanelCard className="flex flex-col">
      <div className="flex min-h-0 flex-1">
        {mode === 'multicam' && <LayoutBank />}
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden p-4 [container-type:size]">
          <div
            className="relative w-full"
            style={{
              maxWidth: `min(100%, calc(100cqh * ${width / height} - ${(24 * width) / height}px))`,
              ['--mcut-aspect' as string]: `${width} / ${height}`,
            }}
          >
            <PlayerCanvas
              quality={previewQuality}
              renderer={renderer}
              className="overflow-hidden rounded-lg ring-1 ring-foreground/10"
              {...(editingTextId ? { hiddenElementIds: new Set([editingTextId]) } : {})}
              onElementDoubleClick={(elementId) => {
                const element = getElement(engine.project, elementId)
                if (element?.type === 'text') setEditingTextId(elementId)
              }}
            />
            {mode === 'multicam' && <LayoutSlotEditor />}
            <TextEditOverlay />
          </div>
        </div>
      </div>
      <TransportBar />
    </PanelCard>
  )
}
