import type { VideoSample } from 'mediabunny'
import { createCanvasSurface } from './native-video'

function convertsToRgba(sample: VideoSample): boolean {
  return sample.allocationSize({ format: 'RGBA' }) === sample.visibleRect.width * sample.visibleRect.height * 4
}

export async function sampleBitmap(sample: VideoSample, image = new ImageData(sample.visibleRect.width, sample.visibleRect.height)): Promise<ImageBitmap> {
  if (!convertsToRgba(sample)) return createImageBitmap(sample.toCanvasImageSource())
  await sample.copyTo(image.data, { format: 'RGBA' })
  return createImageBitmap(image, { resizeWidth: sample.squarePixelWidth, resizeHeight: sample.squarePixelHeight })
}

function surfaceContext(width: number, height: number, settings?: CanvasRenderingContext2DSettings) {
  const surface = createCanvasSurface(width, height, settings)
  if (!surface.ctx) throw new Error('Could not create a 2D canvas context for a video frame')
  return { canvas: surface.canvas, ctx: surface.ctx }
}

export async function sampleCanvas(
  sample: VideoSample,
  width: number,
  fit: 'fill' | 'contain' | 'cover' = 'fill',
): Promise<HTMLCanvasElement | OffscreenCanvas> {
  const { rotation, flip } = sample
  const bitmap = await sampleBitmap(sample).finally(() => sample.close())
  const quarterTurn = rotation % 180 !== 0
  const [rotatedWidth, rotatedHeight] = quarterTurn ? [bitmap.height, bitmap.width] : [bitmap.width, bitmap.height]
  const height = Math.round(width / (rotatedWidth / rotatedHeight))
  const mipLevels = 2 * width < rotatedWidth && 2 * height < rotatedHeight ? Math.floor(Math.log2(Math.min(rotatedWidth / width, rotatedHeight / height))) : 0
  const target = surfaceContext(width, height, { alpha: false })
  const drawWidth = width * 2 ** mipLevels
  const drawHeight = height * 2 ** mipLevels
  const mip = mipLevels > 0 ? surfaceContext(drawWidth, drawHeight) : target

  const scale =
    fit === 'contain' ? Math.min(drawWidth / rotatedWidth, drawHeight / rotatedHeight) : Math.max(drawWidth / rotatedWidth, drawHeight / rotatedHeight)
  const [newWidth, newHeight] = fit === 'fill' ? [drawWidth, drawHeight] : [rotatedWidth * scale, rotatedHeight * scale]
  mip.ctx.imageSmoothingQuality = 'high'
  mip.ctx.save()
  mip.ctx.translate(drawWidth / 2, drawHeight / 2)
  if (flip) mip.ctx.scale(-1, 1)
  mip.ctx.rotate((rotation * Math.PI) / 180)
  const aspectRatioChange = quarterTurn ? newWidth / newHeight : 1
  mip.ctx.scale(1 / aspectRatioChange, aspectRatioChange)
  mip.ctx.translate(-drawWidth / 2, -drawHeight / 2)
  mip.ctx.drawImage(bitmap, (drawWidth - newWidth) / 2, (drawHeight - newHeight) / 2, newWidth, newHeight)
  mip.ctx.restore()
  bitmap.close()

  mip.ctx.globalCompositeOperation = 'copy'
  for (let level = mipLevels; level > 1; level--) {
    const levelWidth = width * 2 ** level
    const levelHeight = height * 2 ** level
    mip.ctx.drawImage(mip.canvas, 0, 0, levelWidth, levelHeight, 0, 0, levelWidth / 2, levelHeight / 2)
  }
  if (mipLevels > 0) {
    target.ctx.imageSmoothingQuality = 'high'
    target.ctx.globalCompositeOperation = 'copy'
    target.ctx.drawImage(mip.canvas, 0, 0, 2 * width, 2 * height, 0, 0, width, height)
  }
  return target.canvas
}
