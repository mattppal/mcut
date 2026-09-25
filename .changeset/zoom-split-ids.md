---
'@mcut/timeline': patch
---

A split, insert edit, or overwrite edit through a zoom region now gives the right piece's copy the zoom id with `-r` appended, so the two pieces no longer share an id. `listZoomRegions` cuts each region's timeline `startMs` and `endMs` at its element's edges, and `summarizeProject` prints that start, so `list_zooms` and `get_summary` show the part of the zoom each piece plays.
