'use client'

import { MoonIcon, Redo2Icon, SunIcon, Undo2Icon } from '@/lib/icons'
import { useEditor, useEditorState } from '@mcut/react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useEditorUI, type EditorMode } from './editor-ui'
import { ExportDialog } from './export-dialog'
import { MainMenu } from './main-menu'
import { ShortcutsDialog } from './shortcuts-dialog'

function ProjectName() {
  const engine = useEditor()
  const name = useEditorState((s) => s.project.name)
  return (
    <input
      value={name}
      aria-label="Project name"
      className="w-48 rounded-md border border-transparent bg-transparent px-2 py-0.5 text-center text-xs font-medium outline-none hover:border-border focus:border-foreground/20"
      onChange={(e) => engine.dispatch({ type: 'updateProject', name: e.target.value || 'Untitled' }, { history: false })}
    />
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useEditorUI()
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />}
      >
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </TooltipTrigger>
      <TooltipContent>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</TooltipContent>
    </Tooltip>
  )
}

const MODES: Array<{ id: EditorMode; label: string }> = [
  { id: 'edit', label: 'Edit' },
  { id: 'multicam', label: 'Multicam' },
  { id: 'collage', label: 'Collage' },
]

function ModeSwitch() {
  const { mode, setMode } = useEditorUI()
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-foreground/5 p-0.5">
      {MODES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={cn(
            'rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
            mode === id ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setMode(id)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function EditorToolbar({ embedded = false }: { embedded?: boolean }) {
  const engine = useEditor()
  const canUndo = useEditorState((s) => s.canUndo)
  const canRedo = useEditorState((s) => s.canRedo)

  return (
    <div className={cn('flex h-11 shrink-0 items-center gap-3 px-3', embedded && 'pr-12')}>
      {embedded ? null : <MainMenu />}
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" disabled={!canUndo} onClick={() => engine.undo()} aria-label="Undo" />}>
          <Undo2Icon />
        </TooltipTrigger>
        <TooltipContent>
          Undo <Kbd>⌘Z</Kbd>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" disabled={!canRedo} onClick={() => engine.redo()} aria-label="Redo" />}>
          <Redo2Icon />
        </TooltipTrigger>
        <TooltipContent>
          Redo <Kbd>⇧⌘Z</Kbd>
        </TooltipContent>
      </Tooltip>

      <div className="flex flex-1 items-center justify-center gap-3">
        <ProjectName />
        <ModeSwitch />
      </div>

      <span className="hidden items-center gap-1 text-2xs text-muted-foreground sm:flex">
        <Kbd>⌘K</Kbd> commands
      </span>
      <ThemeToggle />
      <ShortcutsDialog />
      {embedded ? null : <ExportDialog />}
    </div>
  )
}
