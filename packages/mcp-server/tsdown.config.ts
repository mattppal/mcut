import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/live-cli.ts', 'src/bridge-cli.ts'],
  format: 'esm',
  dts: true,
  clean: true,
  fixedExtension: false,
  platform: 'node',
})
