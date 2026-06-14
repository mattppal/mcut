import { defineConfig } from 'tsdown'

export default defineConfig({
  // export-worker is its own entry: the client spawns it via
  // `new Worker(new URL('./export-worker.js', import.meta.url))`, which app
  // bundlers detect statically and bundle as a worker entry.
  entry: ['src/index.ts', 'src/export-worker.ts'],
  format: 'esm',
  dts: true,
  clean: true,
  fixedExtension: false,
})
