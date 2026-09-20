import { type AssetKey } from '@/lib/desktop-release'

export type PlatformMatch = { key: AssetKey; certain: boolean }

export function detectAssetKey(): PlatformMatch | null {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return null
  const ua = navigator.userAgent
  if (ua.includes('Android') || ua.includes('iPhone') || ua.includes('iPad') || ua.includes('iPod') || ua.includes('Windows')) {
    return null
  }
  if (ua.includes('Linux')) return { key: 'linux-x86_64', certain: true }
  if (!ua.includes('Macintosh') && !ua.includes('Mac OS X')) return null
  return matchMac(readGpuRenderer())
}

function matchMac(renderer: string | null): PlatformMatch {
  if (renderer === null) return { key: 'mac-arm64', certain: false }
  if (renderer.includes('Apple M') || renderer.includes('Apple GPU')) return { key: 'mac-arm64', certain: true }
  if (renderer.includes('Intel') || renderer.includes('AMD') || renderer.includes('Radeon')) return { key: 'mac-x64', certain: true }
  return { key: 'mac-arm64', certain: false }
}

function readGpuRenderer(): string | null {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl')
  if (!(gl instanceof WebGLRenderingContext)) return null
  const debug = gl.getExtension('WEBGL_debug_renderer_info')
  if (debug === null) return null
  const renderer = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
  if (typeof renderer !== 'string' || renderer.length === 0) return null
  return renderer
}
