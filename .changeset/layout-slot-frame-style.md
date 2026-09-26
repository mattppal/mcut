---
"@mcut/timeline": minor
"@mcut/compositor": minor
---

A layout slot takes the frame style of a video clip, with `crop`, `cornerRadius`, `stroke`, and `shadow`. The slot `focus` and the boolean `shadow` are removed, and the v1 to v2 migration turns `shadow: true` into the shadow it drew. The compositor draws video clips and layout slots through one framed media path, and a multicam's own crop and corner radius frame its composite.
