'use client'

import { useState, useSyncExternalStore, type CSSProperties } from 'react'
import { AgentTrace } from '@/components/agent-trace'
import { HeroCallout } from '@/components/hero-callout'
import { AGENT_SCRIPT } from '@/lib/agent-script'
import type { DEMO_CLIP } from '@/lib/demo-clip'
import { createHeroEmbed, isReady, traceMode } from '@/lib/hero-embed'
import { FRAME_PAD, heroGeometry } from '@/lib/hero-geometry'
import { cn } from '@/lib/utils'

const GUTTER_WIDTH = '15rem'
const MOTION = 'duration-[600ms] ease-out-expo motion-reduce:transition-none'

function cssVariables(variables: Record<`--${string}`, string>): CSSProperties {
  return variables
}

export function HeroDemo({ clip }: { clip: typeof DEMO_CLIP }) {
  const [
    {
      subscribe,
      getSnapshot,
      getServerSnapshot,
      attachContainer,
      attachFrame,
      attachFrameCard,
      attachStage,
      attachPoster,
      expand,
      collapse,
      load,
      run,
      replay,
    },
  ] = useState(createHeroEmbed)
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const geometry = state.animatingFrom ?? heroGeometry(state)
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
        <div className="order-2 xl:order-1">
          <AgentTrace
            steps={AGENT_SCRIPT}
            phase={state.replay}
            mode={traceMode(state.phase)}
            results={state.results}
            onReplay={replay}
            onLoad={state.phase === 'poster' ? load : null}
            onRun={awaitingRun ? run : null}
          />
        </div>
        <div className="order-1 flex min-w-0 flex-col xl:order-2">
          <div
            ref={attachContainer}
            className={cn('relative z-20', geometry === null && 'aspect-video w-full')}
            style={geometry === null ? undefined : { height: geometry.wrapperHeight }}
          >
            <div
              key={geometry === null ? 'placeholder' : 'frame'}
              ref={attachFrameCard}
              className={cn(
                'absolute top-0 left-0 rounded-xl shadow-[0_24px_64px_-24px] shadow-overlay/45 will-change-transform',
                geometry === null && 'size-full',
              )}
              style={
                geometry === null
                  ? undefined
                  : { width: geometry.frameWidth, height: geometry.frameHeight, transform: `translateX(${geometry.frameTranslateX}px)` }
              }
            >
              <div
                ref={attachStage}
                className={cn('absolute origin-top-left overflow-hidden rounded-xl bg-neutral-950 will-change-transform', geometry === null && 'inset-0')}
                style={
                  geometry === null
                    ? undefined
                    : { top: FRAME_PAD, left: FRAME_PAD, width: geometry.stageWidth, height: geometry.stageHeight, transform: `scale(${geometry.scale})` }
                }
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
                  <button type="button" aria-label="Take over the editor" className="absolute inset-0 z-10 cursor-pointer" onClick={expand} />
                )}
              </div>
            </div>
            {state.phase === 'poster' && (
              <img
                ref={attachPoster}
                src={clip.poster}
                alt=""
                width={clip.width}
                height={clip.height}
                fetchPriority="high"
                decoding="async"
                className={cn('pointer-events-none absolute rounded-xl object-cover sm:hidden', geometry === null && 'inset-0 size-full')}
                style={
                  geometry === null
                    ? undefined
                    : {
                        top: FRAME_PAD,
                        left: FRAME_PAD + geometry.frameTranslateX,
                        width: geometry.stageWidth * geometry.scale,
                        height: geometry.stageHeight * geometry.scale,
                      }
                }
              />
            )}
          </div>
        </div>
        <HeroCallout hidden={state.expanded} className="order-3" />
      </div>
    </>
  )
}
