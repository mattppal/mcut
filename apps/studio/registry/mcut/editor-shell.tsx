"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePanelRef, type GroupProps } from "react-resizable-panels";
import { CaptionsIcon, FolderOpenIcon, SearchIcon, SparklesIcon, TypeIcon } from "@/lib/hugeicons";
import { toast } from "sonner";
import { isWebGPUSupported } from "@mcut/compositor";
import { EditorProvider, PlayerCanvas, useEditor, useEditorState } from "@mcut/react";
import { getElement, type Project } from "@mcut/timeline";
import type { TranscriptResult } from "@mcut/transcription";
import { cn } from "@/lib/utils";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Toaster } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import "./editor-default-actions";
import { actionForEvent, isActionEnabled, runEditorAction, type ActionContext } from "./action-registry";
import { editorClipboard } from "./editor-clipboard";
import { AnimationsPanel } from "./animations-panel";
import { CaptionsPanel } from "./captions-panel";
import { TranscriptPanel } from "./transcript-panel";
import { TRANSCRIPT_FIND_EVENT } from "./transcript-keywords";
import { CommandPalette } from "./command-palette";
import { EditorDnd } from "./editor-dnd";
import { EDITOR_LAYOUT_KEYS, EDITOR_LAYOUT_RESET_EVENT } from "./editor-layout";
import { PanelCard, PanelHeader, PanelSectionLabel } from "./editor-primitives";
import { EditorToolbar } from "./editor-toolbar";
import { CurveEditorHost } from "./easing-editor";
import { EditorUIProvider, useEditorUI } from "./editor-ui";
import { useProjectFontLoader } from "./font-library";
import { LayoutBank } from "./layout-bank";
import { LayoutSlotEditor } from "./layout-slot-editor";
import { LiveMcpBridge } from "./live-mcp-bridge";
import { TextEditOverlay } from "./text-edit-overlay";
import { MediaBin } from "./media-bin";
import {
  clearSavedSession,
  loadSavedSession,
  requestPersistentStorage,
  saveAssetBlob,
  saveProjectSnapshot,
} from "./persistence";
import { PropertiesPanel } from "./properties-panel";
import { TextPanel } from "./text-panel";
import { TimelinePanel } from "./timeline-panel";
import { TransportBar } from "./transport-bar";

// ---------------------------------------------------------------------------
// Hotkeys
// ---------------------------------------------------------------------------

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

/** Fonts referenced by the project load as soon as they appear in it. */
function ProjectFontLoader() {
  useProjectFontLoader();
  return null;
}

function EditorHotkeys() {
  const engine = useEditor();
  const ui = useEditorUI();
  const uiRef = useRef(ui);
  useEffect(() => {
    uiRef.current = ui;
  }, [ui]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Esc layers: blur a focused input first; only then touch selection.
      if (isTypingTarget(event.target)) {
        if (event.key === "Escape") (event.target as HTMLElement).blur();
        return;
      }
      if (event.key === "Escape") {
        engine.clearSelection();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        toast("Autosaved — projects persist in this browser");
        return;
      }
      const action = actionForEvent(event);
      if (!action) return;
      event.preventDefault(); // stops browser ⌘A/⌘D/⌘S-adjacent defaults
      const context: ActionContext = {
        engine,
        ui: uiRef.current,
        clipboard: editorClipboard,
      };
      if (isActionEnabled(action, context)) runEditorAction(action, context);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [engine]);
  return null;
}

// ---------------------------------------------------------------------------
// Autosave + restore
// ---------------------------------------------------------------------------

function SessionPersistence() {
  const engine = useEditor();
  const promptedRef = useRef(false);

  useEffect(() => {
    if (promptedRef.current) return;
    promptedRef.current = true;
    loadSavedSession()
      .then((saved) => {
        if (!saved) return;
        const current = engine.project;
        const isEmpty =
          Object.keys(current.assets).length === 0 &&
          current.tracks.every((t) => t.elements.length === 0);
        if (!isEmpty) return;
        toast("Restore previous session?", {
          duration: 12_000,
          action: {
            label: "Restore",
            onClick: () => {
              engine.loadProject(saved.project);
              if (saved.missingAssetIds.length > 0) {
                toast.warning(
                  `${saved.missingAssetIds.length} media file(s) could not be restored — re-import them.`,
                );
              }
            },
          },
          cancel: { label: "Discard", onClick: () => void clearSavedSession() },
        });
      })
      .catch(() => {});
  }, [engine]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let persistenceRequested = false;
    const subscription = engine.store.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!persistenceRequested) {
          persistenceRequested = true;
          // Opt out of best-effort eviction so the browser doesn't silently
          // delete the project library and media under storage pressure.
          void requestPersistentStorage();
        }
        saveProjectSnapshot(engine.project).catch(() => {});
      }, 800);
    });
    return () => {
      if (timer) clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [engine]);

  return null;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function readPersistedLayout(key: string, resetToken: number): GroupProps["defaultLayout"] | undefined {
  void resetToken;
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as GroupProps["defaultLayout"]) : undefined;
  } catch {
    return undefined;
  }
}

/** Persist a panel-group layout to localStorage (panels need stable `id`s). */
function usePersistedLayout(
  key: string,
  resetToken: number,
): Pick<GroupProps, "defaultLayout" | "onLayoutChanged"> {
  const defaultLayout = useMemo(() => readPersistedLayout(key, resetToken), [key, resetToken]);
  const onLayoutChanged = useCallback(
    (layout: Parameters<NonNullable<GroupProps["onLayoutChanged"]>>[0]) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(layout));
      } catch {
        // Private mode: layout just doesn't persist.
      }
    },
    [key],
  );
  return {
    ...(defaultLayout ? { defaultLayout } : {}),
    onLayoutChanged,
  };
}

function subscribeHydration(onStoreChange: () => void): () => void {
  const id = window.setTimeout(onStoreChange, 0);
  return () => window.clearTimeout(id);
}

function clientHydrationSnapshot(): boolean {
  return true;
}

function serverHydrationSnapshot(): boolean {
  return false;
}

function useHasHydrated(): boolean {
  return useSyncExternalStore(
    subscribeHydration,
    clientHydrationSnapshot,
    serverHydrationSnapshot,
  );
}

type LeftTab = "media" | "text" | "animate" | "captions" | "transcript";

const LEFT_TABS: Array<{ id: LeftTab; label: string; icon: typeof FolderOpenIcon }> = [
  { id: "media", label: "Media", icon: FolderOpenIcon },
  { id: "text", label: "Text", icon: TypeIcon },
  { id: "animate", label: "Animate", icon: SparklesIcon },
  { id: "captions", label: "Captions", icon: CaptionsIcon },
  { id: "transcript", label: "Find", icon: SearchIcon },
];

/**
 * The outer chrome's left rail: tab icons sit directly on the backdrop (no
 * borders). The active tab adopts the panel surface so it reads as attached
 * to the window beside it; clicking it again collapses the panel.
 */
function ChromeRail({
  tab,
  collapsed,
  onSelect,
}: {
  tab: LeftTab;
  collapsed: boolean;
  onSelect: (tab: LeftTab) => void;
}) {
  return (
    <div className="flex w-13 shrink-0 flex-col items-center gap-2 pt-1">
      {LEFT_TABS.map(({ id, label, icon: Icon }) => (
        <Tooltip key={id}>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-rail-tab={id}
                aria-label={collapsed ? `Show ${label.toLowerCase()}` : label}
                aria-pressed={tab === id && !collapsed}
                className={cn(
                  "flex size-10 items-center justify-center rounded-lg transition-colors",
                  tab === id && !collapsed
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                )}
                onClick={() => onSelect(id)}
              />
            }
          >
            <Icon className="size-5" />
          </TooltipTrigger>
          <TooltipContent side="right">
            {collapsed ? `Show ${label.toLowerCase()}` : label}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

function LeftPanel({ tab, transcribe }: { tab: LeftTab } & Pick<EditorShellProps, "transcribe">) {
  // Media and captions pin their own headers/actions and scroll themselves.
  if (tab === "media") {
    return (
      <PanelCard>
        <MediaBin onAssetImported={(asset, file) => void saveAssetBlob(asset, file)} />
      </PanelCard>
    );
  }
  if (tab === "captions") {
    return (
      <PanelCard>
        <CaptionsPanel transcribe={transcribe} />
      </PanelCard>
    );
  }
  if (tab === "transcript") {
    return (
      <PanelCard>
        <TranscriptPanel transcribe={transcribe} />
      </PanelCard>
    );
  }
  return (
    <PanelCard className="flex flex-col">
      <PanelHeader>
        <PanelSectionLabel>{tab === "text" ? "Text" : "Animate"}</PanelSectionLabel>
      </PanelHeader>
      <ScrollArea className="min-h-0 min-w-0 flex-1 scroll-mask-y">
        {tab === "text" ? <TextPanel /> : <AnimationsPanel />}
      </ScrollArea>
    </PanelCard>
  );
}

/**
 * Compositor selection: `?renderer=webgpu` opts the preview into the WebGPU
 * pass pipeline (and `?renderer=canvas2d` stays the escape hatch once the
 * default flips). Requesting WebGPU on a browser without `navigator.gpu`
 * (Chrome 113+/Safari 26+/Firefox 141+) surfaces a clear message and renders
 * with canvas2d instead.
 */
function usePreviewRenderer(): "canvas2d" | "webgpu" {
  const [renderer] = useState<"canvas2d" | "webgpu">(() => {
    if (typeof window === "undefined") return "canvas2d";
    const requested = new URLSearchParams(window.location.search).get("renderer");
    if (requested !== "webgpu") return "canvas2d";
    if (!isWebGPUSupported()) {
      setTimeout(() => {
        toast.error(
          "This browser has no WebGPU (needs Chrome 113+, Safari 26+, or Firefox 141+) — using the canvas2d renderer.",
        );
      }, 0);
      return "canvas2d";
    }
    return "webgpu";
  });
  return renderer;
}

function EditorDocumentTheme({ theme }: { theme: ReturnType<typeof useEditorUI>["theme"] }) {
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    const hadEditorTheme = root.hasAttribute("data-editor");
    root.setAttribute("data-editor", "");
    root.classList.toggle("dark", theme === "dark");
    return () => {
      if (!hadEditorTheme) root.removeAttribute("data-editor");
      root.classList.toggle("dark", hadDark);
    };
  }, [theme]);
  return null;
}

function PreviewArea() {
  const engine = useEditor();
  const width = useEditorState((s) => s.project.width);
  const height = useEditorState((s) => s.project.height);
  const { mode, previewQuality, editingTextId, setEditingTextId } = useEditorUI();
  const renderer = usePreviewRenderer();
  return (
    <PanelCard className="flex flex-col">
      <div className="flex min-h-0 flex-1">
        {mode === "multicam" && <LayoutBank />}
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden p-4 [container-type:size]">
        <div
          className="relative w-full"
          style={{
            maxWidth: `min(100%, calc(100cqh * ${width / height} - ${(24 * width) / height}px))`,
            ["--mcut-aspect" as string]: `${width} / ${height}`,
          }}
        >
          <PlayerCanvas
            quality={previewQuality}
            renderer={renderer}
            className="overflow-hidden rounded-lg shadow-xl ring-1 ring-foreground/10"
            {...(editingTextId ? { hiddenElementIds: new Set([editingTextId]) } : {})}
            onElementDoubleClick={(elementId) => {
              // Text edits inline on the canvas; other types just select.
              const element = getElement(engine.project, elementId);
              if (element?.type === "text") setEditingTextId(elementId);
            }}
          />
          {mode === "multicam" && <LayoutSlotEditor />}
          <TextEditOverlay />
          </div>
        </div>
      </div>
      <TransportBar />
    </PanelCard>
  );
}

function TrackSorter({ children }: { children: React.ReactNode }) {
  const engine = useEditor();
  return (
    <EditorDnd
      onTrackSort={(activeTrackId, overTrackId) => {
        const toIndex = engine.project.tracks.findIndex((t) => t.id === overTrackId);
        if (toIndex === -1) return;
        try {
          engine.dispatch({
            type: "reorderTrack",
            trackId: activeTrackId as `t-${string}`,
            toIndex,
          });
        } catch {
          // Track vanished mid-drag.
        }
      }}
    >
      {children}
    </EditorDnd>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export interface EditorShellProps {
  /** Initial project; an empty 1920×1080/30fps project by default. */
  project?: Project;
  /**
   * Audio → transcript handler used by the captions panel. Point it at your
   * own API route (see `app/api/transcribe/route.ts` in the mcut demo) or
   * any `@mcut/transcription` provider running server-side.
   */
  transcribe?: (audio: Blob) => Promise<TranscriptResult>;
}

/**
 * Everything inside the providers: the outer chrome (toolbar across the top,
 * tab rail down the left, both directly on the warm backdrop) framing the
 * editor windows — left panel, preview, inspector, timeline — which float as
 * rounded cards separated by gaps instead of divider lines.
 */
function Shell({ transcribe }: Pick<EditorShellProps, "transcribe">) {
  const { theme } = useEditorUI();
  const panelsReady = useHasHydrated();
  const [layoutResetToken, setLayoutResetToken] = useState(0);
  const verticalLayout = usePersistedLayout(EDITOR_LAYOUT_KEYS.vertical, layoutResetToken);
  const horizontalLayout = usePersistedLayout(EDITOR_LAYOUT_KEYS.horizontal, layoutResetToken);
  useEffect(() => {
    const onReset = () => setLayoutResetToken((value) => value + 1);
    window.addEventListener(EDITOR_LAYOUT_RESET_EVENT, onReset);
    return () => window.removeEventListener(EDITOR_LAYOUT_RESET_EVENT, onReset);
  }, []);

  const [tab, setTab] = useState<LeftTab>("media");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const leftPanelRef = usePanelRef();

  // ⌘F (transcript find): reveal the transcript tab; the panel focuses its
  // search box off the same event once mounted.
  useEffect(() => {
    const onFind = () => {
      leftPanelRef.current?.expand();
      setTab("transcript");
    };
    window.addEventListener(TRANSCRIPT_FIND_EVENT, onFind);
    return () => window.removeEventListener(TRANSCRIPT_FIND_EVENT, onFind);
  }, [leftPanelRef]);

  const onRailSelect = (next: LeftTab) => {
    const panel = leftPanelRef.current;
    if (panel?.isCollapsed()) {
      panel.expand();
      setTab(next);
      return;
    }
    if (next === tab) {
      panel?.collapse();
      return;
    }
    setTab(next);
  };

  return (
    <div
      data-editor=""
      className={cn(
        "flex h-dvh flex-col overflow-hidden bg-background text-foreground",
        theme === "dark" && "dark",
      )}
    >
      <EditorDocumentTheme theme={theme} />
      <EditorHotkeys />
      <CommandPalette />
      <CurveEditorHost />
      <SessionPersistence />
      <ProjectFontLoader />
      <LiveMcpBridge />
      <EditorToolbar />
      <div className="flex min-h-0 flex-1">
        <ChromeRail tab={tab} collapsed={leftCollapsed} onSelect={onRailSelect} />
        {panelsReady ? (
          <TrackSorter>
            <ResizablePanelGroup
              key={`vertical-${layoutResetToken}`}
              orientation="vertical"
              className="min-h-0 flex-1 pr-2 pb-2"
              {...verticalLayout}
            >
              <ResizablePanel id="workspace" defaultSize="62%" minSize="30%">
                <ResizablePanelGroup
                  key={`horizontal-${layoutResetToken}`}
                  orientation="horizontal"
                  {...horizontalLayout}
                >
                  <ResizablePanel
                    id="left"
                    defaultSize="22%"
                    minSize="14%"
                    collapsible
                    panelRef={leftPanelRef}
                    onResize={(size) => setLeftCollapsed(size.asPercentage === 0)}
                  >
                    <LeftPanel tab={tab} transcribe={transcribe} />
                  </ResizablePanel>
                  <ResizableHandle className={leftCollapsed ? "hidden" : undefined} />
                  <ResizablePanel id="preview" defaultSize="56%" minSize="30%">
                    <PreviewArea />
                  </ResizablePanel>
                  <ResizableHandle />
                  <ResizablePanel id="inspector" defaultSize="22%" minSize="14%" collapsible>
                    <PanelCard>
                      <ScrollArea className="h-full scroll-mask-b">
                        <PropertiesPanel />
                      </ScrollArea>
                    </PanelCard>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel id="timeline" defaultSize="38%" minSize="18%">
                <PanelCard>
                  <TimelinePanel className="h-full" />
                </PanelCard>
              </ResizablePanel>
            </ResizablePanelGroup>
          </TrackSorter>
        ) : (
          <div className="min-h-0 flex-1 pr-2 pb-2">
            <PanelCard className="flex items-center justify-center text-xs text-muted-foreground">
              <span>Loading editor...</span>
            </PanelCard>
          </div>
        )}
      </div>
      <Toaster position="bottom-right" />
    </div>
  );
}

/**
 * The full mcut editor: warm-grey outer chrome (toolbar + tab rail) around
 * floating panel windows (media · preview · inspector over a multi-track
 * timeline), drag-and-drop from the bin, magnetic editing, ⌘K palette,
 * light/dark themes, and IndexedDB session restore. Installed as source —
 * every panel is yours to modify.
 */
export function EditorShell({ project, transcribe }: EditorShellProps) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <EditorProvider {...(project ? { project } : {})}>
        <EditorUIProvider>
          <TooltipProvider>
            <Shell transcribe={transcribe} />
          </TooltipProvider>
        </EditorUIProvider>
      </EditorProvider>
    </QueryClientProvider>
  );
}
