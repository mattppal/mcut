---
"@mcut/media": patch
---

Export copies each decoded video frame to RGBA before it draws it, in browsers whose `VideoFrame.copyTo` accepts a `format`. A long export no longer leaves hundreds of megabytes of shared memory and about 80 open file descriptors in the Studio renderer.
