import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, net, protocol } from 'electron'

const STUDIO_SCHEME = 'app'
const STUDIO_HOST = 'studio'

export const STUDIO_ORIGIN = `${STUDIO_SCHEME}://${STUDIO_HOST}`

const TRANSCRIBE_PATH = '/api/transcribe'

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "connect-src 'self' blob: ws://127.0.0.1:* http://127.0.0.1:* https://huggingface.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.huggingface.co",
  "img-src 'self' blob: data: http://127.0.0.1:*",
  "media-src 'self' blob: http://127.0.0.1:*",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
].join('; ')

export function registerStudioScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: STUDIO_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ])
}

function isFile(candidate: string): boolean {
  return existsSync(candidate) && statSync(candidate).isFile()
}

function decodePathname(pathname: string): string | undefined {
  try {
    return decodeURIComponent(pathname)
  } catch (error) {
    if (error instanceof URIError) return undefined
    throw error
  }
}

function resolveStudioFile(root: string, pathname: string): string | undefined {
  const decoded = decodePathname(pathname)
  if (decoded === undefined) return undefined
  const target = path.resolve(root, `.${decoded}`)
  const relative = path.relative(root, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined
  return [target, `${target}.html`, path.join(target, 'index.html')].find(isFile)
}

function withPolicy(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('content-security-policy', CONTENT_SECURITY_POLICY)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export interface StudioServerOptions {
  transcribe(request: Request): Promise<Response>
}

export function serveStudio(options: StudioServerOptions): void {
  const root = path.join(app.getAppPath(), 'studio')
  protocol.handle(STUDIO_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host === STUDIO_HOST && url.pathname === TRANSCRIBE_PATH && request.method === 'POST') {
      return withPolicy(await options.transcribe(request))
    }
    const file = url.host === STUDIO_HOST ? resolveStudioFile(root, url.pathname) : undefined
    if (file === undefined) {
      return withPolicy(new Response(`Not found: ${url.pathname}`, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } }))
    }
    return withPolicy(await net.fetch(pathToFileURL(file).toString()))
  })
}
