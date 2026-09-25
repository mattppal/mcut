# @mcut/voice

DeepFilterNet3 voice cleanup for mcut.

```sh
bun add @mcut/voice
```

This package removes background noise from speech with the DeepFilterNet3
model compiled to WebAssembly. `cleanVoice` takes mono 48 kHz samples and
splits them into one chunk per worker. Each worker starts one second before its
chunk so the model state has settled by the first sample it keeps, and a 10 ms
crossfade joins the cleaned chunks. The output lines up with the input sample
for sample, so `mixVoice` blends the two without comb filtering.

## Entry points

| Import | Use it for |
| --- | --- |
| `@mcut/voice` | `planChunks`, `mixVoice`, `encodeWav`, `decodeWav`, and `cleanVoice` over a worker `spawn` function and a compiled `wasm` module that you supply. |
| `@mcut/voice/browser` | `cleanVoice` on module Web Workers. The pool defaults to one fewer worker than `navigator.hardwareConcurrency`, at most 4. |
| `@mcut/voice/node` | `cleanVoice` on `worker_threads`. The pool defaults to one fewer worker than `availableParallelism()`, at most 4. |

`VOICE_MODEL` names the model and its thresholds. Put it in the key of any
cache of cleaned audio.

## Clean a WAV file

```ts
import { readFile, writeFile } from 'node:fs/promises'
import { VOICE_SAMPLE_RATE, cleanVoice, decodeWav, encodeWav, mixVoice } from '@mcut/voice/node'

const { samples, sampleRate } = decodeWav(await readFile('speech.wav'))
if (sampleRate !== VOICE_SAMPLE_RATE) throw new Error(`expected 48 kHz audio, got ${sampleRate} Hz`)
const cleaned = await cleanVoice(samples, { onProgress: ({ done, total }) => process.stdout.write(`\r${done} of ${total}`) })
await writeFile('clean.wav', encodeWav(mixVoice(samples, cleaned, 0.8), VOICE_SAMPLE_RATE))
```

## Rebuild the WASM

`bun run build:wasm` needs git, Rust with the `wasm32-unknown-unknown` target,
and `wasm-pack`. It checks out DeepFilterNet at a pinned commit, applies
`wasm/deepfilternet.patch`, builds against `wasm/Cargo.lock`, and rewrites
`wasm/df_bg.wasm` and `wasm/df.js`. The patch sets the thresholds the native
`deep-filter` CLI uses and adds calls that create the compiled-in model and
process many frames at once. `scripts/vendor-glue.ts` then drops the async
loader from the wasm-bindgen glue and renames its `module` identifiers.
Turbopack reports the bundled worker as CommonJS if the glue contains a
`module` identifier.

`bun run fixtures <path to deep-filter>` regenerates the parity fixtures in
`test/fixtures` from the native CLI.
