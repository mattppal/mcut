import type { LayerChrome } from '../backend'

export interface InverseChrome {
  m00: number
  m01: number
  m10: number
  m11: number
  centerX: number
  centerY: number
  degenerate: boolean
}

export function invertChrome(chrome: LayerChrome): InverseChrome {
  const { scaleX, scaleY, rotationDeg, centerX, centerY } = chrome
  if (scaleX === 0 || scaleY === 0) {
    return { m00: 0, m01: 0, m10: 0, m11: 0, centerX, centerY, degenerate: true }
  }
  const angle = (-rotationDeg * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    m00: cos / scaleX,
    m01: -sin / scaleX,
    m10: sin / scaleY,
    m11: cos / scaleY,
    centerX,
    centerY,
    degenerate: false,
  }
}

export function gaussianKernel(radius: number): Float32Array {
  const sigma = Math.max(0.1, radius / 2)
  const half = Math.max(1, Math.ceil(sigma * 3))
  const weights = new Float32Array(half * 2 + 1)
  let sum = 0
  for (let i = -half; i <= half; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma))
    weights[i + half] = w
    sum += w
  }
  return weights.map((w) => w / sum)
}
