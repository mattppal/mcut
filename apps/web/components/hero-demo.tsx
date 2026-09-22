'use client'

import { useState, useSyncExternalStore, type CSSProperties } from 'react'
import { AgentTrace } from '@/components/agent-trace'
import { HeroCallout } from '@/components/hero-callout'
import { AGENT_SCRIPT } from '@/lib/agent-script'
import type { DEMO_CLIP } from '@/lib/demo-clip'
import { createHeroEmbed, isReady, traceMode } from '@/lib/hero-embed'
import { heroGeometry, stageScale, type FrameRect, type HeroGeometry } from '@/lib/hero-geometry'
import { landerCopy } from '@/lib/lander-copy'
import { STUDIO_RELEASED, publicRelease } from '@/lib/release-gate'
import { cn } from '@/lib/utils'

const GUTTER_WIDTH = '15rem'
const MOTION = 'duration-[600ms] ease-out-expo motion-reduce:transition-none'

function cssVariables(variables: Record<`--${string}`, string>): CSSProperties {
  return variables
}

function frameStyle(rect: FrameRect | null): CSSProperties | undefined {
  return rect === null ? undefined : { position: 'fixed', top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

function stageStyle(geometry: HeroGeometry | null, rect: FrameRect | null, containerWidth: number | null): CSSProperties | undefined {
  if (geometry === null || containerWidth === null) return undefined
  const scale = rect === null ? containerWidth / geometry.stageWidth : stageScale(geometry, rect)
  return { width: geometry.stageWidth, height: geometry.stageHeight, transform: `scale(${scale})` }
}

export function HeroDemo({ clip }: { clip: typeof DEMO_CLIP }) {
  const [{ subscribe, getSnapshot, getServerSnapshot, attachContainer, attachFrame, attachFrameCard, attachStage, expand, collapse, load, run, replay }] =
    useState(createHeroEmbed)
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const geometry = heroGeometry(state.metrics)
  const lifted = state.animatingFrom ?? (state.expanded && geometry !== null ? geometry.expandedRect : null)
  const src = `/embed?clip=${encodeURIComponent(clip.url)}${state.autoplay ? '&autoplay=1' : ''}&muted=1`
  const awaitingRun = isReady(state.phase) && state.reducedMotion && state.replay.kind === 'waiting'

  return (
    <>
      <div
        aria-hidden
        onClick={collapse}
        className={cn('fixed inset-0 z-10 bg-overlay/50 transition-opacity', MOTION, state.expanded ? 'opacity-100' : 'pointer-events-none opacity-0')}
      />
      <div className="grid gap-6 xl:grid-cols-[var(--gutter)_minmax(0,1fr)_var(--gutter)]" style={cssVariables({ '--gutter': GUTTER_WIDTH })}>
        <div className="order-2 hidden sm:block xl:order-1">
          <AgentTrace
            steps={AGENT_SCRIPT}
            phase={state.replay}
            mode={traceMode(state.phase)}
            results={state.results}
            onReplay={replay}
            onLoad={state.phase === 'poster' ? load : null}
            onRun={awaitingRun ? run : null}
            intro={landerCopy(publicRelease()).traceIntro}
          />
        </div>
        <div className="order-1 flex min-w-0 flex-col xl:order-2">
          <div ref={attachContainer} className="relative z-20 aspect-[1100/859] w-[calc(100%+1.5rem)] sm:aspect-video sm:w-full">
            <div
              ref={attachFrameCard}
              className="absolute inset-0 overflow-hidden rounded-l-xl shadow-[0_24px_64px_-24px] shadow-overlay/45 sm:overflow-visible sm:rounded-xl"
              style={frameStyle(lifted)}
            >
              <div
                ref={attachStage}
                className={cn(
                  'absolute top-0 left-0 origin-top-left overflow-hidden rounded-xl bg-neutral-950 will-change-transform',
                  geometry === null && 'size-full',
                )}
                style={stageStyle(geometry, lifted, state.metrics?.containerWidth ?? null)}
              >
                {state.phase !== 'poster' && (
                  <iframe
                    ref={attachFrame}
                    src={src}
                    title="mcut Studio"
                    allow="autoplay; fullscreen"
                    allowFullScreen
                    className={cn(
                      'absolute top-0 left-0 border-0 transition-[opacity,filter] duration-700 ease-out motion-reduce:transition-none',
                      isReady(state.phase) ? 'opacity-100 blur-0' : 'opacity-0 blur-md',
                      geometry === null && 'size-full',
                    )}
                    style={geometry === null ? undefined : { width: geometry.stageWidth, height: geometry.stageHeight }}
                  />
                )}
                {!state.expanded && (
                  <button type="button" aria-label="Take over the editor" className="absolute inset-0 z-10 hidden cursor-pointer sm:block" onClick={expand} />
                )}
              </div>
              <img
                src={clip.phonePoster.url}
                alt="mcut Studio with the demo clip loaded"
                width={clip.phonePoster.width}
                height={clip.phonePoster.height}
                fetchPriority="high"
                decoding="async"
                className="pointer-events-none absolute inset-0 size-full object-cover object-left-top sm:hidden"
              />
              <a
                href={STUDIO_RELEASED ? '/downloads' : '#waitlist'}
                aria-label={landerCopy(publicRelease()).phoneHeroLabel}
                className="absolute inset-0 z-10 sm:hidden"
              />
            </div>
          </div>
        </div>
        <HeroCallout hidden={state.expanded} className="order-3" />
      </div>
    </>
  )
}
