export type ParentMessage = { type: 'mcut:embed:play' } | { type: 'mcut:embed:pause' } | { type: 'mcut:embed:collapsed'; collapsed: boolean }

export type EmbedMessage = { type: 'mcut:embed:ready' } | { type: 'mcut:embed:playing'; playing: boolean }

export function readEmbedMessage(data: unknown): EmbedMessage | null {
  if (typeof data !== 'object' || data === null || !('type' in data)) return null
  if (data.type === 'mcut:embed:ready') return { type: 'mcut:embed:ready' }
  if (data.type === 'mcut:embed:playing' && 'playing' in data && typeof data.playing === 'boolean') {
    return { type: 'mcut:embed:playing', playing: data.playing }
  }
  return null
}
