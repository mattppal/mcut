# Export

Export renders the project deterministically with WebCodecs. Every frame is
composited by the same `renderFrame()` the preview uses, at exact fps samples, with
audio mixed offline. Same input produces the same output.

## The constraint

**Export runs only in a browser** (OffscreenCanvas + VideoEncoder). Node or Bun
headless can build and edit projects but cannot render them.

On the live bridge, Studio is that browser. Call `export_video`, then call
`get_export` with `waitMs` set to `20000` until `state` is `done`. Studio
renders the timeline and uploads the file to the bridge, which writes it to the
`outputPath` the job reports.

Without the bridge, hand off:

1. Headless, MCP, or CLI editing produces a valid `project.json` (run `mcut validate`).
2. A browser context renders it. Use the mcut editor UI export dialog, or about 15 lines
   of code on any page:

```ts
import { exportProject } from '@mcut/media'
import { parseProject } from '@mcut/timeline'

const project = parseProject(await (await fetch('/project.json')).json())
const { blob } = await exportProject(project, {
  format: 'mp4',                        // 'mp4' | 'webm' | 'mkv'
  onProgress: ({ phase, progress }) => console.log(phase, progress), // progress is 0..1
  // videoBitrate: 8_000_000,           // bits/s. Omit for the quality preset
  // abortController.signal,
})
```

Asset `src` values must resolve in that browser. Object URLs from a reload are
dead. Re-bind files before exporting.

## Containers and codecs

| Format | Video | Audio | Use |
| --- | --- | --- | --- |
| `mp4` | H.264 (AVC) | AAC | default, plays everywhere |
| `webm` | VP9/VP8 | Opus | open stack, smaller at like quality |
| `mkv` | first encodable codec | Opus/AAC | archival or intermediate, container registry is extensible |

Codec selection is automatic per container (`getFirstEncodableVideoCodec`). Audio
mixes to 48kHz stereo.

## Bitrate guidance

Omit `videoBitrate` for the built-in quality preset. When pinning, 1080p30 talking
head is about 6-8 Mbps. 1080p screen recording with text is about 8-12 Mbps, or use `youtube-4k`
and let resolution carry the text. 9:16 1080×1920 social is about 6-10 Mbps. Platforms
recompress anyway, so do not starve them.

## Performance notes

- Cost scales with frames times resolution. Motion blur multiplies compositor work
  (sub-frame sampling). Use it on short moments, not whole clips.
- Export decodes every frame in order (no seeking), so long timelines are linear
  time. `signal` (AbortSignal) cancels cleanly.

## Subtitle sidecars

Burned-in captions render as part of the frame. For platform caption files, also
write `toSrt`/`toVtt` output next to the video (see captions.md).
