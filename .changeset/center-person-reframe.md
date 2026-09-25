---
'@mcut/timeline': minor
'@mcut/compositor': minor
'@mcut/editor': minor
---

Add center person reframing. A video or one multicam source can carry a reframe track of subject centers keyed by asset media time, so trims, splits, slips, and speed changes keep the framing on the subject. Adds the `setReframe` command, `getReframeCenter` and `centeredFocus`, compositor rendering that slides a video crop or a cover slot window onto the subject, and `planCenterPerson`, which turns face samples into one smoothed and simplified `setReframe` command.
