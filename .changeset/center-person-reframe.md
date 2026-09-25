---
'@mcut/timeline': minor
'@mcut/compositor': minor
'@mcut/editor': minor
---

Add center person reframing. A video or one multicam source can carry a reframe track of subject centers keyed by asset media time, so trims, splits, slips, and speed changes keep the framing on the subject. Adds the `setReframe` command, `getReframeCenter`, `centeredFocus`, and the `VisibleFraction` type that `centeredFocus` and `getSlotView` take. The compositor slides a video crop or a cover slot window onto the subject, and a zoom region narrows from that reframed window. Adds `planCenterPerson`, which turns face samples into a smoothed and simplified `setReframe` command. On a video whose crop matches the project aspect within 1%, the plan also carries an `updateElement` that scales the clip to fill the frame, and the `fill` option forces or disables that.
