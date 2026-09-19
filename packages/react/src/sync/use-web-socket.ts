import { useEffect } from 'react'
import { useLatest } from './use-latest'

export interface WebSocketHandlers {
  onOpen: (socket: WebSocket) => void
  onMessage: (socket: WebSocket, event: MessageEvent) => void
}

export function useWebSocket(url: string | null, handlers: WebSocketHandlers, options: { reconnectDelayMs: number }): void {
  const latest = useLatest(handlers)
  const reconnectDelayMs = options.reconnectDelayMs
  useEffect(() => {
    if (url === null) return
    let stopped = false
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    const connect = (): void => {
      const opened = new WebSocket(url)
      socket = opened
      opened.addEventListener('open', () => latest.current.onOpen(opened))
      opened.addEventListener('message', (event) => latest.current.onMessage(opened, event))
      opened.addEventListener('error', () => opened.close())
      opened.addEventListener('close', () => {
        if (!stopped) reconnectTimer = setTimeout(connect, reconnectDelayMs)
      })
    }
    connect()
    return () => {
      stopped = true
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [url, reconnectDelayMs, latest])
}
