---
"@mcut/timeline": minor
---

A multicam is a media clip. It shares `trimStartMs`, `timeMap`, `reversed`, volume, mute, and fades with video and audio elements, so trims, splits, slips, speed changes, reverse, `detachAudio`, `removeAsset`, and motion blur presets treat it like a video clip. Each source carries `offsetMs`, its media time at source clock 0. Angle cuts sit on that source clock, so a cut stays on the same content through every window edit.

Breaking changes follow. `createMulticam` takes `sources: [{ elementId, key? }]` and an optional `audioSource`, accepts audio elements as audio-only sources, and syncs the sources as placed on the timeline. `setMulticamSourceTrim` is now `setMulticamSourceOffset { sourceKey, offsetMs }`. `angles[].atMs` and every angle command time are on the source clock. `PROJECT_VERSION` is 2, and `parseProject` migrates v1 documents. `splitAngles`, `getMulticamAudioSource`, and `ElementAudioSourceType` are removed, and `ElementAudioSource` drops `elementType` and `multicamSourceKey`. The media context reports multicam source `offsetMs` and counts only the angle spans a clip plays.

New exports are `MediaClip`, `isMediaClip`, `getMediaSourceDurationMs`, `getElementAssetIds`, `getMulticamGroupTimeMs`, `getVisibleAngleCuts`, `isAudioOnlySource`, and `getLocalTimeMs`.
