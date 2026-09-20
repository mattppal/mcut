import { basename } from 'node:path'
import { mediabunnyProber, MediaProbeError, type MediaProber, type MediaProberId } from '../probe'
import type { ProbeReply, ProbeRequest } from './probe-runner'

const probers: Record<MediaProberId, MediaProber> = { mediabunny: mediabunnyProber }

const reply = (message: ProbeReply): void => postMessage(message)

self.onmessage = async (event: MessageEvent<ProbeRequest>) => {
  const { id, prober, path } = event.data
  const bytes = await Bun.file(path).arrayBuffer()
  try {
    const probe = await probers[prober].probe({ kind: 'blob', blob: new Blob([bytes]), name: basename(path) })
    reply({ id, kind: 'probe', probe })
  } catch (error) {
    reply({
      id,
      kind: 'threw',
      typed: error instanceof MediaProbeError,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
