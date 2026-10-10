---
'@mcut/media': minor
---

`createLocalFaceDetector` bundles the 232 KB YuNet face model into its worker instead of downloading it from huggingface.co on first use, so center person works offline and behind a firewall. `FaceDetectorProgress` drops the `model` phase, since nothing downloads.
