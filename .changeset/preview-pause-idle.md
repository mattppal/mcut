---
"@mcut/media": patch
"@mcut/react": patch
---

A paused preview playhead follows the sound still playing out after a pause and comes to rest at the middle of the pause fade, so a play from pause starts on the frame last shown with no jump and no skipped frames. The preview `AudioContext` suspends two seconds after the pause fade has been heard, so an idle paused editor stops spending CPU on audio. Preview sound anchors on the frame that schedules its voices, so a slow frame no longer trims the start of a play. A paused preview picture seeks to the playhead when it sits more than 5 ms away.
