---
"@mcut/cli": minor
---

Add `mcut clean-voice <in.wav> -o <out.wav> [--amount <0..1>]`, which removes background noise from speech in a 48 kHz WAV file with `@mcut/voice`. An `--amount` below 1 mixes the original audio back in. Audio at any other sample rate exits with an error that shows an ffmpeg command to resample it.
