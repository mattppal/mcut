import { afterEach, expect, test } from 'bun:test'
import { createLocalFaceDetector } from './face-detector'

const spawned: Worker[] = []

afterEach(() => {
  for (const worker of spawned.splice(0)) worker.terminate()
})

function scriptedWorker(reply: string): Worker {
  const source = `self.addEventListener('message', (event) => { const id = event.data.id; ${reply} })`
  const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })), { type: 'module' })
  spawned.push(worker)
  return worker
}

const media = new Blob(['bytes the scripted worker never decodes'])
const samples = [{ sourceMs: 0, box: { x: 0.25, y: 0.5, w: 0.125, h: 0.25 } }]
const replyFace = `self.postMessage({ type: 'result', id, samples: ${JSON.stringify(samples)} })`
const replyFailure = `self.postMessage({ type: 'error', id, message: 'Could not download the face detection model' })`
const replyProgress = `self.postMessage({ type: 'progress', id, phase: 'model', progress: 0.5 })`

test('a failed detection discards the worker so the next call retries on a fresh one that is then reused', async () => {
  const replies = [replyFailure, replyFace]
  const detector = createLocalFaceDetector({ createWorker: () => scriptedWorker(replies.shift() ?? replyFailure) })
  await expect(detector.detect(media)).rejects.toThrow('Could not download the face detection model')
  expect(await detector.detect(media)).toEqual(samples)
  expect(await detector.detect(media)).toEqual(samples)
  expect(spawned).toHaveLength(2)
})

test('aborting the detection in flight rejects with the reason and the queued call runs on a fresh worker', async () => {
  const replies = [replyProgress, replyFace]
  const progress: number[] = []
  let markInFlight = (): void => {}
  const inFlight = new Promise<void>((resolve) => (markInFlight = resolve))
  const detector = createLocalFaceDetector({
    createWorker: () => scriptedWorker(replies.shift() ?? replyProgress),
    onProgress: (event) => {
      progress.push(event.progress)
      markInFlight()
    },
  })
  const controller = new AbortController()
  const first = detector.detect(media, { signal: controller.signal })
  const second = detector.detect(media)
  await inFlight
  controller.abort(new Error('Cancelled by the user'))
  await expect(first).rejects.toThrow('Cancelled by the user')
  expect(await second).toEqual(samples)
  expect(progress).toEqual([0.5])
  expect(spawned).toHaveLength(2)
})

test('aborting a queued detection rejects it without waiting for the one in flight', async () => {
  const detector = createLocalFaceDetector({ createWorker: () => scriptedWorker('') })
  void detector.detect(media)
  const controller = new AbortController()
  const queued = detector.detect(media, { signal: controller.signal })
  controller.abort(new Error('Cancelled while queued'))
  await expect(queued).rejects.toThrow('Cancelled while queued')
  expect(spawned).toHaveLength(1)
})

test('a worker reply outside the protocol rejects the detection', async () => {
  const detector = createLocalFaceDetector({
    createWorker: () => scriptedWorker(`self.postMessage({ type: 'result', id, samples: [{ sourceMs: 0, box: { x: 2, y: 0, w: 1, h: 1 } }] })`),
  })
  await expect(detector.detect(media)).rejects.toThrow('The face detector worker sent a malformed message')
})
