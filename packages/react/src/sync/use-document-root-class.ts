import { useEffect } from 'react'

export function useDocumentRootClass(className: string, enabled: boolean): void {
  useEffect(() => {
    const root = document.documentElement
    const had = root.classList.contains(className)
    root.classList.toggle(className, enabled)
    return () => {
      root.classList.toggle(className, had)
    }
  }, [className, enabled])
}
