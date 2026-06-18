"use client";

import Link from "next/link";
import { useEditor, useEditorState } from "@mcut/react";
import { ChevronDownIcon } from "@/lib/hugeicons";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import "./editor-default-actions";
import {
  formatShortcut,
  getEditorAction,
  isActionEnabled,
  runEditorAction,
  type ActionContext,
} from "./action-registry";
import { editorClipboard } from "./editor-clipboard";
import { useEditorUI, type EditorUIValue } from "./editor-ui";

/**
 * The brand-mark menu (CapCut-style logo dropdown): File / Edit / View /
 * Tools submenus over the same action registry as hotkeys and the ⌘K
 * palette — entries reference action ids, so labels, shortcuts, and enabled
 * states stay derived. The menu only curates grouping and order.
 */

interface ActionEntry {
  kind?: "action";
  id: string;
  /** Menu-friendly override of the registry label ("Paste" vs "Paste at playhead"). */
  label?: string;
}

interface CheckboxEntry {
  kind: "checkbox";
  id: string;
  label?: string;
  checked: (ui: EditorUIValue) => boolean;
}

type MenuEntry = ActionEntry | CheckboxEntry | "separator";

const MENU_SECTIONS: Array<{ label: string; entries: MenuEntry[] }> = [
  {
    label: "File",
    entries: [
      { id: "file.new" },
      { id: "file.open" },
      { id: "file.save" },
      "separator",
      { id: "file.import" },
      "separator",
      { id: "view.export", label: "Export video…" },
      { id: "file.export-otio", label: "Export OpenTimelineIO…" },
    ],
  },
  {
    label: "Edit",
    entries: [
      { id: "edit.undo" },
      { id: "edit.redo" },
      "separator",
      { id: "clipboard.cut" },
      { id: "clipboard.copy" },
      { id: "clipboard.paste", label: "Paste" },
      { id: "clipboard.duplicate" },
      { id: "edit.delete", label: "Delete" },
      "separator",
      { id: "edit.split", label: "Split at playhead" },
      { id: "selection.select-all", label: "Select all" },
      { id: "selection.deselect", label: "Deselect all" },
    ],
  },
  {
    label: "View",
    entries: [
      { id: "view.zoom-in" },
      { id: "view.zoom-out" },
      { id: "view.zoom-fit" },
      "separator",
      { kind: "checkbox", id: "view.toggle-snap", label: "Snapping", checked: (ui) => ui.snapEnabled },
      {
        kind: "checkbox",
        id: "view.toggle-auto-crossfade",
        label: "Auto-crossfade",
        checked: (ui) => ui.autoCrossfade,
      },
      { kind: "checkbox", id: "view.toggle-theme", label: "Dark theme", checked: (ui) => ui.theme === "dark" },
      "separator",
      { id: "view.fullscreen" },
      { id: "view.reset-layout" },
    ],
  },
  {
    label: "Tools",
    entries: [
      { id: "edit.add-text" },
      { id: "edit.add-track" },
      { id: "multicam.create", label: "Create multicam from selection" },
      "separator",
      { id: "help.command-palette" },
    ],
  },
];

function MenuEntryItem({ entry, context }: { entry: MenuEntry; context: ActionContext }) {
  if (entry === "separator") return <DropdownMenuSeparator />;
  const action = getEditorAction(entry.id);
  if (!action) return null;
  const label = entry.label ?? action.label;
  const shortcut = formatShortcut(action.shortcut);
  const disabled = !isActionEnabled(action, context);

  if (entry.kind === "checkbox") {
    return (
      <DropdownMenuCheckboxItem
        checked={entry.checked(context.ui)}
        disabled={disabled}
        onCheckedChange={() => runEditorAction(action, context)}
      >
        {label}
      </DropdownMenuCheckboxItem>
    );
  }
  return (
    <DropdownMenuItem disabled={disabled} onClick={() => runEditorAction(action, context)}>
      {label}
      {shortcut && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
    </DropdownMenuItem>
  );
}

export function MainMenu() {
  const engine = useEditor();
  const ui = useEditorUI();
  // Re-render with edits so enabled() states stay live while open.
  useEditorState((s) => s.project);
  useEditorState((s) => s.selection);
  const context: ActionContext = { engine, ui, clipboard: editorClipboard };
  const shortcutsAction = getEditorAction("help.shortcuts");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            aria-label="Main menu"
            className="mr-1 h-9 gap-1 px-1.5 hover:bg-foreground/5"
          />
        }
      >
        <BrandMark className="text-3xl" />
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-48">
        <DropdownMenuItem render={<Link href="/tools" />}>MCP tools</DropdownMenuItem>
        <DropdownMenuSeparator />
        {MENU_SECTIONS.map((section) => (
          <DropdownMenuSub key={section.label}>
            <DropdownMenuSubTrigger>{section.label}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-56">
              {section.entries.map((entry, index) => (
                <MenuEntryItem
                  key={entry === "separator" ? `separator-${index}` : entry.id}
                  entry={entry}
                  context={context}
                />
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
        <DropdownMenuSeparator />
        {shortcutsAction && (
          <DropdownMenuItem onClick={() => runEditorAction(shortcutsAction, context)}>
            Keyboard shortcuts
            <DropdownMenuShortcut>{formatShortcut(shortcutsAction.shortcut)}</DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
