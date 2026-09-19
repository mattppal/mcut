'use client'

import * as React from 'react'
import { spinners } from 'unicode-animations'
import { cn } from '@/lib/utils'

export type SpinnerAnimation = keyof typeof spinners

interface FrameClock {
  subscribe: (listener: () => void) => () => void
  getFrame: () => number
}

const frameClocks = new Map<number, FrameClock>()

function frameClock(intervalMs: number): FrameClock {
  const existing = frameClocks.get(intervalMs)
  if (existing) return existing
  let frame = 0
  let timer: number | null = null
  const listeners = new Set<() => void>()
  const clock: FrameClock = {
    subscribe: (listener) => {
      listeners.add(listener)
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (timer === null && !reduceMotion) {
        timer = window.setInterval(() => {
          frame += 1
          for (const notify of listeners) notify()
        }, intervalMs)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && timer !== null) {
          window.clearInterval(timer)
          timer = null
        }
      }
    },
    getFrame: () => frame,
  }
  frameClocks.set(intervalMs, clock)
  return clock
}

function serverFrame(): number {
  return 0
}

export function Spinner({ animation = 'braille', label = 'Loading', className }: { animation?: SpinnerAnimation; label?: string; className?: string }) {
  const { frames, interval } = spinners[animation]
  const clock = frameClock(interval)
  const frame = React.useSyncExternalStore(clock.subscribe, clock.getFrame, serverFrame)

  return (
    <span role="status" aria-label={label} data-slot="spinner" className={cn('inline-block font-mono leading-none select-none', className)}>
      {frames[frame % frames.length]}
    </span>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  bordered = false,
  className,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title?: React.ReactNode
  description?: React.ReactNode
  bordered?: boolean
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn('flex flex-col items-center justify-center gap-2 p-6 text-center', bordered && 'rounded-lg border border-dashed', className)}
    >
      {Icon ? <Icon className="size-5 text-muted-foreground" /> : null}
      {title ? <p className="text-xs font-medium">{title}</p> : null}
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {children}
    </div>
  )
}

export function PanelCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('h-full min-h-0 overflow-hidden rounded-xl bg-card shadow-xs', className)}>{children}</div>
}

export function PanelHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div data-slot="panel-header" className={cn('flex h-8 shrink-0 items-center gap-1 px-2', className)}>
      {children}
    </div>
  )
}

export const panelSectionLabelClass = 'text-2xs font-semibold tracking-wide text-muted-foreground uppercase'

export function PanelSectionLabel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <h4 data-slot="panel-section-label" className={cn(panelSectionLabelClass, className)}>
      {children}
    </h4>
  )
}
