import { parentPort } from 'node:worker_threads'
import { denoise } from './denoise'

const port = parentPort
if (port === null) throw new Error('the @mcut/voice node worker must run in a worker thread')

port.once('message', (data: unknown) => denoise(data, (message, transfer) => port.postMessage(message, transfer)))
