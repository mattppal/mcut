import { writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { z } from 'zod'

export interface StudioSignals {
  toasts: string[]
  consoleErrors: string[]
}

export interface StudioPage {
  importFiles(paths: string[]): Promise<void>
  placeOnTimeline(fileName: string): Promise<void>
  screenshot(file: string): Promise<void>
  drain(): Promise<StudioSignals>
  close(): void
}

export class StudioCdpError extends Error {}

const targetList = z.array(z.object({ type: z.string(), url: z.string(), webSocketDebuggerUrl: z.string().optional() }))

const cdpReply = z.object({
  id: z.number().optional(),
  method: z.string().optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
  params: z.unknown().optional(),
})

const evaluated = z.object({ result: z.object({ value: z.unknown().optional() }), exceptionDetails: z.object({ text: z.string() }).optional() })

const consoleEvent = z.object({ type: z.string(), args: z.array(z.object({ value: z.unknown().optional(), description: z.string().optional() })) })

const exceptionEvent = z.object({ exceptionDetails: z.object({ text: z.string(), exception: z.object({ description: z.string().optional() }).optional() }) })

const TOAST_WATCH = `(() => {
  if (window.__mcutToasts) return true
  window.__mcutToasts = []
  const seen = new WeakSet()
  const scan = () => document.querySelectorAll('[data-sonner-toast]').forEach((node) => {
    if (seen.has(node)) return
    seen.add(node)
    window.__mcutToasts.push(((node.getAttribute('data-type') ?? 'toast') + ': ' + node.textContent.trim()).slice(0, 300))
  })
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true })
  scan()
  return true
})()`

const TOAST_DRAIN = '(() => { const out = window.__mcutToasts ?? []; window.__mcutToasts = []; return out })()'

const placeScript = (fileName: string): string => `(() => {
  const label = [...document.querySelectorAll('*')].find((node) => node.children.length === 0 && node.textContent.trim() === ${JSON.stringify(fileName)})
  const card = label?.closest('[role=button]')
  if (!card) return false
  card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  return true
})()`

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function connectStudioPage(cdpUrl: string): Promise<StudioPage> {
  const targets = targetList.parse(await (await fetch(new URL('/json/list', cdpUrl))).json())
  const page = targets.find((target) => target.type === 'page' && target.url.startsWith('app://studio'))
  if (page?.webSocketDebuggerUrl === undefined) throw new StudioCdpError(`no app://studio page among the CDP targets at ${cdpUrl}`)
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  const replies = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const consoleErrors: string[] = []
  let nextId = 0

  socket.onmessage = (event) => {
    const message = cdpReply.safeParse(JSON.parse(String(event.data)))
    if (!message.success) return
    const { id, method, params } = message.data
    if (id !== undefined) {
      const reply = replies.get(id)
      replies.delete(id)
      if (message.data.error !== undefined) reply?.reject(new StudioCdpError(message.data.error.message))
      else reply?.resolve(message.data.result)
      return
    }
    if (method === 'Runtime.consoleAPICalled') {
      const entry = consoleEvent.safeParse(params)
      if (entry.success && (entry.data.type === 'error' || entry.data.type === 'warning')) {
        const text = entry.data.args.map((arg) => arg.description ?? String(arg.value)).join(' ')
        consoleErrors.push(`${entry.data.type}: ${text}`.slice(0, 400))
      }
    }
    if (method === 'Runtime.exceptionThrown') {
      const entry = exceptionEvent.safeParse(params)
      if (entry.success)
        consoleErrors.push(`exception: ${entry.data.exceptionDetails.exception?.description ?? entry.data.exceptionDetails.text}`.slice(0, 400))
    }
  }
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = () => reject(new StudioCdpError(`could not open ${page.webSocketDebuggerUrl}`))
  })

  const send = (method: string, params: object = {}): Promise<unknown> =>
    new Promise((resolve, reject) => {
      nextId += 1
      replies.set(nextId, { resolve, reject })
      socket.send(JSON.stringify({ id: nextId, method, params }))
    })

  const evaluate = async (expression: string): Promise<unknown> => {
    const reply = evaluated.parse(await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))
    if (reply.exceptionDetails !== undefined) throw new StudioCdpError(reply.exceptionDetails.text)
    return reply.result.value
  }

  await send('Runtime.enable')
  await evaluate(TOAST_WATCH)

  return {
    importFiles: async (paths) => {
      const document = z.object({ root: z.object({ nodeId: z.number() }) }).parse(await send('DOM.getDocument', { depth: -1, pierce: true }))
      const inputs = z
        .object({ nodeIds: z.array(z.number()) })
        .parse(await send('DOM.querySelectorAll', { nodeId: document.root.nodeId, selector: 'input[type=file]' }))
      const input = inputs.nodeIds[0]
      if (input === undefined) throw new StudioCdpError('the media bin has no file input to import through')
      await send('DOM.setFileInputFiles', { nodeId: input, files: paths })
      for (const path of paths) {
        const name = basename(path)
        for (let attempt = 0; attempt < 60; attempt++) {
          if ((await evaluate(`[...document.querySelectorAll('[role=button]')].some((node) => node.textContent.includes(${JSON.stringify(name)}))`)) === true)
            break
          await sleep(250)
        }
      }
    },
    placeOnTimeline: async (fileName) => {
      if ((await evaluate(placeScript(fileName))) !== true) throw new StudioCdpError(`no media card named ${fileName} to place`)
      await sleep(1_000)
    },
    screenshot: async (file) => {
      const shot = z.object({ data: z.string() }).parse(await send('Page.captureScreenshot', { format: 'png' }))
      writeFileSync(file, Buffer.from(shot.data, 'base64'))
    },
    drain: async () => {
      const toasts = z.array(z.string()).parse(await evaluate(TOAST_DRAIN))
      return { toasts, consoleErrors: consoleErrors.splice(0) }
    },
    close: () => socket.close(),
  }
}
