'use client'

import { CaptionsIcon, ClapperboardIcon, FilmIcon, ImageIcon, LayersIcon, MusicIcon, TypeIcon } from '@/lib/icons'

export interface ElementUI {
  clipClassName: string
  icon: typeof FilmIcon
}

const FALLBACK: ElementUI = {
  clipClassName: 'bg-(--clip-fallback,oklch(35%_0.02_270/90%)) text-overlay-foreground',
  icon: LayersIcon,
}

const registry = new Map<string, ElementUI>()

export function registerElementUI(type: string, ui: ElementUI): void {
  registry.set(type, ui)
}

export function getElementUI(type: string): ElementUI {
  return registry.get(type) ?? FALLBACK
}

registerElementUI('video', {
  clipClassName: 'bg-(--clip-video) text-(--clip-video-foreground)',
  icon: FilmIcon,
})
registerElementUI('audio', {
  clipClassName: 'bg-(--clip-audio) text-(--clip-audio-foreground)',
  icon: MusicIcon,
})
registerElementUI('image', {
  clipClassName: 'bg-(--clip-image) text-(--clip-image-foreground)',
  icon: ImageIcon,
})
registerElementUI('text', {
  clipClassName: 'bg-(--clip-text) text-(--clip-text-foreground)',
  icon: TypeIcon,
})
registerElementUI('caption', {
  clipClassName: 'bg-(--clip-caption) text-(--clip-caption-foreground)',
  icon: CaptionsIcon,
})
registerElementUI('multicam', {
  clipClassName: 'bg-(--clip-multicam) text-(--clip-multicam-foreground)',
  icon: ClapperboardIcon,
})
