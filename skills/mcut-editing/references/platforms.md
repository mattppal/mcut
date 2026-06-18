# Platform targets

Machine-readable copy of this table: `assets/platform-presets.json` (generated from
`@mcut/cli`'s `PLATFORM_PRESETS`; also `mcut presets --json`). Scaffold directly:
`mcut new project.json --preset tiktok`.

| Preset | Frame | fps | Safe area (top/bottom) | Notes |
| --- | --- | --- | --- | --- |
| `youtube` | 1920×1080 | 30 | 0% / 8% | scrubber covers the bottom edge on hover |
| `youtube-4k` | 3840×2160 | 30 | 0% / 8% | for screen-recording-heavy content |
| `shorts` | 1080×1920 | 30 | 10% / 25% | ≤60s favored |
| `tiktok` | 1080×1920 | 30 | 10% / 25% | hook in 1–2s; 21–34s sweet spot |
| `reels` | 1080×1920 | 30 | 10% / 25% | feed shows a center 4:5 crop |
| `square` | 1080×1080 | 30 | 0% / 10% | LinkedIn/X feed neutral |

Safe areas are fractions of frame height covered by platform chrome (usernames,
action rails, description bars). Keep captions, titles, and faces out of them — on
9:16 that means captions sit `position: "middle"`.

## Reformatting an existing edit

The tested sequence is recipes: vertical-reframe. The shape:

1. `updateProject { width, height }` — elements keep their pixel positions; the
   canvas changes around them.
2. Re-cover the frame: a W×H source in a W'×H' canvas needs
   `scale = max(W'/W, H'/H)` to cover (1920×1080 → 1080×1920 needs
   1920/1080 ≈ 1.78). Apply via `updateElement` patch on `transform`.
3. Reframe toward the subject: transforms are center-origin, so nudge `transform.x`
   (or animate `position.x` keyframes to follow the action — at 1.78× on 9:16 you
   have ±~420px of horizontal slack).
4. Restyle text: bigger fonts (the frame is narrower), captions to `middle`,
   everything inside safe areas.
5. Re-check duration norms (cut a 10-min YouTube edit to ≤60s for Shorts — lead
   with the payoff, then `mcut silence-cuts` and jump-cuts to compress).

## Duration norms

- Shorts/TikTok/Reels: hook ≤2s, total 20–60s.
- YouTube long-form: whatever the content earns; tighten dead air regardless.
- Square feed clips: 30–90s.

fps: 30 is the default everywhere here; match the dominant source footage (60 for
gameplay/screen capture when smoothness matters — set it at project creation, since
`fps` quantizes export frame sampling).
