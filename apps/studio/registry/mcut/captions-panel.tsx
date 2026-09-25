'use client'

import { useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CaptionsIcon, DownloadIcon, SparklesIcon, Trash2Icon } from '@/lib/icons'
import { toast } from 'sonner'
import { extractAudioToWav } from '@mcut/media'
import { useEditor, useProject, usePlayback } from '@mcut/react'
import {
  CAPTION_STYLE_PRESETS,
  isElementActiveAt,
  type CaptionElement,
  type CaptionStylePreset,
  type ElementAudioSource,
  type ElementId,
  type Project,
  resolveElementAudioSource,
} from '@mcut/timeline'
import { buildApplyCaptionsCommand, toSrt, toVtt, type SubtitleCue, type TranscriptResult } from '@mcut/transcription'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, PanelHeader, PanelSectionLabel, Spinner } from './editor-primitives'
import { formatTimecode } from './format'
import { defaultModelDownloadLabel, isLocalTranscriptionSupported, setOnDeviceTranscriptionEnabled, useOnDeviceTranscription } from './local-transcription'
import { openSettings, useTranscriptionConfigured } from './settings-dialog'
import { host, type TranscriptionSettings } from './studio-host'

export interface CaptionsPanelProps {
  className?: string
  transcribe?: (audio: Blob) => Promise<TranscriptResult>
}

function captionsOf(project: Project): CaptionElement[] {
  return project.tracks
    .flatMap((track) => track.elements)
    .filter((e): e is CaptionElement => e.type === 'caption')
    .sort((a, b) => a.startMs - b.startMs)
}

function pickTranscriptionSource(project: Project, selectedElementIds: readonly string[]): ElementAudioSource | null {
  for (const elementId of selectedElementIds) {
    const source = resolveElementAudioSource(project, elementId as ElementId)
    if (source) return source
  }

  return (
    project.tracks
      .flatMap((track) => track.elements)
      .sort((a, b) => a.startMs - b.startMs)
      .map((element) => resolveElementAudioSource(project, element.id))
      .find((source): source is ElementAudioSource => source !== null) ?? null
  )
}

function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function retypedTextWithoutWordTimings(text: string): Pick<CaptionElement, 'text' | 'words'> {
  return { text, words: [] }
}

function CaptionRow({ caption }: { caption: CaptionElement }) {
  const engine = useEditor()
  const active = usePlayback((s) => isElementActiveAt(caption, s.currentTimeMs))
  const isPlaying = usePlayback((s) => s.isPlaying)

  const followPlayhead = useCallback(
    (node: HTMLDivElement | null) => {
      if (node && active && isPlaying) {
        node.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    },
    [active, isPlaying],
  )

  return (
    <div ref={followPlayhead} className={cn('group flex flex-col gap-1 rounded-lg p-2 transition-colors hover:bg-muted/60', active && 'bg-primary/10')}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="cursor-pointer font-mono text-2xs text-muted-foreground hover:text-foreground"
          title="Seek to caption"
          onClick={() => engine.seek(caption.startMs)}
        >
          {formatTimecode(caption.startMs)} – {formatTimecode(caption.startMs + caption.durationMs)}
        </button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-xs"
          title="Delete caption"
          className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
          onClick={() => engine.dispatch({ type: 'removeElement', elementId: caption.id })}
        >
          <Trash2Icon />
        </Button>
      </div>
      <Textarea
        value={caption.text}
        rows={1}
        className="min-h-7 resize-none border-transparent bg-transparent p-1 text-xs shadow-none focus-visible:border-transparent focus-visible:bg-input/50 focus-visible:ring-0"
        onChange={(event) => {
          try {
            engine.dispatch({
              type: 'updateElement',
              elementId: caption.id,
              patch: retypedTextWithoutWordTimings(event.target.value),
            })
          } catch {}
        }}
      />
    </div>
  )
}

function OnDeviceToggle() {
  const enabled = useOnDeviceTranscription()
  if (!isLocalTranscriptionSupported()) return null
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span title={`Runs Whisper in your browser — audio never leaves this device. One-time ${defaultModelDownloadLabel()} model download, cached afterwards.`}>
        Transcribe on this device
      </span>
      <Switch checked={enabled} onCheckedChange={setOnDeviceTranscriptionEnabled} />
    </label>
  )
}

function TranscriptionKeyStatus({ settings }: { settings: TranscriptionSettings }) {
  const onDevice = useOnDeviceTranscription()
  const configured = useTranscriptionConfigured(settings)
  if (configured || onDevice) return null
  return (
    <div data-slot="transcription-key-status" className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>No AssemblyAI API key set.</span>
      <Button variant="outline" size="xs" onClick={openSettings}>
        Open Settings
      </Button>
    </div>
  )
}

function CaptionStylePresets({ captions }: { captions: CaptionElement[] }) {
  const engine = useEditor()
  const apply = (preset: CaptionStylePreset) => {
    engine.transact(() => {
      for (const caption of captions) {
        const style = { ...caption.style, ...preset.style }
        if (!('activeWordColor' in preset.style)) delete style.activeWordColor
        try {
          engine.dispatch({
            type: 'updateElement',
            elementId: caption.id,
            patch: { style },
          })
        } catch {}
      }
    })
  }
  return (
    <div className="flex flex-col gap-1">
      <PanelSectionLabel>Style</PanelSectionLabel>
      <div className="grid grid-cols-3 gap-1.5">
        {CAPTION_STYLE_PRESETS.map((preset) => (
          <Button
            key={preset.id}
            variant="outline"
            size="xs"
            title={preset.style.activeWordColor ? `${preset.label} (highlights the spoken word)` : preset.label}
            onClick={() => apply(preset)}
          >
            {preset.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

export function CaptionsPanel({ className, transcribe }: CaptionsPanelProps) {
  const engine = useEditor()
  const project = useProject()
  const captions = captionsOf(project)

  const transcription = useMutation({
    mutationFn: async () => {
      if (!transcribe) {
        throw new Error('No transcribe handler configured.')
      }
      const source = pickTranscriptionSource(engine.project, engine.selection.elementIds)
      if (!source) {
        throw new Error('Add a video or audio clip to the timeline first.')
      }
      const wav = await extractAudioToWav(source.asset.src)
      if (!wav) {
        throw new Error(`"${source.asset.name ?? source.asset.id}" has no audio track.`)
      }
      const result = await transcribe(wav)
      return { result, source }
    },
    onSuccess: ({ result, source }) => {
      engine.dispatch(
        buildApplyCaptionsCommand(result, {
          timeOffsetMs: source.timelineStartMs,
          sourceStartMs: source.sourceStartMs,
          sourceEndMs: source.sourceEndMs,
        }),
      )
      toast.success('Captions added to the timeline')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Transcription failed')
    },
  })

  const cues = (): SubtitleCue[] =>
    captionsOf(engine.project).map((c) => ({
      startMs: c.startMs,
      endMs: c.startMs + c.durationMs,
      text: c.text,
    }))

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <PanelHeader>
        <PanelSectionLabel>Captions</PanelSectionLabel>
      </PanelHeader>
      <div className="flex shrink-0 flex-col gap-3 px-3 pb-3">
        <Button className="w-full" disabled={transcription.isPending || !transcribe} onClick={() => transcription.mutate()}>
          {transcription.isPending ? <Spinner /> : <SparklesIcon />}
          {transcription.isPending ? 'Transcribing…' : 'Auto-caption'}
        </Button>
        {!transcribe && (
          <p className="text-xs text-muted-foreground">
            Pass a <code className="font-mono">transcribe</code> handler to enable auto-captions.
          </p>
        )}
        <OnDeviceToggle />
        {host.transcriptionSettings && <TranscriptionKeyStatus settings={host.transcriptionSettings} />}

        {captions.length > 0 && (
          <>
            <CaptionStylePresets captions={captions} />
            <div className="flex gap-2">
              <Button variant="outline" size="xs" className="flex-1" onClick={() => downloadText(`${project.name}.srt`, toSrt(cues()), 'application/x-subrip')}>
                <DownloadIcon /> SRT
              </Button>
              <Button variant="outline" size="xs" className="flex-1" onClick={() => downloadText(`${project.name}.vtt`, toVtt(cues()), 'text/vtt')}>
                <DownloadIcon /> VTT
              </Button>
            </div>
            <PanelSectionLabel>Transcript · {captions.length}</PanelSectionLabel>
          </>
        )}
      </div>

      {captions.length === 0 ? (
        <EmptyState className="mx-3 mb-3 flex-1" icon={CaptionsIcon} description="No captions yet. Import media, then auto-caption it." />
      ) : (
        <ScrollArea className="min-h-0 flex-1 scroll-mask-b">
          <div className="flex flex-col gap-1 px-3 pb-3">
            {captions.map((caption) => (
              <CaptionRow key={caption.id} caption={caption} />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
