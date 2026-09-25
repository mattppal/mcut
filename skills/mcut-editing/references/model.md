# The project model

A project is one JSON document. It is the serializable source of truth the engine, the
UI, the CLI, and the exporter all share. Load untrusted JSON with `parseProject`.
That call validates and migrates older documents.

```
Project
├── id, name, width, height, fps
├── tracks: Track[]            // paint order, index 0 is bottom, last is on top
│   ├── id ("t-…"), name
│   ├── muted, hidden, locked, magnetic
│   └── elements: TimelineElement[]   // sorted by startMs, never overlapping
├── assets: Record<"a-…", AssetRef>   // src, kind, durationMs?, width?, height?
└── layouts: Layout[]                 // multicam compositions ("lay-…")
```

## Elements

All elements share `id ("e-…")`, `type`, `startMs`, `durationMs`, optional
`keyframes`, optional `linkId` (co-selection pairing, for example video plus detached audio).

| Type | Key fields | Animatable properties |
| --- | --- | --- |
| `video` | `assetId`, `trimStartMs`, `timeMap?`, `transform`, `opacity`, `volume`, `muted`, `effects?`, `blendMode?`, `motionBlur?`, `transition?` | position.x/y, scale.x/y, rotation, opacity, blur, volume |
| `audio` | `assetId`, `trimStartMs`, `timeMap?`, `volume`, `muted` | volume |
| `image` | `assetId`, `transform`, `opacity`, `effects?`, `blendMode?`, `motionBlur?`, `transition?` | position.x/y, scale.x/y, rotation, opacity, blur |
| `text` | `text`, `style`, `box?`, `transform`, `opacity`, `effects?`, `blendMode?`, `motionBlur?`, `transition?` | position.x/y, scale.x/y, rotation, opacity, blur |
| `caption` | `text`, `words?` (karaoke timings), `style` (position top, middle, or bottom) | none |
| `multicam` | `sources` (`key`, `assetId`, `offsetMs`), `angles` (`atMs`, `layoutId`), `angleTransition?`, `audioSource?`, plus the video fields except `assetId` | like video |

`addElement` fills defaults (`transform` centered at scale
1, `opacity` 1, `volume` 1, `trimStartMs` 0). Omit `element.id` to have one
generated. Pass explicit ids when later commands must reference the element.

## The three clocks

1. **Timeline time.** `startMs`, `splitElement.atMs`, project duration.
2. **Element-local time.** keyframe `timeMs`, timeMap input, zoom region `atMs`.
   Zero is the clip's first visible frame. Moving a clip moves its animation
   with it. Splitting redistributes keyframes and zoom regions per side.
3. **Source time.** `trimStartMs` is the in-point into the asset. Transcripts speak
   source time. A multicam's sources share one source clock. Its `trimStartMs` and
   angle-cut `atMs` are on that clock, and each source plays its media at its
   `offsetMs` plus the clock time.

Conversion at 1x is `timelineMs = element.startMs + (sourceMs - element.trimStartMs)`.
A `timeMap` breaks the 1:1 relation. It maps element-local output ms to source ms
(relative to `trimStartMs`), monotone non-decreasing, with at least 2 points. A flat segment is a
freeze. Eased value changes are speed ramps. `setElementSpeed` writes a constant map.

## Transform and compositing

`transform` is center-origin: `x`/`y` offset in project pixels, `scaleX`/`scaleY`
(negative flips, zero rejected), `rotation` in degrees clockwise. `effects` is an
ordered filter stack (blur, brightness, contrast, saturate, grayscale, sepia,
hue-rotate, invert, drop-shadow, css). `blendMode` sets the compositing operation.
`motionBlur` (`shutterAngle` 180 for a film look, 360 maximal) smears keyframed motion.

### Scale, crop, and canvas size

Do not infer visual size from the scale value alone. Scale multiplies the media's
natural asset size (or cropped natural size) into project canvas pixels:

```
displayWidth = asset.width * crop.w * abs(transform.scaleX)
displayHeight = asset.height * crop.h * abs(transform.scaleY)
```

Examples in a 1920x1080 project:

- 3840x2160 video at scale 0.5 displays 1920x1080. It fills the canvas.
- 1920x1080 video at scale 1 displays 1920x1080. It also fills the canvas.
- 3840x2160 video at scale 1 displays 3840x2160 and is zoomed/cropped by the canvas.

When the user asks for a relative edit like "make it 20% bigger" or "zoom in 2x",
multiply the current scale (`scale *= 1.2`, `scale *= 2`). When the user asks for
an absolute fit, compute scale from asset and project dimensions:

```
containScale = min(project.width / naturalWidth, project.height / naturalHeight)
coverScale = max(project.width / naturalWidth, project.height / naturalHeight)
```

`crop` is source-space and normalized 0..1 of the asset. Cropping `{ x, y, w, h }`
keeps that fraction of the source and the kept region becomes the element's
natural frame before scale is applied. For a 3840x2160 asset, `crop.w = 0.5`
means the kept frame is 1920px wide. Keeping the same on-canvas width requires
doubling `scaleX`.

## Keyframes

`keyframes` is per-property arrays of `{ timeMs, value, easing? }`. The first
keyframe **arms** the property. Once armed, the static field (for example `opacity`) is
ignored and the curve rules. Removing the last keyframe disarms. `easing` shapes the
segment toward the next keyframe: `linear`, `hold` (step), `easeIn`, `easeOut`,
`easeInOut`, or `{ cubicBezier: [x1, y1, x2, y2] }`.

## Transitions

`transition: { type, durationMs }` on the left element of two exactly-adjacent clips
on one track. Types: `dissolve`, `fade-black`, `fade-white`, `slide-left`,
`slide-right`, `wipe-left`, `wipe-right`. Duration 100-5000ms, window centered on
the cut, clamped to both clip durations. `setTransition` throws without a butt cut.

## History

Every dispatch is one undo step unless wrapped. `engine.transact(fn)` coalesces a
batch. `beginTransaction`/`endTransaction` span async gestures.
`cancelTransaction` aborts. `undo`/`redo` are MCP tools too.

## Persistence

`engine.toJSON()` to JSON to `parseProject` round-trips losslessly. Asset `src` is a
runtime binding. Object URLs die on reload. Persistence layers re-resolve srcs.
`hash` identifies content.
