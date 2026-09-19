'use client'

import { useState } from 'react'
import {
  AlignBottomIcon,
  AlignCenterHorizontalIcon,
  AlignCenterVerticalIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignTopIcon,
  LockIcon,
  LockOpenIcon,
} from '@/lib/hugeicons'
import { Button } from '@/components/ui/button'
import { FieldRow, NumberField } from './inspector-fields'
import { roundTo } from './math'

export interface FrameRect {
  x: number
  y: number
  width: number
  height: number
}

export type FrameField = 'x' | 'y' | 'width' | 'height' | 'rotation'

export interface FrameTarget {
  canvas: { width: number; height: number }
  safe: FrameRect
  rect: FrameRect
  setRect: (patch: Partial<FrameRect>) => void
  rotation?: { value: number; set: (deg: number) => void }
  minSize?: number
  forceAspectLocked?: boolean
  controls?: (field: FrameField) => React.ReactNode
}

const ALIGNMENTS = [
  { key: 'left', title: 'Align left', Icon: AlignLeftIcon },
  { key: 'center-h', title: 'Align horizontal center', Icon: AlignCenterHorizontalIcon },
  { key: 'right', title: 'Align right', Icon: AlignRightIcon },
  { key: 'top', title: 'Align top', Icon: AlignTopIcon },
  { key: 'center-v', title: 'Align vertical center', Icon: AlignCenterVerticalIcon },
  { key: 'bottom', title: 'Align bottom', Icon: AlignBottomIcon },
] as const

export type FrameAlignment = (typeof ALIGNMENTS)[number]['key']

export function alignFrame(target: FrameTarget, alignment: FrameAlignment): Partial<FrameRect> {
  const { rect, safe, canvas } = target
  switch (alignment) {
    case 'left':
      return { x: safe.x }
    case 'center-h':
      return { x: canvas.width / 2 - rect.width / 2 }
    case 'right':
      return { x: safe.x + safe.width - rect.width }
    case 'top':
      return { y: safe.y }
    case 'center-v':
      return { y: canvas.height / 2 - rect.height / 2 }
    case 'bottom':
      return { y: safe.y + safe.height - rect.height }
  }
}

export function FrameFields({ target }: { target: FrameTarget }) {
  const [aspectLocked, setAspectLocked] = useState(true)
  const { rect, minSize = 1 } = target
  const locked = target.forceAspectLocked || aspectLocked

  const commitWidth = (width: number) => {
    target.setRect(locked && rect.width > 0 ? { width, height: Math.max(minSize, (width * rect.height) / rect.width) } : { width })
  }
  const commitHeight = (height: number) => {
    target.setRect(locked && rect.height > 0 ? { height, width: Math.max(minSize, (height * rect.width) / rect.height) } : { height })
  }

  return (
    <>
      <FieldRow label="Align" title="Align to the safe area / canvas center">
        <div className="flex flex-1 gap-px">
          {ALIGNMENTS.map(({ key, title, Icon }) => (
            <Button key={key} variant="ghost" size="icon-xs" className="flex-1" title={title} onClick={() => target.setRect(alignFrame(target, key))}>
              <Icon />
            </Button>
          ))}
        </div>
      </FieldRow>
      <NumberField label="X" value={roundTo(rect.x, 1)} unit="px" scrubPerPx={1} onCommit={(x) => target.setRect({ x })} controls={target.controls?.('x')} />
      <NumberField label="Y" value={roundTo(rect.y, 1)} unit="px" scrubPerPx={1} onCommit={(y) => target.setRect({ y })} controls={target.controls?.('y')} />
      <NumberField
        label="Width"
        value={Math.round(rect.width)}
        min={minSize}
        unit="px"
        scrubPerPx={1}
        onCommit={commitWidth}
        controls={
          <>
            {target.forceAspectLocked ? (
              <Button variant="ghost" size="icon-xs" title="Aspect locked for grouped collage media" aria-pressed disabled>
                <LockIcon />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon-xs"
                title={aspectLocked ? 'Aspect locked — width and height resize together' : 'Aspect free — width and height resize independently'}
                aria-pressed={aspectLocked}
                onClick={() => setAspectLocked((value) => !value)}
              >
                {aspectLocked ? <LockIcon /> : <LockOpenIcon />}
              </Button>
            )}
            {target.controls?.('width')}
          </>
        }
      />
      <NumberField
        label="Height"
        value={Math.round(rect.height)}
        min={minSize}
        unit="px"
        scrubPerPx={1}
        onCommit={commitHeight}
        controls={target.controls?.('height')}
      />
      {target.rotation && (
        <NumberField
          label="Rotation"
          value={roundTo(target.rotation.value, 1)}
          min={-180}
          max={180}
          unit="°"
          scrubPerPx={0.5}
          onCommit={target.rotation.set}
          controls={target.controls?.('rotation')}
        />
      )}
    </>
  )
}
