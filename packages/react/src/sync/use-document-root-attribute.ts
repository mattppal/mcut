import { useEffect } from 'react'

export function useDocumentRootAttribute(name: string, value: string): void {
  useEffect(() => {
    const root = document.documentElement
    const previous = root.getAttribute(name)
    root.setAttribute(name, value)
    return () => {
      if (previous === null) root.removeAttribute(name)
      else root.setAttribute(name, previous)
    }
  }, [name, value])
}
