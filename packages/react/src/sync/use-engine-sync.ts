import { useEffect } from 'react'
import type { EngineStore } from './use-engine-subscription'
import { useLatest } from './use-latest'

export function useEngineSync<T, S>(store: EngineStore<T>, select: (state: T) => S, sync: (selected: S) => void): void {
  const latest = useLatest({ select, sync })
  useEffect(() => {
    let current = latest.current.select(store.get())
    latest.current.sync(current)
    const subscription = store.subscribe((state) => {
      const next = latest.current.select(state)
      if (Object.is(next, current)) return
      current = next
      latest.current.sync(next)
    })
    return () => subscription.unsubscribe()
  }, [store, latest])
}
