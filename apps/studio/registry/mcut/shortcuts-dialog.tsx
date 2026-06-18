"use client";

import { useState } from "react";
import { KeyboardIcon } from "@/lib/hugeicons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import "./editor-default-actions";
import { formatShortcut, listEditorActions } from "./action-registry";

/** Pointer gestures that aren't registry actions. */
const GESTURES: Array<{ keys: string; label: string }> = [
  { keys: "⌘ Scroll", label: "Zoom timeline at pointer" },
  { keys: "⇧ Click", label: "Add clip to selection" },
  { keys: "⌥ Drag ◆", label: "No snap" },
  { keys: "⌥ Click ◆", label: "Delete keyframe" },
  { keys: "⌘ Click", label: "Add volume keyframe on the band" },
  { keys: "⌘K", label: "Command palette" },
  { keys: "Esc", label: "Blur field / clear selection" },
];

/** Derived from the action registry — never hand-maintained again. */
export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  const rows = listEditorActions()
    .filter((action) => action.shortcut)
    .map((action) => ({ label: action.label, keys: formatShortcut(action.shortcut) }));

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Keyboard shortcuts"
        data-mcut-shortcuts-trigger=""
        onClick={() => setOpen(true)}
      >
        <KeyboardIcon />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Everything is reachable without the mouse.</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-96 grid-cols-1 gap-1.5 overflow-y-auto scroll-mask-y sm:grid-cols-2">
            {[...rows, ...GESTURES].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">{row.label}</span>
                <Kbd>{row.keys}</Kbd>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
