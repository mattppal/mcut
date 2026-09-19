import { existsSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { repoRoot } from './fixtures'

export interface FixtureServer {
  origin: string
  stop(): Promise<void>
}

const SERVED_DIRS = ['fixtures/media', 'apps/studio/e2e/fixtures']

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'range, content-type',
  'access-control-expose-headers': 'accept-ranges, content-length, content-range',
  'accept-ranges': 'bytes',
}

const RANGE_HEADER = /^bytes=(\d*)-(\d*)$/

interface ByteRange {
  start: number
  end: number
}

function servedFile(pathname: string): string | undefined {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '')
  if (!SERVED_DIRS.some((dir) => rel.startsWith(`${dir}/`))) return undefined
  const absolute = resolve(repoRoot, rel)
  if (!absolute.startsWith(`${repoRoot}${sep}`)) return undefined
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return undefined
  return absolute
}

function byteRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | undefined {
  if (header === null) return undefined
  const match = RANGE_HEADER.exec(header.trim())
  if (match === null) return undefined
  const [, rawStart = '', rawEnd = ''] = match
  if (rawStart === '' && rawEnd === '') return undefined
  const start = rawStart === '' ? Math.max(0, size - Number(rawEnd)) : Number(rawStart)
  const end = rawStart === '' || rawEnd === '' ? size - 1 : Math.min(size - 1, Number(rawEnd))
  if (start > end || start >= size) return 'unsatisfiable'
  return { start, end }
}

function respond(request: Request): Response {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405, headers: CORS_HEADERS })
  }
  const path = servedFile(new URL(request.url).pathname)
  if (path === undefined) return new Response('not found', { status: 404, headers: CORS_HEADERS })
  const file = Bun.file(path)
  const range = byteRange(request.headers.get('range'), file.size)
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...CORS_HEADERS, 'content-range': `bytes */${file.size}` } })
  }
  const body = range === undefined ? file : file.slice(range.start, range.end + 1)
  const headers = {
    ...CORS_HEADERS,
    'content-type': file.type,
    'content-length': String(body.size),
    ...(range === undefined ? {} : { 'content-range': `bytes ${range.start}-${range.end}/${file.size}` }),
  }
  const status = range === undefined ? 200 : 206
  return new Response(request.method === 'HEAD' ? null : body, { status, headers })
}

export function startFixtureServer(): FixtureServer {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: respond })
  return {
    origin: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  }
}
