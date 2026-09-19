"use client";

import { createElement } from "react";
import { useEditor, useEditorState, useWindowEvent } from "@mcut/react";
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
import { setCommandPaletteOpen, useCommandPaletteOpen } from "./command-palette-events";
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
  const open = useCommandPaletteOpen();
  // Re-render with edits so enabled() states stay live while open.
  useEditorState((s) => s.project);
  useEditorState((s) => s.selection);

  useWindowEvent("keydown", (event) => {
    if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      setCommandPaletteOpen(!open);
    }
  });

  const context: ActionContext = { engine, ui, clipboard: editorClipboard };
  const actions = listEditorActions().filter((action) => action.palette !== false);

  return (
    <CommandDialog open={open} onOpenChange={setCommandPaletteOpen}>
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
                    setCommandPaletteOpen(false);
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
