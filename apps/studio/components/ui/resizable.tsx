"use client"

import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

/**
 * Resize handles are GAPS, not lines: the backdrop shows through between
 * panels, and a short rounded grip fades in only while hovering or
 * dragging — separation comes from spacing, not chrome.
 */
function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  void withHandle
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "group relative flex w-2 shrink-0 cursor-col-resize items-center justify-center bg-transparent outline-none after:absolute after:left-1/2 after:h-9 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-foreground/25 after:opacity-0 after:transition-opacity hover:after:opacity-100 focus-visible:after:opacity-100 data-dragging:after:opacity-100 aria-[orientation=horizontal]:h-2 aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:cursor-row-resize aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:left-auto aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-9 aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2",
        className
      )}
      {...props}
    />
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
