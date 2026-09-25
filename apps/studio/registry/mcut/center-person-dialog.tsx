'use client'

import { useState, type FormEvent } from 'react'
import { useEditor } from '@mcut/react'
import type { MulticamElement, VideoElement } from '@mcut/timeline'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { runEditorAction } from './action-registry'
import { editorClipboard } from './editor-clipboard'
import { useEditorUI } from './editor-ui'

export interface CenterPersonDraft {
  aspect: number
  smoothing: number
}

export const CENTER_PERSON_DEFAULTS: CenterPersonDraft = { aspect: 9 / 16, smoothing: 0.5 }

interface Choice {
  label: string
  value: number
}

const ASPECTS: Choice[] = [
  { label: '9:16', value: 9 / 16 },
  { label: '4:5', value: 4 / 5 },
  { label: '1:1', value: 1 },
]

const SMOOTHING: Choice[] = [
  { label: 'Responsive', value: 0.2 },
  { label: 'Balanced', value: 0.5 },
  { label: 'Steady', value: 0.8 },
]

export function CenterPersonDialog({
  element,
  draft,
  onClose,
}: {
  element: VideoElement | MulticamElement
  draft: CenterPersonDraft | null
  onClose: () => void
}) {
  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <CenterPersonForm element={element} initial={draft ?? CENTER_PERSON_DEFAULTS} onClose={onClose} />
      </DialogContent>
    </Dialog>
  )
}

function CenterPersonForm({ element, initial, onClose }: { element: VideoElement | MulticamElement; initial: CenterPersonDraft; onClose: () => void }) {
  const engine = useEditor()
  const ui = useEditorUI()
  const [aspect, setAspect] = useState(initial.aspect)
  const [smoothing, setSmoothing] = useState(initial.smoothing)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onClose()
    const input = element.type === 'video' ? { elementId: element.id, aspect, smoothing } : { elementId: element.id, smoothing }
    runEditorAction('frame.center-person', { engine, ui, clipboard: editorClipboard, input })
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Center person</DialogTitle>
        <DialogDescription>
          {element.type === 'video'
            ? 'Crops the clip to the aspect and follows the face. At the project aspect it also fills the frame.'
            : 'Follows the face inside the camera slot.'}{' '}
          Detection runs on this device.
        </DialogDescription>
      </DialogHeader>
      {element.type === 'video' && <ChoiceRow label="Aspect" choices={ASPECTS} value={aspect} onChange={setAspect} />}
      <ChoiceRow label="Smoothing" choices={SMOOTHING} value={smoothing} onChange={setSmoothing} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Center person</Button>
      </DialogFooter>
    </form>
  )
}

function ChoiceRow({ label, choices, value, onChange }: { label: string; choices: Choice[]; value: number; onChange: (value: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 text-xs text-muted-foreground">{label}</span>
      <div role="group" aria-label={label} className="flex flex-1 gap-1">
        {choices.map((choice) => (
          <Button
            key={choice.label}
            type="button"
            size="xs"
            variant={choice.value === value ? 'secondary' : 'ghost'}
            aria-pressed={choice.value === value}
            className={cn('flex-1 transition-none', choice.value === value && 'font-semibold')}
            onClick={() => onChange(choice.value)}
          >
            {choice.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
