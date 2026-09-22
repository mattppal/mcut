import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import type { WhisperNetwork } from './context.ts'

export const HUB_PROBE = 'https://huggingface.co/onnx-community/whisper-tiny.en/resolve/main/config.json'
export const UPSTREAM_HOSTS = ['huggingface.co', 'hf.co', 'cdn.jsdelivr.net']
const PROBE_TIMEOUT_MS = 6_000

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')

export function isUpstreamUrl(url: string): boolean {
  const host = new URL(url).hostname
  return UPSTREAM_HOSTS.some((upstream) => host === upstream || host.endsWith(`.${upstream}`))
}

async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    return response.ok
  } catch {
    return false
  }
}

const ORT_DIR = path.join(repoRoot, 'apps/studio/public/ort')

export function mirrorFileFor(pathname: string, dir: string, ort: string): string {
  const ortMatch = /^\/npm\/onnxruntime-web@[^/]+\/dist\/(.+)$/.exec(pathname)
  if (ortMatch !== null) return path.join(ort, ortMatch[1] ?? '')
  const hubMatch = /^\/([^/]+\/[^/]+)\/resolve\/[^/]+\/(.+)$/.exec(pathname)
  if (hubMatch !== null) return path.join(dir, hubMatch[1] ?? '', hubMatch[2] ?? '')
  return path.join(dir, pathname)
}

export interface Mirror {
  url: string
  close(): Promise<void>
}

export function startMirror(dir: string): Promise<Mirror> {
  const ort = ORT_DIR
  const server: Server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://mirror').pathname)
    const file = mirrorFileFor(pathname, dir, ort)
    const inside = file.startsWith(ort) || file.startsWith(dir)
    if (!inside || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { 'access-control-allow-origin': '*' }).end('not found')
      return
    }
    const type = file.endsWith('.json') ? 'application/json' : file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'
    response.writeHead(200, { 'content-type': type, 'content-length': statSync(file).size, 'access-control-allow-origin': '*' })
    createReadStream(file).pipe(response)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('mirror did not bind a port')
      resolve({ url: `http://127.0.0.1:${address.port}`, close: () => new Promise((done) => server.close(() => done())) })
    })
  })
}

export async function probeWhisperNetwork(mirrorDir: string | null): Promise<{ network: WhisperNetwork; mirror: Mirror | null }> {
  if (await reachable(HUB_PROBE)) return { network: { mode: 'real' }, mirror: null }
  if (mirrorDir !== null && existsSync(path.join(mirrorDir, 'onnx-community'))) {
    const mirror = await startMirror(path.resolve(mirrorDir))
    return { network: { mode: 'mirror', url: mirror.url }, mirror }
  }
  const reason =
    mirrorDir === null
      ? `${HUB_PROBE} is unreachable and MCUT_WHISPER_MIRROR is unset`
      : `${HUB_PROBE} is unreachable and ${mirrorDir} holds no onnx-community/ directory`
  return { network: { mode: 'offline', reason }, mirror: null }
}
