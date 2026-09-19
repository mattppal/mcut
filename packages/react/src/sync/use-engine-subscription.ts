import { useEffect } from 'react'
import { useLatest } from './use-latest'

export interface EngineStore<T> {
  get: () => T
  subscribe: (listener: (state: T) => void) => { unsubscribe: () => void }
}

export function useEngineSubscription<T>(
  store: EngineStore<T>,
  onChange: (state: T, previous: T) => void,
  options?: { debounceMs?: number },
): void {
  const latest = useLatest(onChange)
  const debounceMs = options?.debounceMs
  useEffect(() => {
    let previous = store.get()
    let before = previous
    let timer: ReturnType<typeof setTimeout> | null = null
    const subscription = store.subscribe((state) => {
      if (timer === null) before = previous
      previous = state
      if (debounceMs === undefined) {
        latest.current(state, before)
        return
      }
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        latest.current(store.get(), before)
      }, debounceMs)
    })
    return () => {
      if (timer !== null) clearTimeout(timer)
      subscription.unsubscribe()
    }
  }, [store, debounceMs, latest])
}
