# Selectors the flow uses

Every locator below is either a `data-mcut-*` attribute the editor exposes for tests or an accessible role and name. Source paths are relative to `apps/studio`. The `e2e/*.spec.ts` files are the Playwright specs that already rely on the locator; a `registry/mcut/*.tsx` path means the locator comes straight from the component because no spec uses it yet.

## Editor shell

| Element | Locator | Source |
| --- | --- | --- |
| Editor ready | `getByRole("button", { name: "Go to start" })` | `e2e/editor.spec.ts` |
| Session restore toast | `getByRole("button", { name: "Discard" })` | `e2e/helpers.ts` `openEditor` |
| Project name | `getByLabel("Project name")` on an `input` | `registry/mcut/editor-toolbar.tsx` |
| Left rail tabs | `[data-rail-tab="media"]`, `text`, `animate`, `captions`, with `aria-pressed` | `e2e/helpers.ts` `openLeftTab` |
| Export trigger | `[data-mcut-export-trigger]`, title `Export video` | `e2e/export.spec.ts` |

## Media panel

| Element | Locator | Source |
| --- | --- | --- |
| Hidden file input | `input[type="file"]`, accepts `video/*,audio/*,image/*,.mkv` | `e2e/helpers.ts` `importPng`, `e2e/export.spec.ts`, `e2e/mkv.spec.ts` |
| Import button | text `+ Import`, title `Import media` | `registry/mcut/media-bin.tsx` |
| Media card | `getByTitle("fixture-vp9.mkv")`, the `title` attribute starts with the file name | `e2e/export.spec.ts`, `e2e/mkv.spec.ts` |
| Duration badge | text `0:02` inside the card | `registry/mcut/media-bin.tsx` |
| Add at playhead | double-click the card, or hover it and click the button titled `Add at playhead` | `registry/mcut/media-bin.tsx` |
| Thumbnail loaded | `card.locator("img")` with `naturalWidth > 0` | `e2e/editor.spec.ts` |

## Timeline

| Element | Locator | Source |
| --- | --- | --- |
| Lane | `[data-mcut-lane]`, one per track | `e2e/helpers.ts` `dragAssetToLane`, `e2e/editor.spec.ts` |
| Clip | `[data-mcut-clip]`, video clips carry `data-mcut-clip="video"` | `e2e/helpers.ts` `clip`, `e2e/mkv.spec.ts` |
| Filmstrip canvas | `[data-mcut-clip=video] canvas`, sample pixels for a lit count | `e2e/mkv.spec.ts`, `e2e/editor.spec.ts` |
| Drop ghost | `[data-mcut-drop-ghost]` visible during a drag | `e2e/editor.spec.ts` |
| Ruler | `div.cursor-col-resize.bg-card`, pointer down and move scrubs | `e2e/mkv.spec.ts` |
| Timecode | `[data-mcut-timeline] .text-primary`, reads `m:ss.t` such as `0:03.0` | `e2e/tracks-playhead.spec.ts` |

## Preview and transport

| Element | Locator | Source |
| --- | --- | --- |
| Preview canvas | `[data-mcut-player] canvas`, the first canvas is the render target | `e2e/helpers.ts` `previewPixels` |
| Play and pause | `getByRole("button", { name: "Play", exact: true })`, then `Pause` | `e2e/playback.spec.ts`, `e2e/tracks-playhead.spec.ts` |
| Go to start | `getByRole("button", { name: "Go to start" })` | `e2e/editor.spec.ts`, `e2e/playback.spec.ts` |

## Export dialog

| Element | Locator | Source |
| --- | --- | --- |
| Dialog | `getByRole("dialog")` with text `Export video` | `registry/mcut/export-dialog.tsx` |
| Format buttons | `getByRole("button", { name: "WebM", exact: true })`, also `MP4` and `MKV` | `e2e/export.spec.ts` |
| Export button | `getByRole("button", { name: "Export WebM" })`, reads `Exporting…` while busy | `e2e/export.spec.ts` |
| Unsupported warning | text starting `This browser can't encode` | `registry/mcut/export-dialog.tsx` |
| Footer close | `getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last()` | `registry/mcut/export-dialog.tsx` |
| Export path | `window.__mcutLastExportMode === "worker"` after the download | `e2e/export.spec.ts` |

## Keyboard

| Key | Effect | Source |
| --- | --- | --- |
| `Shift+ArrowRight` | Playhead forward one second | `e2e/trim-view.spec.ts`, `e2e/playback.spec.ts` |
| `ArrowRight` | Playhead forward one frame | `e2e/trim-view.spec.ts` |
| `Space` | Play or pause | `e2e/mkv.spec.ts` |
| `End` | Playhead to the project end | `e2e/tracks-playhead.spec.ts` |
| `ArrowUp` and `ArrowDown` | Playhead to the previous or next clip edge | `e2e/tracks-playhead.spec.ts` |
| `ControlOrMeta+z` | Undo | `e2e/editor.spec.ts`, `e2e/clip-drag.spec.ts` |
| `Escape` | Deselect, or cancel a drag in flight | `e2e/clip-drag.spec.ts` |
