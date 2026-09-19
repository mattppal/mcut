'use client'

import { useSyncExternalStore } from 'react'

let open = false
const listeners = new Set<() => void>()

export function setCommandPaletteOpen(value: boolean): void {
  if (open === value) return
  open = value
  for (const listener of listeners) listener()
}

export function openCommandPalette(): void {
  setCommandPaletteOpen(true)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getOpen(): boolean {
  return open
}

function getServerOpen(): boolean {
  return false
}

export function useCommandPaletteOpen(): boolean {
  return useSyncExternalStore(subscribe, getOpen, getServerOpen)
}
