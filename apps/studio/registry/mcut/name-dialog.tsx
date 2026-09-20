'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export function NameDialog({
  draft,
  title,
  onSubmit,
  onCancel,
}: {
  draft: string | null
  title: string
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <NameForm title={title} defaultValue={draft ?? ''} onSubmit={onSubmit} onCancel={onCancel} />
      </DialogContent>
    </Dialog>
  )
}

function NameForm({
  title,
  defaultValue,
  onSubmit,
  onCancel,
}: {
  title: string
  defaultValue: string
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(defaultValue)
  const trimmed = name.trim()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (trimmed) onSubmit(trimmed)
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <Input aria-label="Name" value={name} onChange={(event) => setName(event.target.value)} onFocus={(event) => event.currentTarget.select()} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!trimmed}>
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}
