import { host } from './studio-host'

const ORT_WASM_FILES = { mjs: 'ort-wasm-simd-threaded.asyncify.mjs', wasm: 'ort-wasm-simd-threaded.asyncify.wasm' }

export function ortWasmPaths(): { mjs: string; wasm: string } | null {
  if (host.windowChrome === 'browser') return null
  return {
    mjs: new URL(`/ort/${ORT_WASM_FILES.mjs}`, window.location.origin).href,
    wasm: new URL(`/ort/${ORT_WASM_FILES.wasm}`, window.location.origin).href,
  }
}
