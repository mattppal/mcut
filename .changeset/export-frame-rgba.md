---
"@mcut/media": patch
---

Export, the decoded preview for video without native playback, thumbnails, and filmstrips copy each decoded video frame to RGBA before they draw it, in browsers whose `VideoFrame.copyTo` accepts a `format`. A long export or MKV playback no longer leaves hundreds of megabytes of shared memory and about 80 open file descriptors in the Studio renderer.
