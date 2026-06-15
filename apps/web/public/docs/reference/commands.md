---
title: Commands
description: Serializable, zod-validated project mutations in @mcut/timeline.
---

Commands are the only way mcut project state changes. They live in
`@mcut/timeline` and are designed to be serializable, undoable, and safe to expose
as tools.

## Command shape

Every command is an object with a `type` plus command-specific payload fields.

```json
{
  "type": "addTrack",
  "name": "Overlays"
}
```

The engine validates payloads with zod and rejects edits that violate project
invariants such as unknown ids, invalid element shapes, or track overlaps.

## Registry

The command registry exposes:

- `listCommands()` for command definitions.
- `listToolDefinitions()` for MCP-shaped tool definitions.
- `applyCommand(project, command)` for pure command application.
- `EditorEngine.dispatch(command)` for engine-managed application with undo state.

## Inspect schemas

Use the CLI to inspect the current command set:

```sh
bunx @mcut/cli commands --json
bunx @mcut/cli commands --name addElement
```

Agents should inspect schemas instead of guessing payloads.

## Major command groups

| Group | Examples |
| --- | --- |
| Project and tracks | `updateProject`, `addTrack`, `removeTrack`, `renameTrack`, `updateTrack`, `moveTrack`, `compactTrack`, `compactTimeline` |
| Assets | `addAsset`, `updateAsset`, `removeAsset` |
| Elements | `addElement`, `removeElement`, `updateElement`, `moveElement`, `splitElement`, `rippleDelete` |
| Captions | `addCaptions`, caption style and transcript-related commands |
| Keyframes | `setKeyframe`, `removeKeyframe`, `moveKeyframe` |
| Effects and presets | effect stack commands, animation presets, zoom presets, property presets |
| Multicam | multicam creation, layout, cut, and source-selection commands |
| Audio and markers | linked audio helpers, timeline marker add/update/remove commands |

## Agent guidance

Use commands when the desired mutation is exact. Use operators when the desired
edit depends on current selection, playhead, track context, or UI behavior.
