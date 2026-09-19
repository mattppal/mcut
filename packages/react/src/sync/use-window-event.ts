import { useEffect } from 'react'
import { useLatest } from './use-latest'

export function useWindowEvent<K extends keyof WindowEventMap>(type: K, handler: (event: WindowEventMap[K]) => void, options?: AddEventListenerOptions): void {
  const latest = useLatest(handler)
  const capture = options?.capture ?? false
  const passive = options?.passive
  useEffect(() => {
    const listener = (event: WindowEventMap[K]) => latest.current(event)
    const listenerOptions: AddEventListenerOptions = { capture, ...(passive === undefined ? {} : { passive }) }
    window.addEventListener(type, listener, listenerOptions)
    return () => window.removeEventListener(type, listener, listenerOptions)
  }, [type, capture, passive, latest])
}
