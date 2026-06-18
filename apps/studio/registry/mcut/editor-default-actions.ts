import {
  DownloadIcon,
  FileVideoIcon,
  FolderOpenIcon,
  KeyboardIcon,
  MaximizeIcon,
  MoonIcon,
  PlayIcon,
  PlusIcon,
  ScissorsIcon,
  SearchIcon,
  TypeIcon,
  UploadIcon,
} from "@/lib/hugeicons";
import { toast } from "sonner";
import { createProject, getProjectDurationMs, toOtioJson } from "@mcut/timeline";
import { findTargetMulticam, switchToLayout } from "./multicam-ui";
import { defineAction, type ActionContext } from "./action-registry";
import { ASPECT_PRESETS } from "./aspect-presets";
import { COMMAND_PALETTE_OPEN_EVENT } from "./command-palette-events";
import { requestEditorLayoutReset } from "./editor-layout";
import { TIMELINE_HEADER_WIDTH } from "./editor-ui";
import { trackOfSelection } from "./editor-actions";
import { copySelection, cutSelection, pasteAtPlayheadFromAnywhere } from "./editor-clipboard";
import { importMediaFiles, pickFiles } from "./media-import";
import { clearSavedSession, saveAssetBlob } from "./persistence";
import { openProjectFromFile, saveProjectToFile } from "./project-file";
import { requestTranscriptFind } from "./transcript-keywords";

/**
 * The default action set. Declared once; hotkeys, the ⌘K palette, context
 * menus, and the shortcuts dialog all derive from these definitions.
 * Importing this module registers them (side-effectful by design — the same
 * pattern as the engine's command registry).
 */

const hasSelection = ({ engine }: ActionContext) => engine.selection.elementIds.length > 0;

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

defineAction({
  id: "playback.toggle",
  label: "Play / pause",
  category: "playback",
  shortcut: { key: " " },
  icon: PlayIcon,
  operator: { id: "playback.toggle" },
});

defineAction({
  id: "playback.go-start",
  label: "Go to start",
  category: "playback",
  shortcut: { key: "Home" },
  operator: { id: "playback.goStart" },
});

defineAction({
  id: "playback.go-end",
  label: "Go to end",
  category: "playback",
  shortcut: { key: "End" },
  operator: { id: "playback.goEnd" },
});

defineAction({
  id: "playback.step-back",
  label: "Previous frame",
  category: "playback",
  shortcut: { key: "ArrowLeft" },
  palette: false,
  operator: { id: "playback.step", input: (ctx) => ({ deltaMs: -1000 / ctx.engine.project.fps }) },
});

defineAction({
  id: "playback.step-forward",
  label: "Next frame",
  category: "playback",
  shortcut: { key: "ArrowRight" },
  palette: false,
  operator: { id: "playback.step", input: (ctx) => ({ deltaMs: 1000 / ctx.engine.project.fps }) },
});

defineAction({
  id: "playback.step-back-second",
  label: "Back one second",
  category: "playback",
  shortcut: { key: "ArrowLeft", shift: true },
  palette: false,
  operator: { id: "playback.step", input: { deltaMs: -1000 } },
});

defineAction({
  id: "playback.step-forward-second",
  label: "Forward one second",
  category: "playback",
  shortcut: { key: "ArrowRight", shift: true },
  palette: false,
  operator: { id: "playback.step", input: { deltaMs: 1000 } },
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

defineAction({
  id: "selection.select-all",
  label: "Select all clips",
  category: "selection",
  shortcut: { key: "a", meta: true },
  operator: { id: "selection.selectAll" },
});

defineAction({
  id: "selection.deselect",
  label: "Deselect all",
  category: "selection",
  shortcut: { key: "a", meta: true, shift: true },
  operator: { id: "selection.clear" },
});

defineAction({
  id: "selection.select-track",
  label: "Select all clips on current track",
  category: "selection",
  enabled: (ctx) => trackOfSelection(ctx.engine) !== undefined,
  operator: {
    id: "selection.selectTrack",
    input: (ctx) => ({ trackId: trackOfSelection(ctx.engine)?.id }),
  },
});

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

defineAction({
  id: "clipboard.copy",
  label: "Copy",
  category: "clipboard",
  shortcut: { key: "c", meta: true },
  enabled: hasSelection,
  run: ({ engine }) => copySelection(engine),
});

defineAction({
  id: "clipboard.cut",
  label: "Cut",
  category: "clipboard",
  shortcut: { key: "x", meta: true },
  enabled: hasSelection,
  run: ({ engine }) => cutSelection(engine),
});

defineAction({
  id: "clipboard.paste",
  label: "Paste at playhead",
  category: "clipboard",
  shortcut: { key: "v", meta: true },
  // The OS clipboard may hold an mcut envelope from another tab/project,
  // so paste stays available even when the internal clipboard is empty.
  run: ({ engine }) => void pasteAtPlayheadFromAnywhere(engine),
});

defineAction({
  id: "clipboard.duplicate",
  label: "Duplicate",
  category: "clipboard",
  shortcut: { key: "d", meta: true },
  operator: { id: "edit.duplicateSelection" },
});

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

defineAction({
  id: "edit.undo",
  label: "Undo",
  category: "edit",
  shortcut: { key: "z", meta: true },
  operator: { id: "edit.undo" },
});

defineAction({
  id: "edit.redo",
  label: "Redo",
  category: "edit",
  shortcut: { key: "z", meta: true, shift: true },
  operator: { id: "edit.redo" },
});

defineAction({
  id: "edit.split",
  label: "Split selection at playhead",
  category: "edit",
  shortcut: { key: "s" },
  icon: ScissorsIcon,
  operator: { id: "edit.splitSelectionAtPlayhead" },
});

defineAction({
  id: "edit.delete",
  label: "Delete selection",
  category: "edit",
  shortcut: [{ key: "Backspace" }, { key: "Delete" }],
  operator: { id: "edit.deleteSelection" },
});

defineAction({
  id: "edit.add-text",
  label: "Add text at playhead",
  category: "edit",
  icon: TypeIcon,
  operator: { id: "edit.addTextAtPlayhead" },
});

defineAction({
  id: "edit.add-track",
  label: "Add track",
  category: "track",
  icon: PlusIcon,
  operator: { id: "edit.addTrack" },
});

// ---------------------------------------------------------------------------
// Keyframes
// ---------------------------------------------------------------------------

defineAction({
  id: "keyframes.previous",
  label: "Previous keyframe",
  category: "keyframes",
  shortcut: { key: "[" },
  operator: { id: "keyframes.previous" },
});

defineAction({
  id: "keyframes.next",
  label: "Next keyframe",
  category: "keyframes",
  shortcut: { key: "]" },
  operator: { id: "keyframes.next" },
});

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

defineAction({
  id: "markers.toggle",
  label: "Add/remove marker at playhead",
  category: "markers",
  shortcut: { key: "m" },
  operator: { id: "markers.toggleAtPlayhead" },
});

defineAction({
  id: "markers.next",
  label: "Next marker",
  category: "markers",
  shortcut: { key: "m", shift: true },
  operator: { id: "markers.next" },
});

defineAction({
  id: "markers.previous",
  label: "Previous marker",
  category: "markers",
  shortcut: { key: "m", alt: true },
  operator: { id: "markers.previous" },
});

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

defineAction({
  id: "transcript.find",
  label: "Find in transcript",
  category: "transcript",
  shortcut: { key: "f", meta: true },
  icon: SearchIcon,
  run: () => requestTranscriptFind(),
});

// ---------------------------------------------------------------------------
// Reverse
// ---------------------------------------------------------------------------

defineAction({
  id: "edit.toggle-reverse",
  label: "Reverse selected clips (toggle)",
  category: "edit",
  operator: { id: "edit.toggleReverseSelection" },
});

// ---------------------------------------------------------------------------
// Project canvas (aspect-ratio presets)
// ---------------------------------------------------------------------------

for (const preset of ASPECT_PRESETS) {
  defineAction({
    id: `view.aspect-${preset.id}`,
    label: `Canvas ${preset.label} (${preset.width}×${preset.height})`,
    category: "view",
    run: ({ engine }) =>
      engine.dispatch({ type: "updateProject", width: preset.width, height: preset.height }),
  });
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

defineAction({
  id: "view.toggle-snap",
  label: "Toggle snapping",
  category: "view",
  shortcut: { key: "n" },
  run: ({ ui }) => ui.setSnapEnabled(!ui.snapEnabled),
});

defineAction({
  id: "view.toggle-auto-crossfade",
  label: "Toggle auto-crossfade (dissolve when clips are pushed together)",
  category: "view",
  run: ({ ui }) => ui.setAutoCrossfade(!ui.autoCrossfade),
});

// ---------------------------------------------------------------------------
// Timeline tools (Premiere palette letters) + edit modes (Kdenlive taxonomy)
// ---------------------------------------------------------------------------

const TOOL_ACTIONS = [
  { id: "select", label: "Select tool (move/trim)", key: "v" },
  { id: "ripple", label: "Ripple tool (trim closes gaps)", key: "b" },
  { id: "roll", label: "Roll tool (move the cut between clips)", key: "r" },
  { id: "slip", label: "Slip tool (shift source without moving the clip)", key: "y" },
  { id: "slide", label: "Slide tool (move a clip between its neighbors)", key: "u" },
] as const;

for (const tool of TOOL_ACTIONS) {
  defineAction({
    id: `tool.${tool.id}`,
    label: tool.label,
    category: "edit",
    shortcut: { key: tool.key },
    palette: true,
    run: ({ ui }) => ui.setTimelineTool(tool.id),
  });
}

for (const mode of ["normal", "overwrite", "insert"] as const) {
  defineAction({
    id: `edit.mode-${mode}`,
    label: `Edit mode: ${mode[0]!.toUpperCase()}${mode.slice(1)}`,
    category: "edit",
    run: ({ ui }) => ui.setEditMode(mode),
  });
}

defineAction({
  id: "edit.ripple-trim-start-to-playhead",
  label: "Ripple trim start to playhead",
  category: "edit",
  shortcut: { key: "q", alt: true },
  operator: { id: "edit.rippleTrimToPlayhead", input: { edge: "start" } },
});

defineAction({
  id: "edit.ripple-trim-end-to-playhead",
  label: "Ripple trim end to playhead",
  category: "edit",
  shortcut: { key: "w", alt: true },
  operator: { id: "edit.rippleTrimToPlayhead", input: { edge: "end" } },
});

defineAction({
  id: "view.export",
  label: "Export…",
  category: "view",
  icon: DownloadIcon,
  run: () => {
    document.querySelector<HTMLButtonElement>("[data-mcut-export-trigger]")?.click();
  },
});

// ---------------------------------------------------------------------------
// Tracks + playhead (parity PR 2)
// ---------------------------------------------------------------------------

defineAction({
  id: "track.delete-current",
  label: "Delete current track",
  category: "track",
  operator: { id: "track.deleteCurrent" },
});

defineAction({
  id: "track.solo-current",
  label: "Solo current track (toggle)",
  category: "track",
  operator: { id: "track.soloCurrent" },
});

defineAction({
  id: "playback.edge-previous",
  label: "Jump to previous clip edge",
  category: "playback",
  shortcut: { key: "ArrowUp" },
  operator: { id: "playback.edgePrevious" },
});

defineAction({
  id: "playback.edge-next",
  label: "Jump to next clip edge",
  category: "playback",
  shortcut: { key: "ArrowDown" },
  operator: { id: "playback.edgeNext" },
});

defineAction({
  id: "playback.shuttle-reverse",
  label: "Shuttle backward (J)",
  category: "playback",
  shortcut: { key: "j" },
  palette: false,
  operator: { id: "playback.shuttle", input: { direction: -1 } },
});

defineAction({
  id: "playback.shuttle-stop",
  label: "Shuttle stop (K)",
  category: "playback",
  shortcut: { key: "k" },
  palette: false,
  operator: { id: "playback.shuttle", input: { direction: 0 } },
});

defineAction({
  id: "playback.shuttle-forward",
  label: "Shuttle forward (L)",
  category: "playback",
  shortcut: { key: "l" },
  palette: false,
  operator: { id: "playback.shuttle", input: { direction: 1 } },
});

// ---------------------------------------------------------------------------
// Trim + view (parity PR 3)
// ---------------------------------------------------------------------------

defineAction({
  id: "edit.ripple-delete",
  label: "Ripple delete (close the gap)",
  category: "edit",
  shortcut: [
    { key: "Backspace", shift: true },
    { key: "Delete", shift: true },
  ],
  operator: { id: "edit.rippleDeleteSelection" },
});

defineAction({
  id: "edit.trim-start-to-playhead",
  label: "Trim start to playhead",
  category: "edit",
  shortcut: { key: "q" },
  operator: { id: "edit.trimSelectionToPlayhead", input: { edge: "start" } },
});

defineAction({
  id: "edit.trim-end-to-playhead",
  label: "Trim end to playhead",
  category: "edit",
  shortcut: { key: "w" },
  operator: { id: "edit.trimSelectionToPlayhead", input: { edge: "end" } },
});

defineAction({
  id: "edit.split-all",
  label: "Split all tracks at playhead",
  category: "edit",
  shortcut: { key: "s", shift: true },
  operator: { id: "edit.splitAllAtPlayhead" },
});

defineAction({
  id: "view.zoom-in",
  label: "Zoom in",
  category: "view",
  shortcut: { key: "=", meta: true },
  run: ({ engine, ui }) => ui.zoomBy(1.3, engine.playback.state.currentTimeMs),
});

defineAction({
  id: "view.zoom-out",
  label: "Zoom out",
  category: "view",
  shortcut: { key: "-", meta: true },
  run: ({ engine, ui }) => ui.zoomBy(1 / 1.3, engine.playback.state.currentTimeMs),
});

defineAction({
  id: "view.zoom-fit",
  label: "Fit timeline to view",
  category: "view",
  shortcut: { key: "z", shift: true },
  enabled: (ctx) => getProjectDurationMs(ctx.engine.project) > 0,
  run: ({ engine, ui }) => {
    const scroller = ui.timelineScrollRef.current;
    const durationMs = getProjectDurationMs(engine.project);
    if (!scroller || durationMs === 0) return;
    ui.setPxPerMs((scroller.clientWidth - TIMELINE_HEADER_WIDTH - 60) / durationMs);
    scroller.scrollLeft = 0;
  },
});

defineAction({
  id: "keyframes.toggle",
  label: "Add/remove keyframe at playhead",
  category: "keyframes",
  shortcut: { key: "k", alt: true },
  operator: { id: "keyframes.toggleMasterAtPlayhead" },
});

// ---------------------------------------------------------------------------
// Multicam (active in multicam mode): 1–9 switch layouts — cut while playing,
// correct the span while paused (Premiere semantics).
// ---------------------------------------------------------------------------

function targetMulticam({ engine, ui }: ActionContext) {
  if (ui.mode !== "multicam") return null;
  return findTargetMulticam(
    engine.project,
    engine.selection.elementIds,
    engine.playback.state.currentTimeMs,
  );
}

for (let i = 0; i < 9; i++) {
  defineAction({
    id: `multicam.switch-${i + 1}`,
    label: `Multicam: switch to layout ${i + 1}`,
    category: "multicam",
    shortcut: { key: String(i + 1) },
    enabled: (context) => {
      const target = targetMulticam(context);
      return Boolean(target && context.engine.project.layouts.length > i);
    },
    run: (context) => {
      const target = targetMulticam(context);
      const layout = context.engine.project.layouts[i];
      if (!target || !layout) return;
      switchToLayout(context.engine, target.element, layout.id);
    },
  });
}

defineAction({
  id: "multicam.create",
  label: "Create multicam from selected clips",
  category: "multicam",
  enabled: ({ engine }) =>
    engine.selection.elementIds.some((id) =>
      engine.project.tracks.some((t) => t.elements.some((e) => e.id === id && e.type === "video")),
    ),
  run: ({ engine, ui }) => {
    const videoIds = engine.selection.elementIds.filter((id) =>
      engine.project.tracks.some((t) => t.elements.some((e) => e.id === id && e.type === "video")),
    );
    try {
      engine.dispatch({ type: "createMulticam", elementIds: videoIds });
      ui.setMode("multicam");
    } catch {
      // Mixed/invalid selection: leave the project untouched.
    }
  },
});

// ---------------------------------------------------------------------------
// File (main menu): the document itself — new/open/save travel as JSON, media
// relinks by content hash (see project-file.ts); import shares the bin's path.
// ---------------------------------------------------------------------------

defineAction({
  id: "file.new",
  label: "New project",
  category: "file",
  icon: FileVideoIcon,
  run: ({ engine }) => {
    // Destructive for the autosaved session — the next snapshot replaces it.
    if (!window.confirm("Start a new project? The current project will be replaced.")) return;
    engine.loadProject(createProject());
    void clearSavedSession();
  },
});

defineAction({
  id: "file.open",
  label: "Open project file…",
  category: "file",
  shortcut: { key: "o", meta: true },
  icon: FolderOpenIcon,
  run: ({ engine }) => void openProjectFromFile(engine),
});

defineAction({
  id: "file.save",
  label: "Save project file…",
  category: "file",
  shortcut: { key: "s", meta: true, shift: true },
  icon: DownloadIcon,
  run: ({ engine }) => saveProjectToFile(engine.project),
});

defineAction({
  id: "file.export-otio",
  label: "Export OpenTimelineIO (.otio)…",
  category: "file",
  icon: DownloadIcon,
  enabled: ({ engine }) => engine.project.tracks.some((t) => t.elements.length > 0),
  run: ({ engine }) => {
    const blob = new Blob([toOtioJson(engine.project)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${engine.project.name || "project"}.otio`;
    anchor.click();
    URL.revokeObjectURL(url);
  },
});

defineAction({
  id: "file.import",
  label: "Import media…",
  category: "file",
  shortcut: { key: "i", meta: true },
  icon: UploadIcon,
  run: ({ engine }) =>
    void pickFiles("video/*,audio/*,image/*,.mkv").then(async (files) => {
      if (files.length === 0) return;
      const imported = await importMediaFiles(engine, files, (asset, file) =>
        void saveAssetBlob(asset, file),
      );
      if (imported.length > 0) {
        toast.success(`Imported ${imported.length} file${imported.length > 1 ? "s" : ""}`);
      }
    }),
});

// ---------------------------------------------------------------------------
// View extras (main menu)
// ---------------------------------------------------------------------------

defineAction({
  id: "view.toggle-theme",
  label: "Toggle light/dark theme",
  category: "view",
  icon: MoonIcon,
  run: ({ ui }) => ui.setTheme(ui.theme === "dark" ? "light" : "dark"),
});

defineAction({
  id: "view.fullscreen",
  label: "Fullscreen preview",
  category: "view",
  icon: MaximizeIcon,
  run: () => {
    document.querySelector("[data-mcut-player]")?.requestFullscreen?.().catch(() => {});
  },
});

defineAction({
  id: "view.reset-layout",
  label: "Reset panel layout",
  category: "view",
  run: () => requestEditorLayoutReset(),
});

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

defineAction({
  id: "help.shortcuts",
  label: "Keyboard shortcuts…",
  category: "help",
  shortcut: { key: "?", shift: true },
  icon: KeyboardIcon,
  run: () => {
    document.querySelector<HTMLButtonElement>("[data-mcut-shortcuts-trigger]")?.click();
  },
});

defineAction({
  id: "help.command-palette",
  label: "Command palette…",
  category: "help",
  palette: false, // it IS the palette
  run: () => window.dispatchEvent(new Event(COMMAND_PALETTE_OPEN_EVENT)),
});
