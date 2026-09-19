import { useEffect, useState } from 'react'

export interface Disposable {
  dispose: () => void
}

export function useDisposable<T extends Disposable>(create: () => T): T {
  const [instance] = useState(create)
  useEffect(() => () => instance.dispose(), [instance])
  return instance
}
