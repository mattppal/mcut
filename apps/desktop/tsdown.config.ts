import { defineConfig, type UserConfig } from 'tsdown'

const shared: UserConfig = {
  platform: 'node',
  deps: { neverBundle: ['electron'], onlyBundle: false },
  fixedExtension: true,
  dts: false,
  sourcemap: true,
}

export default defineConfig([
  { ...shared, entry: { main: 'src/main.ts' }, format: 'esm', clean: true },
  { ...shared, entry: { preload: 'src/preload.ts' }, format: 'cjs', clean: false },
])
