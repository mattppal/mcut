"use client";

import { createElement, useEffect, useState } from "react";
import { useEditor, useEditorState } from "@mcut/react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import "./editor-default-actions";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  formatShortcut,
  isActionEnabled,
  listEditorActions,
  runEditorAction,
  type ActionContext,
} from "./action-registry";
import { COMMAND_PALETTE_OPEN_EVENT } from "./command-palette-events";
import { editorClipboard } from "./editor-clipboard";
import { useEditorUI } from "./editor-ui";

/**
 * ⌘K palette — fully derived from the action registry: every action with
 * `palette !== false` appears, grouped by category, with its live enabled
 * state and shortcut. Declaring a new action is all it takes to show up here.
 */
export function CommandPalette() {
  const engine = useEditor();
  const ui = useEditorUI();
  const [open, setOpen] = useState(false);
  // Re-render with edits so enabled() states stay live while open.
  useEditorState((s) => s.project);
  useEditorState((s) => s.selection);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    const onOpenEvent = () => setOpen(true); // main menu → Help → Command palette
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpenEvent);
    };
  }, []);

  const context: ActionContext = { engine, ui, clipboard: editorClipboard };
  const actions = listEditorActions().filter((action) => action.palette !== false);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command…" />
      <CommandList className="scroll-mask-y">
        <CommandEmpty>No matching command.</CommandEmpty>
        {CATEGORY_ORDER.map((category) => {
          const items = actions.filter((action) => action.category === category);
          if (items.length === 0) return null;
          return (
            <CommandGroup key={category} heading={CATEGORY_LABELS[category]}>
              {items.map((action) => (
                <CommandItem
                  key={action.id}
                  disabled={!isActionEnabled(action, context)}
                  onSelect={() => {
                    setOpen(false);
                    runEditorAction(action, context);
                  }}
                >
                  {action.icon && createElement(action.icon, { className: "size-4" })}
                  {action.label}
                  {action.shortcut && (
                    <CommandShortcut>{formatShortcut(action.shortcut)}</CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
