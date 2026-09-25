import { denoise } from './denoise'

addEventListener('message', (event) => denoise(event.data, (message, transfer) => postMessage(message, { transfer })), { once: true })
