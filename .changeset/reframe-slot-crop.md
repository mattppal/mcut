---
"@mcut/timeline": minor
"@mcut/compositor": minor
---

A reframe track on a multicam source slides the crop of every slot that shows the source onto the subject, so a tight face crop follows the face. Once the crop meets the frame edge, the part the slot's fit shows keeps moving toward the subject inside the crop. `getSlotView` takes a `rest` focus, the view outside a zoom and where a zoom starts, and the compositor passes the reframed focus there.
