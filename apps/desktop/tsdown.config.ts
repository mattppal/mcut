import { defineConfig, type UserConfig } from 'tsdown'

const shared: UserConfig = {
  platform: 'node',
  external: ['electron'],
  fixedExtension: true,
  dts: false,
}

export default defineConfig([
  { ...shared, entry: { main: 'src/main.ts' }, format: 'esm', clean: true },
  { ...shared, entry: { preload: 'src/preload.ts' }, format: 'cjs', clean: false },
])
