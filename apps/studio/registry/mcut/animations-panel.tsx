'use client'

import { toast } from 'sonner'
import { SparklesIcon } from '@/lib/icons'
import { planZoomAtPlayhead, withPlayheadDefaults } from '@mcut/editor'
import { useEditor, useSelectedElement } from '@mcut/react'
import { ANIMATION_PRESET_CATEGORIES, animatableProperties, isZoomable, ZOOM_REGION_PRESETS, type AnimationPreset, type ZoomableElement } from '@mcut/timeline'
import { EmptyState, PanelSectionLabel } from './editor-primitives'
import { removeSavedZoom, useSavedZooms, type SavedZoom } from './saved-zooms'
import { cn } from '@/lib/utils'

const PRESET_BUTTON_CLASS =
  'flex aspect-[2/1] flex-col items-center justify-center gap-1 rounded-lg border bg-overlay/40 transition-colors hover:border-primary/60 hover:bg-primary/10'

const ZOOM_BUTTONS = [
  { preset: 'subtlePunchIn', label: 'Subtle punch-in' },
  { preset: 'detailZoom', label: 'Detail zoom' },
] as const

const CATEGORY_LABELS: Record<keyof typeof ANIMATION_PRESET_CATEGORIES, string> = {
  in: 'In',
  out: 'Out',
  combo: 'Emphasis',
}

const PRESET_GLYPHS: Record<AnimationPreset, string> = {
  'fade-in': '◐',
  'slide-in': '↑',
  'pop-in': '✦',
  'scale-in': '◎',
  'zoom-in': '⊕',
  'whip-in': '≫',
  'blur-in': '░',
  'fade-out': '◑',
  'slide-out': '↓',
  'pop-out': '✧',
  'zoom-out': '⊖',
  'whip-out': '≪',
  'blur-out': '▒',
  'ken-burns': '⛶',
  'punch-zoom': '◉',
  pulse: '♥',
  breathe: '◯',
  float: '~',
  sway: '∿',
  shake: '≈',
}

const PRESET_HINTS: Record<AnimationPreset, string> = {
  'fade-in': 'Opacity rise on a decelerating curve',
  'slide-in': 'Gentle directional rise with a long expo settle',
  'pop-in': 'Scale up with a soft ~10% overshoot',
  'scale-in': 'Settle down from oversized — cinematic title entrance',
  'zoom-in': 'Subtle push toward camera under a fade',
  'whip-in': 'Fast directional throw (enables motion blur)',
  'blur-in': 'Blur-to-sharp reveal',
  'fade-out': 'Accelerating fade',
  'slide-out': 'Directional exit on an emphasized-accelerate curve',
  'pop-out': 'Small grow (anticipation), then shrink away',
  'zoom-out': 'Recede from camera under a fade',
  'whip-out': 'Fast directional throw out (enables motion blur)',
  'blur-out': 'Sharp-to-blur dissolve',
  'ken-burns': 'Slow filmic zoom and drift across the clip',
  'punch-zoom': 'Snap to a tighter framing and hold (enables motion blur)',
  pulse: 'Rhythmic ±5% scale beat',
  breathe: 'Barely-there ±2% scale breathing',
  float: 'Slow vertical bob',
  sway: 'Slow ±1.5° rotation drift',
  shake: 'Damped impact wobble',
}

function prettyName(preset: AnimationPreset): string {
  return preset.replace(/-/g, ' ')
}

function ZoomSection({ element }: { element: ZoomableElement }) {
  const engine = useEditor()

  const saved = useSavedZooms()

  const add = (preset: keyof typeof ZOOM_REGION_PRESETS | SavedZoom['zoom'], label: string) => {
    try {
      engine.dispatch(planZoomAtPlayhead(element, preset, engine.playback.state.currentTimeMs))
      toast.success(`${label} added at the playhead`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add the zoom')
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <PanelSectionLabel className="px-1">Zoom</PanelSectionLabel>
      <div className="grid grid-cols-2 gap-1.5">
        {ZOOM_BUTTONS.map(({ preset, label }) => (
          <button
            key={preset}
            type="button"
            data-zoom-preset={preset}
            className={PRESET_BUTTON_CLASS}
            onClick={() => add(preset, label)}
            title={`Zoom to ${ZOOM_REGION_PRESETS[preset].scale}x at the playhead, hold, then ease back out`}
          >
            <span className="font-mono text-sm leading-none text-primary">{ZOOM_REGION_PRESETS[preset].scale}x</span>
            <span className="text-2xs">{label}</span>
          </button>
        ))}
        {saved.zooms.map(({ id, name, zoom }) => (
          <button
            key={id}
            type="button"
            data-saved-zoom={id}
            className={cn(PRESET_BUTTON_CLASS, 'group/zoom relative')}
            onClick={() => add(zoom, name)}
            title={`Your saved zoom, ${zoom.scale}x at the playhead, converted to a zoom region`}
          >
            <span className="font-mono text-sm leading-none text-primary">{Number(zoom.scale.toFixed(2))}x</span>
            <span className="text-2xs">{name}</span>
            <span
              role="button"
              tabIndex={-1}
              className="absolute top-0.5 right-1 hidden text-2xs text-muted-foreground group-hover/zoom:block hover:text-destructive"
              title="Delete saved zoom"
              onClick={(event) => {
                event.stopPropagation()
                removeSavedZoom(id)
              }}
            >
              ✕
            </span>
          </button>
        ))}
      </div>
      {saved.unconverted > 0 && (
        <p className="px-1 text-2xs text-muted-foreground">
          {saved.unconverted} saved zoom{saved.unconverted === 1 ? '' : 's'} only moved the frame without scaling, so{' '}
          {saved.unconverted === 1 ? 'it has' : 'they have'} no zoom region form.
        </p>
      )}
      <p className="px-1 text-2xs leading-relaxed text-muted-foreground">
        Zooms sit on top of the clip in the timeline. Drag one to move it, drag where a ramp meets the hold to retime that ramp, or drag an outer edge to change
        the hold. Press Delete to remove the selected zoom.
      </p>
    </div>
  )
}

export function AnimationsPanel({ className }: { className?: string }) {
  const engine = useEditor()
  const selected = useSelectedElement()
  const element = selected?.element
  const animatable = element ? animatableProperties(element).length > 0 : false

  const apply = (preset: AnimationPreset) => {
    if (!element) return
    try {
      engine.dispatch(withPlayheadDefaults(engine, { type: 'applyAnimationPreset', elementId: element.id, preset }))
      toast.success(`${prettyName(preset)} applied. Keyframes are editable in the inspector`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not apply the preset')
    }
  }

  if (!element || !animatable) {
    return (
      <EmptyState
        className={className}
        icon={SparklesIcon}
        description={element ? 'This element has no animatable properties.' : 'Select a clip to apply an animation. Presets expand into editable keyframes.'}
      />
    )
  }

  return (
    <div className={cn('flex flex-col gap-3 p-2', className)}>
      {isZoomable(element) && <ZoomSection element={element} />}
      {(Object.keys(ANIMATION_PRESET_CATEGORIES) as Array<keyof typeof ANIMATION_PRESET_CATEGORIES>).map((category) => (
        <div key={category} className="flex flex-col gap-1.5">
          <PanelSectionLabel className="px-1">{CATEGORY_LABELS[category]}</PanelSectionLabel>
          <div className="grid grid-cols-2 gap-1.5">
            {ANIMATION_PRESET_CATEGORIES[category].map((preset) => (
              <button
                key={preset}
                type="button"
                data-preset={preset}
                className={PRESET_BUTTON_CLASS}
                onClick={() => apply(preset)}
                title={`${PRESET_HINTS[preset]} — expands to editable keyframes`}
              >
                <span className="text-lg leading-none text-primary">{PRESET_GLYPHS[preset]}</span>
                <span className="text-2xs capitalize">{prettyName(preset)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="px-1 text-2xs leading-relaxed text-muted-foreground">Presets write real keyframes — fine-tune them with the ◆ controls in the inspector.</p>
    </div>
  )
}
