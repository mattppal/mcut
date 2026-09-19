'use client'

import { useEditor } from '@mcut/react'
import { TRANSITION_TYPES, transitionTypeSchema, type TimelineElement, type Track } from '@mcut/timeline'
import { Trash2Icon } from '@/lib/icons'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NumberField, Section } from './inspector-fields'

export function TransitionSection({ element, track }: { element: TimelineElement; track: Track }) {
  const engine = useEditor()
  const transition = 'transition' in element ? element.transition : undefined
  const cutMs = element.startMs + element.durationMs
  const nextClip = track.elements.find((e) => e.startMs === cutMs && e.id !== element.id)
  const dispatch = (value: { type: string; durationMs: number } | null) => {
    try {
      engine.dispatch({
        type: 'setTransition',
        elementId: element.id,
        transition: value && {
          type: transitionTypeSchema.parse(value.type),
          durationMs: value.durationMs,
        },
      })
    } catch {}
  }
  return (
    <Section title="Transition" defaultOpen={transition !== undefined}>
      {transition ? (
        <>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">Type</span>
            <Select value={transition.type} onValueChange={(type) => type && dispatch({ type, durationMs: transition.durationMs })}>
              <SelectTrigger size="sm" className="w-full flex-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSITION_TYPES.map((type) => (
                  <SelectItem key={type} value={type} className="text-xs capitalize">
                    {type.replace('-', ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon-xs" title="Remove transition" onClick={() => dispatch(null)}>
              <Trash2Icon />
            </Button>
          </div>
          <NumberField
            label="Length"
            value={transition.durationMs / 1000}
            step={0.1}
            min={0.1}
            max={5}
            unit="s"
            onCommit={(s) => dispatch({ type: transition.type, durationMs: Math.round(s * 1000) })}
          />
          {!nextClip && <p className="text-2xs text-muted-foreground">Inactive — the next clip is no longer flush against this one.</p>}
        </>
      ) : nextClip ? (
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs text-muted-foreground">Into next</span>
          <Select value={null} onValueChange={(type) => type && dispatch({ type, durationMs: 500 })}>
            <SelectTrigger size="sm" className="w-full flex-1 text-xs">
              <SelectValue placeholder="Add a transition…" />
            </SelectTrigger>
            <SelectContent>
              {TRANSITION_TYPES.map((type) => (
                <SelectItem key={type} value={type} className="text-xs capitalize">
                  {type.replace('-', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-2xs text-muted-foreground">Place another clip immediately after this one to add a transition.</p>
      )}
    </Section>
  )
}
