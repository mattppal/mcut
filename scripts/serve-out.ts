import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: { type: 'string', default: '3123' },
    dir: { type: 'string', default: path.join(import.meta.dirname, '../apps/studio/out') },
  },
})

const root = path.resolve(values.dir)
const port = Number(values.port)

if (!existsSync(root)) {
  throw new Error(`${root} does not exist. Run "bun run --cwd apps/studio build" first.`)
}

function isFile(candidate: string): boolean {
  return existsSync(candidate) && statSync(candidate).isFile()
}

function resolveFile(pathname: string): string | undefined {
  const target = path.resolve(root, `.${decodeURIComponent(pathname)}`)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return undefined
  const candidates = [target, `${target}.html`, path.join(target, 'index.html')]
  return candidates.find(isFile)
}

const server = Bun.serve({
  port,
  fetch(request) {
    const file = resolveFile(new URL(request.url).pathname)
    if (file) return new Response(Bun.file(file))
    const notFound = path.join(root, '404.html')
    return new Response(isFile(notFound) ? Bun.file(notFound) : 'Not found', { status: 404 })
  },
})

console.log(`serving ${root} at ${server.url}`)
