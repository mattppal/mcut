export function df_create_default(atten_lim: number): number
export function df_get_delay(st: number): number
export function df_process_frames(st: number, input: Float32Array): Float32Array
export function df_create(model_bytes: Uint8Array, atten_lim: number): number
export function df_get_frame_length(st: number): number
export function df_set_atten_lim(st: number, lim_db: number): void
export function df_set_post_filter_beta(st: number, beta: number): void
export function df_process_frame(st: number, input: Float32Array): Float32Array
export class DFState {
  free(): void
}
export interface InitOutput {
  readonly memory: WebAssembly.Memory
  readonly __wbg_dfstate_free: (a: number) => void
  readonly df_create: (a: number, b: number, c: number) => number
  readonly df_create_default: (a: number) => number
  readonly df_get_delay: (a: number) => number
  readonly df_get_frame_length: (a: number) => number
  readonly df_process_frame: (a: number, b: number, c: number) => number
  readonly df_process_frames: (a: number, b: number, c: number) => number
  readonly df_set_atten_lim: (a: number, b: number) => void
  readonly df_set_post_filter_beta: (a: number, b: number) => void
  readonly __wbindgen_malloc: (a: number, b: number) => number
  readonly __wbindgen_exn_store: (a: number) => void
}
export type SyncInitInput = BufferSource | WebAssembly.Module
export function initSync(wasmModule: SyncInitInput): InitOutput
