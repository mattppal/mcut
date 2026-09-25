'use client'

import { useState, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SettingsIcon } from '@/lib/icons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { host, type TranscriptionSettings } from './studio-host'

const TRANSCRIPTION_KEY_QUERY = ['mcut', 'transcription-key'] as const

let settingsOpen = false
const openListeners = new Set<() => void>()

function setSettingsOpen(open: boolean): void {
  settingsOpen = open
  for (const listener of openListeners) listener()
}

export function openSettings(): void {
  setSettingsOpen(true)
}

function subscribeOpen(listener: () => void): () => void {
  openListeners.add(listener)
  return () => {
    openListeners.delete(listener)
  }
}

export function useTranscriptionConfigured(settings: TranscriptionSettings): boolean {
  const configured = useQuery({ queryKey: TRANSCRIPTION_KEY_QUERY, queryFn: () => settings.isConfigured(), staleTime: Infinity })
  return configured.data === true
}

function TranscriptionKeyField({ settings }: { settings: TranscriptionSettings }) {
  const [key, setKey] = useState('')
  const queryClient = useQueryClient()
  const isConfigured = useTranscriptionConfigured(settings)
  const save = useMutation({
    mutationFn: (value: string) => settings.setKey(value),
    onSuccess: (configured) => {
      queryClient.setQueryData(TRANSCRIPTION_KEY_QUERY, configured)
      setKey('')
      toast.success(configured ? 'AssemblyAI key saved' : 'AssemblyAI key removed')
    },
  })
  return (
    <div data-slot="transcription-key-field" className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>AssemblyAI API key</span>
        {isConfigured && <span className="text-2xs font-medium text-foreground">Configured</span>}
      </div>
      <div className="flex gap-1.5">
        <Input
          aria-label="AssemblyAI API key"
          type="password"
          autoComplete="off"
          className="h-7 text-xs"
          placeholder={isConfigured ? 'Paste a new key to replace it' : 'Paste your AssemblyAI API key'}
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
        <Button variant="outline" size="xs" disabled={key.trim().length === 0 || save.isPending} onClick={() => save.mutate(key)}>
          Save
        </Button>
        {isConfigured && (
          <Button variant="ghost" size="xs" disabled={save.isPending} onClick={() => save.mutate('')}>
            Remove
          </Button>
        )}
      </div>
      <p className="text-2xs text-muted-foreground">
        Encrypted with the system keychain and stored in a local database by the desktop app. On Linux without a keyring it is only obfuscated, not encrypted.
      </p>
    </div>
  )
}

export function SettingsDialog() {
  const open = useSyncExternalStore(
    subscribeOpen,
    () => settingsOpen,
    () => false,
  )
  const settings = host.transcriptionSettings
  if (settings === null) return null
  return (
    <>
      <Button variant="ghost" size="icon-sm" title="Settings" aria-label="Settings" data-mcut-settings-trigger="" onClick={openSettings}>
        <SettingsIcon />
      </Button>
      <Dialog open={open} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>Auto-caption sends audio to AssemblyAI with this key when on-device transcription is off.</DialogDescription>
          </DialogHeader>
          <TranscriptionKeyField settings={settings} />
        </DialogContent>
      </Dialog>
    </>
  )
}
