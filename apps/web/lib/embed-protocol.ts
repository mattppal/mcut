export type ParentMessage =
  | { type: 'mcut:embed:play' }
  | { type: 'mcut:embed:pause' }
  | { type: 'mcut:embed:collapsed'; collapsed: boolean }
  | { type: 'mcut:embed:request'; request: unknown }
  | { type: 'mcut:embed:reset' }

export type EmbedResult = { type: 'mcut:embed:result'; id: string; ok: true; result: unknown } | { type: 'mcut:embed:result'; id: string; ok: false; message: string }

export type EmbedMessage = { type: 'mcut:embed:ready' } | { type: 'mcut:embed:playing'; playing: boolean } | EmbedResult

function readEmbedResult(data: object): EmbedResult | null {
  if (!('id' in data) || typeof data.id !== 'string' || !('ok' in data)) return null
  if (data.ok === true) return { type: 'mcut:embed:result', id: data.id, ok: true, result: 'result' in data ? data.result : undefined }
  if (data.ok === false && 'message' in data && typeof data.message === 'string') {
    return { type: 'mcut:embed:result', id: data.id, ok: false, message: data.message }
  }
  return null
}

export function readEmbedMessage(data: unknown): EmbedMessage | null {
  if (typeof data !== 'object' || data === null || !('type' in data)) return null
  if (data.type === 'mcut:embed:ready') return { type: 'mcut:embed:ready' }
  if (data.type === 'mcut:embed:playing' && 'playing' in data && typeof data.playing === 'boolean') {
    return { type: 'mcut:embed:playing', playing: data.playing }
  }
  if (data.type === 'mcut:embed:result') return readEmbedResult(data)
  return null
}
