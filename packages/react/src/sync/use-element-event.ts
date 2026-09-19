import { useEffect, type RefObject } from 'react'
import { useLatest } from './use-latest'

export function useElementEvent<K extends keyof HTMLElementEventMap>(
  ref: RefObject<HTMLElement | null>,
  type: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void {
  const latest = useLatest(handler)
  const capture = options?.capture ?? false
  const passive = options?.passive
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const listener = (event: HTMLElementEventMap[K]) => latest.current(event)
    const listenerOptions: AddEventListenerOptions = { capture, ...(passive === undefined ? {} : { passive }) }
    element.addEventListener(type, listener, listenerOptions)
    return () => element.removeEventListener(type, listener, listenerOptions)
  }, [ref, type, capture, passive, latest])
}
