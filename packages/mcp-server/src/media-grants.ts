import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { MCP_TOOL_INPUTS, importMediaBridgePayloadSchema, mediaImportReportSchema, type MediaImportReport } from './contract'

export interface MediaGrant {
  id: string
  path: string
  name: string
  mimeType: string
  size: number
}

interface PathFailure {
  path: string
  error: string
}

type ClassifiedPath = { ok: true; path: string; name: string; mimeType: string; size: number } | { ok: false; path: string; error: string }

export class MediaGrantStore {
  private readonly grants = new Map<string, MediaGrant>()

  put(grant: MediaGrant): void {
    this.grants.set(grant.id, grant)
  }

  read(id: string): MediaGrant | undefined {
    return this.grants.get(id)
  }

  revoke(ids: readonly string[]): void {
    for (const id of ids) this.grants.delete(id)
  }
}

function mimeTypeFor(filePath: string): string | null {
  switch (path.extname(filePath).slice(1).toLowerCase()) {
    case 'mp4':
      return 'video/mp4'
    case 'mov':
      return 'video/quicktime'
    case 'm4v':
      return 'video/x-m4v'
    case 'webm':
      return 'video/webm'
    case 'mkv':
      return 'video/x-matroska'
    case 'mp3':
      return 'audio/mpeg'
    case 'm4a':
      return 'audio/mp4'
    case 'aac':
      return 'audio/aac'
    case 'wav':
      return 'audio/wav'
    case 'flac':
      return 'audio/flac'
    case 'ogg':
      return 'audio/ogg'
    case 'opus':
      return 'audio/opus'
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    default:
      return null
  }
}

function statFailure(filePath: string, error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : ''
  if (code === 'ENOENT') return `import_media could not find "${filePath}". Home is ${homedir()}.`
  if (code.length > 0) return `import_media could not read "${filePath}" (${code}).`
  return `import_media could not read "${filePath}".`
}

function resolveMediaPath(input: string): string | null {
  if (input === '~' || input.startsWith('~/')) return path.join(homedir(), input.slice(1))
  return path.isAbsolute(input) ? path.resolve(input) : null
}

async function classifyPath(input: string): Promise<ClassifiedPath> {
  const filePath = resolveMediaPath(input)
  if (filePath === null) {
    return { ok: false, path: input, error: `import_media requires an absolute path or one starting with ~/, got "${input}". Home is ${homedir()}.` }
  }
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(filePath)
  } catch (error) {
    return { ok: false, path: input, error: statFailure(filePath, error) }
  }
  if (info.isDirectory()) {
    return { ok: false, path: input, error: `import_media cannot import "${filePath}" because it is a directory.` }
  }
  if (!info.isFile()) {
    return { ok: false, path: input, error: `import_media cannot import "${filePath}" because it is not a regular file.` }
  }
  if (info.size === 0) {
    return { ok: false, path: input, error: `import_media cannot import "${filePath}" because it is empty.` }
  }
  const mimeType = mimeTypeFor(filePath)
  if (mimeType === null) {
    return { ok: false, path: input, error: `import_media does not recognize the extension of "${filePath}".` }
  }
  return { ok: true, path: filePath, name: path.basename(filePath), mimeType, size: info.size }
}

function grantUrl(port: number, id: string, token: string | null): string {
  const url = new URL(`http://127.0.0.1:${port}/media/${id}`)
  if (token !== null) url.searchParams.set('token', token)
  return url.toString()
}

function mergeReport(localFailed: readonly PathFailure[], studio: MediaImportReport): MediaImportReport {
  return { imported: studio.imported, failed: [...localFailed, ...studio.failed] }
}

export async function runImportMedia(options: {
  payload: unknown
  port: number
  token: string | null
  store: MediaGrantStore
  request: (type: string, payload: unknown) => Promise<unknown>
}): Promise<MediaImportReport> {
  const parsed = MCP_TOOL_INPUTS.import_media.safeParse(options.payload)
  if (!parsed.success) throw new Error(`import_media: ${z.prettifyError(parsed.error)}`)
  const checked = await Promise.all(parsed.data.paths.map(classifyPath))
  const grants: MediaGrant[] = []
  const failed: PathFailure[] = []
  const files: z.infer<typeof importMediaBridgePayloadSchema>['files'] = []
  for (const item of checked) {
    if (!item.ok) {
      failed.push({ path: item.path, error: item.error })
      continue
    }
    const grant: MediaGrant = {
      id: randomBytes(16).toString('hex'),
      path: item.path,
      name: item.name,
      mimeType: item.mimeType,
      size: item.size,
    }
    grants.push(grant)
    options.store.put(grant)
    files.push({
      url: grantUrl(options.port, grant.id, options.token),
      name: grant.name,
      mimeType: grant.mimeType,
      size: grant.size,
      path: item.path,
    })
  }
  if (files.length === 0) return { imported: [], failed }
  try {
    const studio = mediaImportReportSchema.safeParse(await options.request('import_media', importMediaBridgePayloadSchema.parse({ files })))
    if (!studio.success) throw new Error(`import_media returned an unexpected result. ${z.prettifyError(studio.error)}`)
    return mergeReport(failed, studio.data)
  } finally {
    options.store.revoke(grants.map((grant) => grant.id))
  }
}

const MEDIA_GRANT_PATH = /^\/media\/([a-f0-9]{32})$/

function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-private-network': 'true',
    vary: 'Origin',
  }
}

function writeJson(res: ServerResponse, status: number, value: unknown, headers: Record<string, string>): void {
  res.writeHead(status, {
    ...headers,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(`${JSON.stringify(value)}\n`)
}

function streamGrant(res: ServerResponse, grant: MediaGrant, headers: Record<string, string>): Promise<void> {
  return new Promise((resolve) => {
    const stream = createReadStream(grant.path)
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    stream.once('error', () => {
      stream.destroy()
      if (!res.headersSent) writeJson(res, 404, { ok: false, error: 'Media grant file is gone.' }, headers)
      else res.end()
      finish()
    })
    res.once('close', () => {
      if (!res.writableFinished) stream.destroy()
      finish()
    })
    stream.once('open', () => {
      res.writeHead(200, {
        ...headers,
        'content-type': grant.mimeType,
        'content-length': String(grant.size),
        'cache-control': 'no-store',
      })
      stream.pipe(res)
    })
  })
}

export async function serveMediaGrant(
  req: IncomingMessage,
  res: ServerResponse,
  options: { url: URL; store: MediaGrantStore; bridgeToken: string | null; originAllowed: boolean },
): Promise<void> {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
  const headers = origin !== undefined && options.originAllowed ? corsHeaders(origin) : {}
  if (origin !== undefined && !options.originAllowed) {
    writeJson(res, 403, { ok: false, error: 'Origin is not allowed.' }, headers)
    return
  }
  const token = options.url.searchParams.get('token')
  if (options.bridgeToken !== null && token !== options.bridgeToken) {
    writeJson(res, 403, { ok: false, error: 'Media grant token is invalid.' }, headers)
    return
  }
  const id = MEDIA_GRANT_PATH.exec(options.url.pathname)?.[1]
  const grant = id === undefined ? undefined : options.store.read(id)
  if (!grant) {
    writeJson(res, 404, { ok: false, error: 'Media grant was not found.' }, headers)
    return
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers)
    res.end()
    return
  }
  if (req.method !== 'GET') {
    writeJson(res, 405, { ok: false, error: 'Method not allowed.' }, headers)
    return
  }
  await streamGrant(res, grant, headers)
}
