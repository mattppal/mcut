import { copyFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs'
import path from 'node:path'

const ORT_WASM_FILES = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']

const studioDir = path.resolve(import.meta.dirname, '..')
const targetDir = path.join(studioDir, 'public', 'ort')

function resolvedDir(specifier: string, from: string): string {
  return path.dirname(realpathSync(Bun.resolveSync(specifier, from)))
}

const transcriptionLocalDir = resolvedDir('@mcut/transcription-local', studioDir)
const transformersDir = resolvedDir('@huggingface/transformers', transcriptionLocalDir)
const ortDistDir = resolvedDir('onnxruntime-web/webgpu', transformersDir)

mkdirSync(targetDir, { recursive: true })
for (const file of ORT_WASM_FILES) {
  const source = path.join(ortDistDir, file)
  if (!existsSync(source)) throw new Error(`onnxruntime-web is missing ${file} at ${source}`)
  copyFileSync(source, path.join(targetDir, file))
}
