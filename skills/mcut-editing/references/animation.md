# Animation

Two layers: raw keyframes (full control) and presets that EXPAND into editable
keyframes (fast, tasteful defaults). Presets are not opaque — after applying one you
can retime, re-ease, or delete individual keyframes.

## Raw keyframes

`setKeyframe { elementId, property, timeMs, value, easing? }` — element-local time.
Properties: `position.x`, `position.y` (project px, center-origin), `scale.x`,
`scale.y` (multiplier), `rotation` (degrees), `opacity` (0–1), `blur` (px),
`volume` (0–2; video and audio only).

- First keyframe arms the property (stopwatch on): the static field stops mattering.
- `easing` shapes the curve toward the NEXT keyframe: `linear`, `hold` (step),
  `easeIn`, `easeOut`, `easeInOut`, or `{ "cubicBezier": [x1, y1, x2, y2] }`.
- Maintenance: `moveKeyframe`, `setKeyframeEasing`, `removeKeyframe`,
  `clearKeyframes` (one property or all).

Pro bezier values worth stealing (the `EASINGS` vocabulary): `[0.16, 1, 0.3, 1]`
outExpo hero entrances; `[0.22, 1, 0.36, 1]` outQuint smooth settles;
`[0.34, 1.56, 0.64, 1]` outBack ~10% overshoot "pop"; `[0.32, 0, 0.67, 0]` inCubic
accelerating exits.

## Presets

`applyAnimationPreset { elementId, preset, options? }` with
`options: { durationMs?, direction? (up|down|left|right), intensity? (0.1–4) }`.

| Category | Presets | Notes |
| --- | --- | --- |
| In | `fade-in`, `slide-in`, `pop-in`, `scale-in`, `zoom-in`, `whip-in`, `blur-in` | animate the first ~300–450ms |
| Out | `fade-out`, `slide-out`, `pop-out`, `zoom-out`, `whip-out`, `blur-out` | animate the last stretch, landing at the clip end |
| Emphasis | `ken-burns`, `punch-zoom`, `pulse`, `breathe`, `float`, `sway`, `shake` | span the whole clip |

Presets MERGE into existing keyframes (upsert), so `pop-in` + `fade-out` compose on
one element. Fast presets (`whip-*`, `punch-zoom`) auto-enable motion blur unless
you've set one. Defaults: slide-out exits down, whips travel left; everything else
enters/exits upward.

Choosing: text/titles → `pop-in` + `fade-out`; photos → `ken-burns`; B-roll energy →
`whip-in` between beats; subtle life on static shots → `breathe` or `float`. One in
+ one out per element; emphasis sparingly.

## Zoom presets

`applyZoomPreset { elementId, preset, atMs, durationMs? }` applies a saved RELATIVE
pattern (scale multipliers + position deltas) at an element-local time — the
"punch-in at this moment" tool when you have a preset object (see `ZOOM_PRESETS` in
`@mcut/timeline`, or capture one from existing keyframes with `captureZoomPreset`).
Existing keyframes inside the window are replaced. For a one-off, two `setKeyframe`
pairs are just as quick (recipes: punch-in).

## Motion blur

`setMotionBlur { elementId, motionBlur: { enabled, shutterAngle } | null }` —
shutterAngle 180 reads as film, 360 maximal smear. Only affects keyframed transform
motion (it sub-frame samples the transform), so it costs export time; use on whips,
punches, shakes.

## Volume automation

`volume` keyframes duck music under speech: keyframe 0.8 → 0.2 over ~200ms at
speech start, back up after. On `detachAudio`, volume keyframes move to the audio
element.
