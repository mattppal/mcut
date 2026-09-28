---
"@mcut/timeline": patch
---

A zoom region moves as one motion about a fixed point. The scale follows the region's easing, and the framing moves in step with the shown window, so no edge of the picture reverses direction partway through the ease. Before, the framing moved on its own lerp and the picture drifted sideways while it scaled.
