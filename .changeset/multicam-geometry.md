---
"@mcut/compositor": minor
---

`getElementNaturalSize` and `getElementDisplaySize` take the project first, the way `getElementOBB` does. A multicam's natural size is the project frame reduced to its crop, and `getElementOBB` returns that box under the multicam's transform. The player hit tests, selects, and resizes a multicam the way it does a clip, and the frame size fields of an editor can show it.
