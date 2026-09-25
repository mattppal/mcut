---
"@mcut/editor": minor
"@mcut/cli": patch
---

Timeline gestures clamp a multicam like a video clip, from its trim, speed, reverse, and source coverage. Create from selection passes selected audio clips as audio-only sources. Lint checks the angle cuts inside a multicam's window and every asset an element references, including multicam sources, so `mcut lint` reports a missing source asset. The `multicam-first-angle` and `angle-beyond-end` lint codes are removed, because cuts outside the window are expected after a split or a trim.
