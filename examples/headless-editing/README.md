# headless-editing

The mcut engine with no browser: build a two-track composition through the
serializable command API, undo/redo it, apply word-timed captions from a
transcript, write SRT/VTT, and round-trip the project through JSON.

```sh
bun install        # once, from the repo root
bun run build      # once, builds the @mcut/* packages

cd examples/headless-editing
bun start
```

Outputs land in `out/` (`project.json`, `captions.srt`, `captions.vtt`).

Everything the script dispatches is exactly what the editor UI calls under
the hood — and because every command is zod-validated data, the same calls
can come from an AI agent. For the full visual editor, run `bun dev` from
the repo root and open <http://localhost:3000/editor>.
