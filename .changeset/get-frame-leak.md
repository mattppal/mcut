---
"@mcut/media": patch
---

`renderProjectStill` copies each decoded video frame to RGBA before it draws the frame. Repeated `get_frame` calls no longer leave a decoded frame of shared memory and a file descriptor behind in the Studio renderer.
