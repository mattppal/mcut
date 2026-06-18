---
name: mcut
description: Build a browser-based video editor with the mcut SDK — multi-track timeline, auto-captions, and deterministic client-side MP4/WebM/MKV export. Use when integrating video editing into a React or Next.js app, installing the mcut editor UI from the shadcn registry, scripting edits through serializable commands, or wiring a transcription provider.
license: Apache-2.0
metadata:
  source: https://github.com/mattppal/mcut
---

# mcut: extensible React video editor SDK

mcut splits along one seam: a headless engine published to npm, and an editor UI
installed **as source** through a shadcn registry hosted on this site. The engine is
yours to depend on; the UI is yours to modify.

## Install

```sh
# 1. Engine packages (headless, framework-agnostic core)
bun add @mcut/timeline @mcut/compositor @mcut/media @mcut/react @mcut/transcription

# 2. Editor UI as source, into a Next.js + shadcn app (registry hosted at this origin)
bunx shadcn@latest add <this-origin>/r/editor-shell.json

# 3. Optional server-side transcription provider
bun add @mcut/transcription-assemblyai
```

The registry index lives at `/r/registry.json` on this origin. Besides the full
`editor-shell`, individual panels install standalone: `timeline-panel`, `toolbar`,
`media-bin`, `properties-panel`, `captions-panel`, `export-dialog`.

## Architecture

| Package | What it is |
| --- | --- |
| `@mcut/timeline` | Headless domain: project model, zod-validated serializable commands, undo/redo, reactive stores |
| `@mcut/compositor` | Pure canvas2d `renderFrame()` + element renderer registry + hit-testing — shared by preview and export |
| `@mcut/media` | Mediabunny I/O: probing, thumbnails, audio extraction, deterministic WebCodecs export (MP4/WebM/MKV) |
| `@mcut/transcription` | Provider interface, normalized transcripts, SRT/VTT, caption grouping |
| `@mcut/transcription-assemblyai` | AssemblyAI provider with word timings, confidence, speakers |
| `@mcut/transcription-ai-sdk` | Adapter for any Vercel AI SDK transcription model (OpenAI, Deepgram, Groq, ...) |
| `@mcut/react` | `EditorProvider`, hooks, `PlayerCanvas` with selection/drag/resize/rotate overlay |
| `@mcut/cli` | `mcut` on the command line: scaffold, validate, summarize, batch-edit, silence cuts, captions |
| `@mcut/mcp-server` | `bunx -p @mcut/mcp-server mcut-mcp project.json` — every command and operator as an MCP tool |

Everything runs client-side except transcription, which you proxy through your own
server route so provider API keys stay server-side.

## Scripting edits (AI tools)

Every edit — trim, split, move, caption, keyframe — is a serializable, zod-validated
command applied through one entry point:

```ts
engine.dispatch({ type: "splitClip", clipId, atMs });
```

Each command's zod schema doubles as an AI tool definition, so an agent can drive the
whole editor by emitting commands. Undo/redo wraps dispatch automatically.

The full catalog — every command as an MCP-shaped tool definition with JSON Schema
parameters — comes from `listToolDefinitions()` in `@mcut/timeline`. This origin serves
it at `/tools.json` (human-readable at `/tools`).

## Wiring transcription

The editor UI takes a `transcribe(audio: Blob) => Promise<TranscriptResult>` handler.
Implement it as a server route that forwards to a provider:

```ts
// app/api/transcribe/route.ts
import { createAssemblyAIProvider } from "@mcut/transcription-assemblyai";

export async function POST(request: Request) {
  const audio = (await request.formData()).get("audio") as Blob;
  const provider = createAssemblyAIProvider(); // reads ASSEMBLYAI_API_KEY
  return Response.json(await provider.transcribe({ audio, mimeType: audio.type }));
}
```

`TranscriptResult` is the normalized transcript shape every provider returns: full
`text` plus word-level (`words`) and sentence-level (`segments`) timings in
milliseconds, with optional `confidence` and `speaker` per word.

## Editing videos with an agent

This skill covers integration. To actually EDIT video — cuts, silence removal,
captions, multicam switching, animation, platform reformatting — fetch the companion
skill at `../mcut-editing/SKILL.md` on this origin: it ships a tested recipe book,
the full command reference, starter project templates, and platform presets.
