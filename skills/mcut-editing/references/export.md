# Export

Export renders the project deterministically with WebCodecs: every frame is
composited by the same `renderFrame()` the preview uses, at exact fps samples, with
audio mixed offline. Same input → same output.

## The constraint

**Export runs only in a browser** (OffscreenCanvas + VideoEncoder). Node/Bun
headless can build and edit projects but cannot render them. The hand-off:

1. Headless/MCP/CLI editing produces a valid `project.json` (run `mcut validate`).
2. A browser context renders it — the mcut editor UI's export dialog, or ~15 lines
   of code on any page:

```ts
import { exportProject } from '@mcut/media'
import { parseProject } from '@mcut/timeline'

const project = parseProject(await (await fetch('/project.json')).json())
const blob = await exportProject(project, {
  format: 'mp4',                        // 'mp4' | 'webm' | 'mkv'
  onProgress: (p) => console.log(p),    // 0..1
  // videoBitrate: 8_000_000,           // bits/s; omit for the quality preset
  // signal: abortController.signal,
})
```

Asset `src` values must resolve in that browser (object URLs from a reload are
dead — re-bind files before exporting).

## Containers & codecs

| Format | Video | Audio | Use |
| --- | --- | --- | --- |
| `mp4` | H.264 (AVC) | AAC | default; plays everywhere |
| `webm` | VP9/VP8 | Opus | open stack, smaller at like quality |
| `mkv` | first encodable codec | Opus/AAC | archival/intermediate; container registry is extensible |

Codec selection is automatic per container (`getFirstEncodableVideoCodec`); audio
mixes to 48kHz stereo.

## Bitrate guidance

Omit `videoBitrate` for the built-in quality preset. When pinning: 1080p30 talking
head ~6–8 Mbps; 1080p screen recording with text ~8–12 Mbps (or use `youtube-4k`
and let resolution carry the text); 9:16 1080×1920 social ~6–10 Mbps (platforms
recompress anyway — don't starve them).

## Performance notes

- Cost scales with frames × resolution; motion blur multiplies compositor work
  (sub-frame sampling) — use it on short moments, not whole clips.
- Export decodes every frame in order (no seeking), so long timelines are linear
  time. `signal` (AbortSignal) cancels cleanly.

## Subtitle sidecars

Burned-in captions render as part of the frame. For platform caption files, also
write `toSrt`/`toVtt` output next to the video (see captions.md).
