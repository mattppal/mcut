---
title: CLI
description: Headless command-line tools for mcut project documents.
---

`@mcut/cli` operates on mcut project JSON files. It is for project document
workflows that can run outside the browser.

```sh
bunx @mcut/cli --help
```

## Commands

| Command | Purpose |
| --- | --- |
| `new` | Scaffold a project document from a platform preset. |
| `validate` | Parse and lint a project file. Use `--strict` to fail on warnings. |
| `summarize` | Print the compact text rendering of a project. |
| `apply` | Dispatch one command or a batch of JSON commands. |
| `captions` | Add caption elements from a transcript JSON file. |
| `silence-cuts` | Plan or apply transcript-driven silence removal. |
| `commands` | List command tools or print one command schema. |
| `presets` | List platform presets. |

## Common workflow

```sh
bunx @mcut/cli new project.mcut.json --preset youtube
bunx @mcut/cli validate project.mcut.json
bunx @mcut/cli summarize project.mcut.json
```

Apply a command batch from a file:

```sh
bunx @mcut/cli apply project.mcut.json commands.json
```

Preview a command batch without saving:

```sh
bunx @mcut/cli apply project.mcut.json commands.json --dry-run
```

## Command schemas

The CLI exposes the same command registry that the MCP server uses.

```sh
bunx @mcut/cli commands
bunx @mcut/cli commands --json
bunx @mcut/cli commands --name addElement
```

Use those schemas as the source of truth for low-level command payloads.
