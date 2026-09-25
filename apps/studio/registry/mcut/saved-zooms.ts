'use client'

import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import type { ZoomShape } from '@mcut/editor'
import { easingSchema } from '@mcut/timeline'

const STORE_KEY = 'mcut:templates:v1'

const keySchema = z.object({ t: z.number().min(0).max(1), value: z.number(), easing: easingSchema.optional() })

const savedZoomSchema = z.object({
  id: z.string(),
  kind: z.literal('zoom'),
  name: z.string(),
  payload: z.object({
    durationMs: z.number().positive(),
    tracks: z.object({ 'scale.x': z.array(keySchema).min(2).optional(), 'scale.y': z.array(keySchema).min(2).optional() }),
  }),
})

export interface SavedZoom {
  id: string
  name: string
  zoom: ZoomShape
}

interface SavedZooms {
  zooms: SavedZoom[]
  unconverted: number
}

const EMPTY: SavedZooms = { zooms: [], unconverted: 0 }

export function toSavedZoom(entry: z.infer<typeof savedZoomSchema>): SavedZoom | null {
  const track = entry.payload.tracks['scale.x'] ?? entry.payload.tracks['scale.y']
  if (!track) return null
  const peak = Math.max(...track.map((key) => key.value))
  if (peak <= 1.001) return null
  const ms = (t: number) => Math.round(t * entry.payload.durationMs)
  const atPeak = track.flatMap((key, index) => (key.value === peak ? [index] : []))
  const rise = track[atPeak[0] ?? 0]
  const fall = track[atPeak.at(-1) ?? 0]
  if (!rise || !fall) return null
  const returns = (track.at(-1)?.value ?? peak) < peak
  const inMs = Math.max(1, ms(rise.t))
  const holdMs = returns ? ms(fall.t - rise.t) : ms(1 - rise.t)
  const outMs = returns ? Math.max(1, ms(1 - fall.t)) : inMs
  return { id: entry.id, name: entry.name, zoom: { scale: Math.min(8, peak), inMs, holdMs, outMs, easing: track[0]?.easing ?? 'easeOutExpo' } }
}

const listeners = new Set<() => void>()
let snapshot: { raw: string | null; value: SavedZooms } | null = null

function readRaw(): string | null {
  return typeof window === 'undefined' ? null : window.localStorage.getItem(STORE_KEY)
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function parseEntries(raw: string | null): unknown[] {
  const parsed = z.array(z.unknown()).safeParse(raw === null ? [] : parseJson(raw))
  return parsed.success ? parsed.data : []
}

function read(): SavedZooms {
  const raw = readRaw()
  if (snapshot?.raw === raw) return snapshot.value
  const entries = parseEntries(raw).flatMap((entry) => {
    const parsed = savedZoomSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
  const zooms = entries.flatMap((entry) => toSavedZoom(entry) ?? [])
  snapshot = { raw, value: { zooms, unconverted: entries.length - zooms.length } }
  return snapshot.value
}

export function removeSavedZoom(id: string): void {
  const kept = parseEntries(readRaw()).filter((entry) => savedZoomSchema.safeParse(entry).data?.id !== id)
  window.localStorage.setItem(STORE_KEY, JSON.stringify(kept))
  for (const listener of listeners) listener()
}

export function useSavedZooms(): SavedZooms {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    read,
    () => EMPTY,
  )
}
