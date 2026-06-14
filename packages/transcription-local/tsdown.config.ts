import { readFile, writeFile } from 'node:fs/promises'
import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: 'esm',
    dts: true,
    clean: true,
    fixedExtension: false,
  },
  {
    // Self-contained worker (same pattern as @mcut/media's export worker):
    // app bundlers copy `new URL('./whisper-worker.js', import.meta.url)`
    // targets verbatim as static assets without following imports, so the
    // worker bundles Transformers.js into itself. ONNX runtime WASM and the
    // model weights still stream from their CDNs at runtime.
    entry: ['src/whisper-worker.ts'],
    format: 'esm',
    platform: 'browser',
    dts: false,
    clean: false,
    fixedExtension: false,
    noExternal: /.*/,
    outputOptions: { inlineDynamicImports: true },
    onSuccess: async () => {
      // The bundled onnxruntime carries `new URL("ort-*.wasm", import.meta.url)`
      // fallbacks that never run in browsers (transformers.js defaults
      // wasmPaths to the onnxruntime CDN) — but app bundlers statically
      // resolving the worker asset fail on them. Hide the literals from
      // static analysis; runtime semantics are unchanged.
      const path = new URL('./dist/whisper-worker.js', import.meta.url)
      const source = await readFile(path, 'utf8')
      const sanitized = source
        .replaceAll(
          'typeof window !== "undefined" && typeof window.document !== "undefined"',
          'typeof globalThis.window !== "undefined" && typeof globalThis.window.document !== "undefined"',
        )
        .replaceAll(
          "typeof window !== 'undefined' && typeof window.document !== 'undefined'",
          "typeof globalThis.window !== 'undefined' && typeof globalThis.window.document !== 'undefined'",
        )
      await writeFile(
        path,
        sanitized.replaceAll(
          // Covers `new URL(...)` and minifier-aliased constructors (`new t(...)`).
          // Wrapping the base breaks the `new URL(<literal>, import.meta.url)`
          // shape bundlers treat as an asset reference; String() is identity.
          /new ([A-Za-z_$][\w$]*)\(("[^"]+\.(?:wasm|mjs)"),\s*(?:import\.meta\.url|String\(import\.meta\.url\))(?:,\s*String\(import\.meta\.url\))*\)/g,
          'new $1($2, String(import.meta.url))',
        ),
      )
    },
  },
])
