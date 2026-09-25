---
"@mcut/media": patch
---

`renderProjectStill` copies each decoded video frame to RGBA before it draws it, in browsers whose `VideoFrame.copyTo` accepts a `format`. Repeated `get_frame` calls no longer grow the Studio renderer's shared memory and open file descriptors.
