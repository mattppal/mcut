import type { VideoSample } from 'mediabunny'

function convertsToRgba(sample: VideoSample): boolean {
  return sample.allocationSize({ format: 'RGBA' }) === sample.visibleRect.width * sample.visibleRect.height * 4
}

export async function sampleBitmap(sample: VideoSample): Promise<ImageBitmap> {
  if (!convertsToRgba(sample)) return createImageBitmap(sample.toCanvasImageSource())
  const image = new ImageData(sample.visibleRect.width, sample.visibleRect.height)
  await sample.copyTo(image.data, { format: 'RGBA' })
  return createImageBitmap(image, { resizeWidth: sample.squarePixelWidth, resizeHeight: sample.squarePixelHeight })
}
