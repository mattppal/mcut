'use client'

import { useState, useSyncExternalStore } from 'react'
import type { UpdateState } from '@mcut/desktop-ipc'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import type { DesktopUpdates } from './studio-host'

const IDLE: UpdateState = { phase: 'idle' }

function serverSnapshot(): UpdateState {
  return IDLE
}

function dismissKey(state: UpdateState): string | null {
  return state.phase === 'idle' ? null : `${state.phase}:${state.version}`
}

function UpdateContent({ state, updates, onLater }: { state: UpdateState; updates: DesktopUpdates; onLater: () => void }) {
  switch (state.phase) {
    case 'idle':
      return null
    case 'available':
      return (
        <>
          <DialogHeader>
            <DialogTitle>Update available: v{state.version}</DialogTitle>
            <DialogDescription>mcut Studio v{state.version} is ready to download.</DialogDescription>
          </DialogHeader>
          {state.notes === null ? null : (
            <div className="max-h-48 overflow-y-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap text-muted-foreground">{state.notes}</div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onLater}>
              Later
            </Button>
            <Button data-update-action="download" onClick={() => void updates.download()}>
              Download
            </Button>
          </DialogFooter>
        </>
      )
    case 'downloading':
      return (
        <>
          <DialogHeader>
            <DialogTitle>Downloading v{state.version}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Progress value={state.percent} />
            <p className="text-xs text-muted-foreground tabular-nums">{state.percent}%</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onLater}>
              Hide
            </Button>
          </DialogFooter>
        </>
      )
    case 'ready':
      return (
        <>
          <DialogHeader>
            <DialogTitle>v{state.version} is ready to install</DialogTitle>
            <DialogDescription>mcut Studio restarts to finish the update.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onLater}>
              Later
            </Button>
            <Button data-update-action="install" onClick={() => void updates.install()}>
              Restart to update
            </Button>
          </DialogFooter>
        </>
      )
    case 'failed':
      return (
        <>
          <DialogHeader>
            <DialogTitle>Update failed</DialogTitle>
            <DialogDescription>{state.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onLater}>
              Later
            </Button>
            <Button data-update-action="retry" onClick={() => void updates.download()}>
              Retry
            </Button>
          </DialogFooter>
        </>
      )
    default: {
      const exhaustive: never = state
      return exhaustive
    }
  }
}

export function UpdateDialog({ updates }: { updates: DesktopUpdates }) {
  const state = useSyncExternalStore(updates.subscribe, updates.get, serverSnapshot)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const dismiss = () => setDismissed(dismissKey(state))
  const open = state.phase !== 'idle' && dismissed !== dismissKey(state)
  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false} data-update-phase={state.phase}>
        <UpdateContent state={state} updates={updates} onLater={dismiss} />
      </DialogContent>
    </Dialog>
  )
}
