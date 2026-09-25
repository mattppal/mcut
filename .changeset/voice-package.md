---
"@mcut/voice": minor
---

New package. `cleanVoice` removes background noise from mono 48 kHz speech with DeepFilterNet3 compiled to WebAssembly and the thresholds of the native `deep-filter` CLI. It splits the audio across a pool of workers. `@mcut/voice/browser` runs the pool on Web Workers and `@mcut/voice/node` runs it on `worker_threads`. `mixVoice` blends the original audio back in, `encodeWav` writes a 16-bit PCM mono WAV, and `decodeWav` reads a 16-bit PCM or 32-bit float WAV and downmixes it to mono. `VOICE_MODEL` names the model and its thresholds for cache keys.
