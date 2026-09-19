import { useEffect } from 'react'
import { useLatest } from './use-latest'

export function useDocumentEvent<K extends keyof DocumentEventMap>(
  type: K,
  handler: (event: DocumentEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void {
  const latest = useLatest(handler)
  const capture = options?.capture ?? false
  const passive = options?.passive
  useEffect(() => {
    const listener = (event: DocumentEventMap[K]) => latest.current(event)
    const listenerOptions: AddEventListenerOptions = { capture, ...(passive === undefined ? {} : { passive }) }
    document.addEventListener(type, listener, listenerOptions)
    return () => document.removeEventListener(type, listener, listenerOptions)
  }, [type, capture, passive, latest])
}
