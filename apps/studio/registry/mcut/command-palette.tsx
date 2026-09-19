'use client'

import { createElement } from 'react'
import { useEditor, useWindowEvent } from '@mcut/react'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command'
import './editor-default-actions'
import { CATEGORY_LABELS, CATEGORY_ORDER, formatShortcut, isActionEnabled, listEditorActions, runEditorAction, type ActionContext } from './action-registry'
import { setCommandPaletteOpen, useCommandPaletteOpen } from './command-palette-events'
import { editorClipboard } from './editor-clipboard'
import { useEditorUI, useLiveActionEnabledStates } from './editor-ui'

export function CommandPalette() {
  const engine = useEditor()
  const ui = useEditorUI()
  const open = useCommandPaletteOpen()
  useLiveActionEnabledStates()

  useWindowEvent('keydown', (event) => {
    if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      setCommandPaletteOpen(!open)
    }
  })

  const context: ActionContext = { engine, ui, clipboard: editorClipboard }
  const actions = listEditorActions().filter((action) => action.palette !== false)

  return (
    <CommandDialog open={open} onOpenChange={setCommandPaletteOpen}>
      <CommandInput placeholder="Type a command…" />
      <CommandList className="scroll-mask-y">
        <CommandEmpty>No matching command.</CommandEmpty>
        {CATEGORY_ORDER.map((category) => {
          const items = actions.filter((action) => action.category === category)
          if (items.length === 0) return null
          return (
            <CommandGroup key={category} heading={CATEGORY_LABELS[category]}>
              {items.map((action) => (
                <CommandItem
                  key={action.id}
                  disabled={!isActionEnabled(action, context)}
                  onSelect={() => {
                    setCommandPaletteOpen(false)
                    runEditorAction(action, context)
                  }}
                >
                  {action.icon && createElement(action.icon, { className: 'size-4' })}
                  {action.label}
                  {action.shortcut && <CommandShortcut>{formatShortcut(action.shortcut)}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          )
        })}
      </CommandList>
    </CommandDialog>
  )
}
