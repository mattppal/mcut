import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister()
const nativeWebSocket = globalThis.WebSocket
GlobalRegistrator.register()
globalThis.WebSocket = nativeWebSocket

import { afterAll, describe, expect, test } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import { useWebSocket } from './use-web-socket'

const { renderHook } = await import('@testing-library/react')

const serverSockets: ServerWebSocket<undefined>[] = []
const serverReceived: string[] = []
const server = Bun.serve<undefined>({
  port: 0,
  fetch: (request, bunServer) => (bunServer.upgrade(request) ? undefined : new Response('websocket only', { status: 426 })),
  websocket: {
    open: (socket) => {
      serverSockets.push(socket)
      socket.send(`welcome ${serverSockets.length}`)
    },
    message: (_socket, message) => {
      serverReceived.push(String(message))
    },
  },
})
afterAll(() => {
  void server.stop(true)
})

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in 2s')
    await Bun.sleep(5)
  }
}

describe('useWebSocket', () => {
  test('opens, exchanges messages, reconnects after the server closes, and stops on unmount', async () => {
    const clientReceived: string[] = []
    const { unmount } = renderHook(() =>
      useWebSocket(
        `ws://127.0.0.1:${server.port}`,
        {
          onOpen: (socket) => socket.send('hello'),
          onMessage: (_socket, event) => {
            clientReceived.push(String(event.data))
          },
        },
        { reconnectDelayMs: 20 },
      ),
    )
    await until(() => clientReceived.length === 1 && serverReceived.length === 1)
    expect(clientReceived).toEqual(['welcome 1'])
    expect(serverReceived).toEqual(['hello'])

    serverSockets[0]?.close()
    await until(() => clientReceived.length === 2 && serverReceived.length === 2)
    expect(clientReceived).toEqual(['welcome 1', 'welcome 2'])
    expect(serverReceived).toEqual(['hello', 'hello'])

    unmount()
    await until(() => serverSockets[1]?.readyState === 3)
    await Bun.sleep(60)
    expect(serverSockets.length).toBe(2)
  })
})
