import { MediaProbeError, probeMedia } from '../probe'
import type { ProbeReply, ProbeRequest } from './probe-runner'

const reply = (message: ProbeReply): void => postMessage(message)

self.onmessage = async (event: MessageEvent<ProbeRequest>) => {
  const { id, path } = event.data
  const bytes = await Bun.file(path).arrayBuffer()
  try {
    const probe = await probeMedia(new Blob([bytes]))
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
