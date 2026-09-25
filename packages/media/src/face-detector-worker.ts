import { ALL_FORMATS, BlobSource, CanvasSink, Input, UrlSource } from 'mediabunny'
import * as ort from 'onnxruntime-web/webgpu'
import {
  faceDetectRequestSchema,
  type FaceBox,
  type FaceDetectorProgress,
  type FaceDetectRequest,
  type FaceDetectResponse,
  type FaceSample,
  type OrtWasmPaths,
} from './face-detector-protocol'
import { largestFace, letterboxSize, writeYunetInput, YUNET_INPUT_SIZE } from './yunet'

const MODEL_URL = 'https://huggingface.co/opencv/face_detection_yunet/resolve/3cc26e7f1014a5ee5d74a42acee58bafc9d0a310/face_detection_yunet_2023mar.onnx'
const MODEL_CACHE = 'mcut-models-v1'

let session: Promise<ort.InferenceSession> | null = null

const post = (message: FaceDetectResponse): void => self.postMessage(message)

function defaultWasmPaths(): OrtWasmPaths {
  const version = ort.env.versions.web
  if (version === undefined) throw new Error('onnxruntime-web did not report its version')
  const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/ort-wasm-simd-threaded.asyncify`
  return { mjs: `${base}.mjs`, wasm: `${base}.wasm` }
}

async function openModelCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null
  return caches.open(MODEL_CACHE).catch(() => null)
}

async function downloadModel(onProgress: (progress: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const response = await fetch(MODEL_URL)
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    const total = Number(response.headers.get('content-length'))
    const reader = response.body.getReader()
    const chunks: Uint8Array<ArrayBuffer>[] = []
    let loaded = 0
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      chunks.push(read.value)
      loaded += read.value.byteLength
      if (total > 0) onProgress(Math.min(1, loaded / total))
    }
    return new Uint8Array(await new Blob(chunks).arrayBuffer())
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not download the face detection model from huggingface.co (${reason}). Check the connection and try again.`, { cause: error })
  }
}

async function loadModel(onProgress: (progress: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const cache = await openModelCache()
  const cached = await cache?.match(MODEL_URL)
  if (cached) return new Uint8Array(await cached.arrayBuffer())
  const model = await downloadModel(onProgress)
  await cache?.put(MODEL_URL, new Response(model)).catch(() => undefined)
  return model
}

async function createSession(paths: OrtWasmPaths | undefined, onProgress: (progress: number) => void): Promise<ort.InferenceSession> {
  ort.env.wasm.wasmPaths = paths ?? defaultWasmPaths()
  return ort.InferenceSession.create(await loadModel(onProgress), { executionProviders: ['wasm'] })
}

function sampleTimesMs(durationS: number, sampleRateHz: number): number[] {
  return Array.from({ length: Math.ceil(durationS * sampleRateHz) }, (_, i) => Math.round((i * 1000) / sampleRateHz))
}

async function detectFaces(request: FaceDetectRequest, model: ort.InferenceSession, onProgress: (progress: number) => void): Promise<FaceSample[]> {
  const input = new Input({ formats: ALL_FORMATS, source: typeof request.src === 'string' ? new UrlSource(request.src) : new BlobSource(request.src) })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('The media has no video track')
    if (!(await track.canDecode())) throw new Error('This browser cannot decode the video track')
    const frame = letterboxSize(await track.getDisplayWidth(), await track.getDisplayHeight())
    const firstS = await track.getFirstTimestamp()
    const times = sampleTimesMs(await track.computeDuration(), request.sampleRateHz)
    const sink = new CanvasSink(track, { width: frame.width, height: frame.height, fit: 'fill', poolSize: 1 })
    const pixels = new Float32Array(3 * YUNET_INPUT_SIZE * YUNET_INPUT_SIZE)
    const tensor = new ort.Tensor('float32', pixels, [1, 3, YUNET_INPUT_SIZE, YUNET_INPUT_SIZE])
    const detectFrame = async (canvas: HTMLCanvasElement | OffscreenCanvas): Promise<FaceBox | null> => {
      const context = canvas instanceof OffscreenCanvas ? canvas.getContext('2d') : null
      if (!context) throw new Error('The decoded frame has no 2D canvas context')
      writeYunetInput(context.getImageData(0, 0, frame.width, frame.height).data, frame, pixels)
      return largestFace(await model.run({ input: tensor }), frame)
    }
    const boxes: (FaceBox | null)[] = []
    for await (const wrapped of sink.canvasesAtTimestamps(times.map((ms) => Math.max(firstS, ms / 1000)))) {
      boxes.push(wrapped ? await detectFrame(wrapped.canvas) : null)
      onProgress(boxes.length / times.length)
    }
    return times.map((sourceMs, i) => ({ sourceMs, box: boxes[i] ?? null }))
  } finally {
    input.dispose()
  }
}

async function handle(request: FaceDetectRequest): Promise<void> {
  const report = (phase: FaceDetectorProgress['phase']) => (progress: number) => post({ type: 'progress', id: request.id, phase, progress })
  try {
    session ??= createSession(request.ortWasmPaths, report('model'))
    const samples = await detectFaces(request, await session, report('detect'))
    post({ type: 'result', id: request.id, samples })
  } catch (error) {
    post({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) })
  }
}

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  void handle(faceDetectRequestSchema.parse(event.data))
})
