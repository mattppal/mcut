import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/browser.ts', 'src/node.ts', 'src/node-worker.ts'],
    format: 'esm',
    dts: true,
    clean: true,
    fixedExtension: false,
  },
  {
    entry: ['src/browser-worker.ts'],
    format: 'esm',
    platform: 'browser',
    dts: false,
    clean: false,
    fixedExtension: false,
    noExternal: /.*/,
  },
])
