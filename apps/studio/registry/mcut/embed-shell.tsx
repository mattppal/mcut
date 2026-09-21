'use client'

import { useState, type ReactNode } from 'react'
import type { EmbedOptions } from './embed'
import { EmbedBootstrap } from './embed-bootstrap'

type EmbedView = 'collapsed' | 'expanded'

export function EmbedShell({ options, children }: { options: EmbedOptions; children: ReactNode }) {
  const [view, setView] = useState<EmbedView>('collapsed')
  return (
    <>
      <EmbedBootstrap options={options} loop={view === 'collapsed'} onCollapsed={(collapsed) => setView(collapsed ? 'collapsed' : 'expanded')} />
      {children}
    </>
  )
}
