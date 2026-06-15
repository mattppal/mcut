---
title: MCP server
description: Expose mcut project state, editor operators, and command tools to MCP clients.
---

`@mcut/mcp-server` exposes mcut editing to any MCP client. It can target a local
project JSON file or a live browser editor tab.

## Stdio project server

```sh
bunx @mcut/mcp-server project.mcut.json
```

The project file defaults to `project.mcut.json` or `$MCUT_PROJECT`. The server
creates the file when missing and writes it after successful edits.

## Static tools

| Tool | Purpose |
| --- | --- |
| `get_summary` | Compact project summary. Read this before editing. |
| `get_project` | Full serializable project JSON. |
| `get_media_context` | Project, playback, selection, asset, track, element, marker, and transcript metadata. |
| `get_transcript` | Caption-derived transcript; never starts transcription. |
| `search_transcript` | Find spoken words or phrases with timeline times. |
| `ensure_transcript` | Live bridge only: transcribe selected media in the browser and apply captions. |
| `list_operators` | List available UI-level editor operators. |
| `list_actions` | Live bridge only: list browser editor actions. |
| `run_action` | Live bridge only: run a browser editor action by id. |
| `undo` | Undo the most recent edit. |
| `redo` | Redo the most recently undone edit. |

## Generated operator tools

Every registered editor operator becomes an MCP tool named:

```text
operator_<operator-id-with-non-tool-characters-replaced>
```

For example, `edit.splitSelectionAtPlayhead` becomes
`operator_edit_splitSelectionAtPlayhead`.

Prefer operator tools for UI-parity edits because they understand playback,
selection, and editor context.

## Generated command tools

Every registered timeline command also becomes an MCP tool. The command
description becomes the tool description and the zod payload schema becomes the
MCP input schema.

Use command tools for exact project mutations when you already know the target
ids and payload.
