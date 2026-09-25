import { readFile, writeFile } from 'node:fs/promises'
import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    // export-worker is its own entry: the client spawns it via
    // `new Worker(new URL('./export-worker.js', import.meta.url))`, which app
    // bundlers detect statically and bundle as a worker entry.
    entry: ['src/index.ts', 'src/export-worker.ts'],
    format: 'esm',
    dts: true,
    clean: true,
    fixedExtension: false,
  },
  {
    entry: ['src/face-detector-worker.ts'],
    format: 'esm',
    platform: 'browser',
    dts: false,
    clean: false,
    fixedExtension: false,
    noExternal: /.*/,
    outputOptions: { inlineDynamicImports: true },
    onSuccess: async () => {
      const path = new URL('./dist/face-detector-worker.js', import.meta.url)
      const source = await readFile(path, 'utf8')
      await writeFile(
        path,
        source.replaceAll(
          /new ([A-Za-z_$][\w$]*)\(("[^"]+\.(?:wasm|mjs)"),\s*(?:import\.meta\.url|String\(import\.meta\.url\))(?:,\s*String\(import\.meta\.url\))*\)/g,
          'new $1($2, String(import.meta.url))',
        ),
      )
    },
  },
])
