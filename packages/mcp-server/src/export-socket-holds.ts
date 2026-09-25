import { EventEmitter } from 'node:events'

function closable(value: unknown): value is { close: (code?: number, reason?: string) => void; constructor: { name: string } } {
  if (typeof value !== 'object' || value === null || !('close' in value)) return false
  return typeof value.close === 'function'
}

function captureEmit(): { restore: () => void; original: EventEmitter['emit'] } {
  const original = EventEmitter.prototype.emit
  return {
    original,
    restore: () => {
      EventEmitter.prototype.emit = original
    },
  }
}

export function holdReplacedClose(): { release: () => void; restore: () => void } {
  const queued: Array<() => void> = []
  const captured = captureEmit()
  EventEmitter.prototype.emit = function (this: EventEmitter, event: string | symbol, ...args: unknown[]): boolean {
    const socket = args[0]
    if (event === 'connection' && closable(socket) && socket.constructor.name !== 'Socket') {
      const target = socket
      const close = target.close
      target.close = (code?: number, reason?: string) => {
        queued.push(() => close.call(target, code, reason))
      }
    }
    return Reflect.apply(captured.original, this, [event, ...args]) === true
  }
  const flush = () => {
    for (const run of queued.splice(0)) run()
  }
  return {
    release: () => {
      if (queued.length === 0) throw new Error('The replaced tab was not closed.')
      flush()
    },
    restore: () => {
      flush()
      captured.restore()
    },
  }
}

export function holdSocketCloses(): { held: Promise<void>; release: () => void; restore: () => void } {
  const queued: Array<() => void> = []
  let markHeld = () => {}
  const held = new Promise<void>((resolve) => {
    markHeld = resolve
  })
  let holding = true
  const captured = captureEmit()
  EventEmitter.prototype.emit = function (this: EventEmitter, event: string | symbol, ...args: unknown[]): boolean {
    if (holding && event === 'close' && this.constructor.name === 'BunWebSocketMocked') {
      const emitter = this
      queued.push(() => {
        Reflect.apply(captured.original, emitter, [event, ...args])
      })
      markHeld()
      return true
    }
    return Reflect.apply(captured.original, this, [event, ...args]) === true
  }
  const flush = () => {
    holding = false
    for (const run of queued.splice(0)) run()
  }
  return {
    held,
    release: () => {
      if (queued.length === 0) throw new Error('The replaced tab did not close.')
      flush()
    },
    restore: () => {
      flush()
      captured.restore()
    },
  }
}
