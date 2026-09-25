# Platform targets

Machine-readable copy of this table: `assets/platform-presets.json` (generated from
`@mcut/cli`'s `PLATFORM_PRESETS`, also `mcut presets --json`). Scaffold directly:
`mcut new project.json --preset tiktok`.

| Preset | Frame | fps | Safe area (top/bottom) | Notes |
| --- | --- | --- | --- | --- |
| `youtube` | 1920×1080 | 30 | 0% / 8% | scrubber covers the bottom edge on hover |
| `youtube-4k` | 3840×2160 | 30 | 0% / 8% | for screen-recording-heavy content |
| `shorts` | 1080×1920 | 30 | 10% / 25% | 60s or less favored |
| `tiktok` | 1080×1920 | 30 | 10% / 25% | hook in 1-2s, 21-34s sweet spot |
| `reels` | 1080×1920 | 30 | 10% / 25% | feed shows a center 4:5 crop |
| `square` | 1080×1080 | 30 | 0% / 10% | LinkedIn/X feed neutral |

Safe areas are fractions of frame height covered by platform chrome (usernames,
action rails, description bars). Keep captions, titles, and faces out of them. On
9:16 that means captions sit `position` `"middle"`.

## Reformatting an existing edit

The tested sequence is the vertical-reframe recipe. The shape:

1. `updateProject { width, height }`. Elements keep their pixel positions. The
   canvas changes around them.
2. Re-cover the frame. A W×H source in a W'×H' canvas needs
   `scale = max(W'/W, H'/H)` to cover (1920×1080 to 1080×1920 needs
   1920/1080 ≈ 1.78). Apply via `updateElement` patch on `transform`.
3. Reframe toward the subject. Transforms are center-origin, so nudge `transform.x`
   (or animate `position.x` keyframes to follow the action). At 1.78× on 9:16 you
   have about ±420px of horizontal slack. On the live bridge, run `center_person`
   with `aspect` 0.5625 instead of steps 2 and 3. The crop matches the 9:16 canvas,
   so it also scales the clip to cover the frame and centers it in the same undo
   step, and the crop follows the face.
4. Restyle text. Use bigger fonts because the frame is narrower, move captions to `middle`,
   and keep everything inside safe areas.
5. Re-check duration norms. Cut a 10-min YouTube edit to 60s or less for Shorts.
   Lead with the payoff, then `mcut silence-cuts` and jump-cuts to compress.

## Duration norms

- Shorts, TikTok, and Reels: hook in 2s or less, total 20-60s.
- YouTube long-form: whatever the content earns. Tighten dead air regardless.
- Square feed clips: 30-90s.

fps 30 is the default everywhere here. Match the dominant source footage (60 for
gameplay or screen capture when smoothness matters). Set it at project creation, because
`fps` quantizes export frame sampling.
