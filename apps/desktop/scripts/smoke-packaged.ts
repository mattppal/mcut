import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import { z } from 'zod'

const USAGE = 'usage: node apps/desktop/scripts/smoke-packaged.ts <packaged binary>   (or set MCUT_ELECTRON_PATH)'
const QUIT_TIMEOUT_MS = 5_000

const desktopDir = path.resolve(import.meta.dirname, '..')
const repoRoot = path.resolve(desktopDir, '../..')
const fixture = path.join(repoRoot, 'apps/studio/e2e/fixtures/fixture-vp9.mkv')
const fixtureName = path.basename(fixture)

const packageSchema = z.object({ version: z.string() })
const statusSchema = z.object({ ok: z.literal(true), result: z.object({ connected: z.boolean() }) })
const appFactsSchema = z.object({ version: z.string(), packaged: z.boolean() })

type DownloadItemLike = {
  getFilename(): string
  setSavePath(target: string): void
  once(event: 'done', listener: (event: unknown, state: string) => void): void
}

function binaryPath(): string {
  const candidate = process.argv[2] ?? process.env.MCUT_ELECTRON_PATH
  if (candidate === undefined || candidate.length === 0) {
    console.error(USAGE)
    process.exit(2)
  }
  return path.resolve(candidate)
}

function ok(observed: string): void {
  console.log(`ok   ${observed}`)
}

function check(condition: boolean, observed: string): void {
  if (!condition) throw new Error(`assertion failed: ${observed}`)
  ok(observed)
}

async function poll<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last = await read()
  while (!accept(last) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    last = await read()
  }
  return last
}

function launchEnvironment(configHome: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  env.XDG_CONFIG_HOME = configHome
  return env
}

function bridgePort(page: Page): number {
  const port = Number(new URL(page.url()).searchParams.get('mcpBridge'))
  if (!Number.isInteger(port) || port <= 0) throw new Error(`window URL ${page.url()} names no bridge port`)
  return port
}

async function readStatus(port: number): Promise<boolean> {
  const response = await fetch(`http://127.0.0.1:${port}/status`)
  const body: unknown = await response.json()
  return statusSchema.parse(body).result.connected
}

function nextDownload(app: ElectronApplication, dir: string, timeoutMs: number): Promise<string> {
  return app.evaluate(
    ({ session }, options) =>
      new Promise<string>((resolve, reject) => {
        const onDownload = (_event: unknown, item: DownloadItemLike) => {
          clearTimeout(timer)
          session.defaultSession.off('will-download', onDownload)
          const target = `${options.dir}/${item.getFilename()}`
          item.setSavePath(target)
          item.once('done', (_done, state) => (state === 'completed' ? resolve(target) : reject(new Error(`download ${state}`))))
        }
        const timer = setTimeout(() => {
          session.defaultSession.off('will-download', onDownload)
          reject(new Error(`no download started within ${options.timeoutMs} ms`))
        }, options.timeoutMs)
        session.defaultSession.on('will-download', onDownload)
      }),
    { dir, timeoutMs },
  )
}

async function importAndExport(app: ElectronApplication, page: Page, dir: string): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(fixture)
  const card = page.getByTitle(fixtureName).first()
  await card.waitFor({ state: 'visible', timeout: 15_000 })
  await card.getByText('0:02', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
  ok(`imported ${fixtureName}, media card shows the 0:02 duration badge`)

  await card.dblclick()
  const clips = await poll(
    () => page.locator('[data-mcut-clip]').count(),
    (count) => count === 1,
    15_000,
  )
  check(clips === 1, `timeline shows ${clips} clip after double-clicking the card`)

  await page.locator('[data-mcut-export-trigger]').click()
  await page.getByRole('dialog').getByText('Export video', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
  await page.getByRole('button', { name: 'WebM', exact: true }).click()
  const exportButton = page.getByRole('button', { name: 'Export WebM' })
  await exportButton.waitFor({ state: 'visible', timeout: 10_000 })
  const download = nextDownload(app, dir, 120_000)
  await exportButton.click()
  const file = await download
  const bytes = (await stat(file)).size
  check(bytes > 0, `exported ${path.basename(file)} with ${bytes} bytes`)
}

async function quitCleanly(app: ElectronApplication): Promise<void> {
  const child = app.process()
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), QUIT_TIMEOUT_MS))
  const started = performance.now()
  const quitRequest = app
    .evaluate(({ app: electronApp }) => electronApp.quit())
    .then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    )
  const outcome = await Promise.race([exited, timeout])
  if (outcome === 'timeout') {
    const failure = await quitRequest
    child.kill('SIGKILL')
    throw new Error(`process still alive ${QUIT_TIMEOUT_MS} ms after app.quit()${failure === null ? '' : ` (${failure})`}`)
  }
  ok(`process exited with code ${outcome} ${Math.round(performance.now() - started)} ms after app.quit()`)
}

async function main(): Promise<void> {
  const executablePath = binaryPath()
  const expectedVersion = packageSchema.parse(JSON.parse(await readFile(path.join(desktopDir, 'package.json'), 'utf8'))).version
  const dir = await mkdtemp(path.join(tmpdir(), 'mcut-smoke-'))
  const configHome = path.join(dir, 'config')

  const launchStarted = performance.now()
  const app = await _electron.launch({
    executablePath,
    args: ['--port', '0'],
    cwd: repoRoot,
    env: launchEnvironment(configHome),
    chromiumSandbox: true,
  })
  let quit = false
  try {
    const page = await app.firstWindow()
    await page.waitForURL(/^app:\/\/studio\/editor\?/)
    await page.getByRole('button', { name: 'Go to start' }).waitFor({ state: 'visible', timeout: 60_000 })
    const launchMs = Math.round(performance.now() - launchStarted)
    console.log(`LAUNCH_MS ${launchMs}`)
    const url = new URL(page.url())
    ok(`editor window at ${url.protocol}//${url.host}${url.pathname} interactive ${launchMs} ms after spawn`)

    const port = bridgePort(page)
    const connected = await poll(
      () => readStatus(port),
      (value) => value,
      15_000,
    )
    check(connected, `GET http://127.0.0.1:${port}/status reports connected: ${connected}`)

    const discard = page.getByRole('button', { name: 'Discard' })
    if (await discard.isVisible()) await discard.click()
    const name = await page.getByLabel('Project name').inputValue()
    check(name === 'Untitled', `project name input reads "${name}"`)

    await importAndExport(app, page, dir)

    const facts = appFactsSchema.parse(await app.evaluate(({ app: electronApp }) => ({ version: electronApp.getVersion(), packaged: electronApp.isPackaged })))
    check(facts.version === expectedVersion, `app.getVersion() is ${facts.version}, package.json says ${expectedVersion}`)
    check(facts.packaged, `app.isPackaged is ${facts.packaged}`)

    await quitCleanly(app)
    quit = true
    console.log('RESULT PASS')
  } finally {
    if (!quit) await app.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
  console.log('RESULT FAIL')
  process.exit(1)
})
