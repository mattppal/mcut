import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Browser, Page } from '@playwright/test'

type StepRecord = { step: string; screenshot: string; observed: string }

type Report = {
  status: 'PASS' | 'ISSUES' | 'FAIL'
  editorUrl: string
  fixture: string
  steps: StepRecord[]
  issues: string[]
  download: { path: string; bytes: number } | null
  pageErrors: string[]
}

type PreviewFrame = { lit: number; hash: number }

const skillDir = path.resolve(import.meta.dir, '..')
const repoRoot = path.resolve(skillDir, '../../..')
const studioDir = path.join(repoRoot, 'apps/studio')
const fixture = path.join(studioDir, 'e2e/fixtures/fixture-vp9.mkv')
const fixtureName = path.basename(fixture)
const projectName = 'verify-studio'

function editorUrl(): string {
  const configured = process.env.MCUT_EDITOR_URL
  if (configured) return configured
  const port = process.env.MCUT_STUDIO_PORT ?? '3000'
  return `http://localhost:${port}/editor`
}

function outDir(): string {
  const arg = process.argv[2]
  if (!arg) {
    console.error('usage: bun .cursor/skills/verify-studio/scripts/drive.ts <outdir>')
    process.exit(2)
  }
  return path.resolve(arg)
}

function check(condition: boolean, observed: string): string {
  if (!condition) throw new Error(`assertion failed: ${observed}`)
  return observed
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

async function launch(): Promise<Browser> {
  const playwright = (await import(Bun.resolveSync('@playwright/test', studioDir))) as typeof import('@playwright/test')
  return playwright.chromium.launch({
    headless: process.env.MCUT_VERIFY_HEADED !== '1',
    executablePath: process.env.MCUT_CHROME_PATH,
  })
}

const timecode = (page: Page) => page.locator('[data-mcut-timeline] .text-primary').first().innerText()

function parseTimecode(text: string): number {
  const match = /^(\d+):(\d\d)\.(\d)$/.exec(text.trim())
  if (!match) throw new Error(`timecode "${text}" does not match m:ss.t`)
  return Number(match[1]) * 60_000 + Number(match[2]) * 1_000 + Number(match[3]) * 100
}

const previewFrame = (page: Page): Promise<PreviewFrame> =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-mcut-player] canvas')
    if (!canvas) return { lit: -1, hash: 0 }
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let lit = 0
    let hash = 0
    for (let i = 0; i < data.length; i += 64) {
      if (data[i]! > 60 || data[i + 1]! > 60 || data[i + 2]! > 60) lit++
      hash = (hash * 31 + data[i]! + data[i + 1]! + data[i + 2]!) | 0
    }
    return { lit, hash }
  })

const filmstripPixels = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-mcut-clip=video] canvas')
    if (!canvas) return -1
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let lit = 0
    for (let i = 0; i < data.length; i += 16) {
      if (data[i]! > 30 || data[i + 1]! > 30 || data[i + 2]! > 30) lit++
    }
    return lit
  })

async function dragCardToLane(page: Page): Promise<void> {
  const card = page.getByTitle(fixtureName).first()
  const cardBox = (await card.boundingBox())!
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(cardBox.x + 70, cardBox.y + 90, { steps: 5 })
  await page.waitForTimeout(200)
  const laneBox = (await page.locator('[data-mcut-lane]').first().boundingBox())!
  const targetX = laneBox.x + 120
  const targetY = laneBox.y + laneBox.height / 2
  await page.mouse.move(targetX, targetY, { steps: 10 })
  await page.mouse.move(targetX + 1, targetY + 1)
  await page.waitForTimeout(200)
  await page.mouse.up()
  await page.waitForTimeout(300)
}

async function scrubInsideClip(page: Page): Promise<void> {
  const clipBox = (await page.locator('[data-mcut-clip]').first().boundingBox())!
  const ruler = page.locator('div.cursor-col-resize.bg-card').first()
  const rulerBox = (await ruler.boundingBox())!
  const y = rulerBox.y + rulerBox.height / 2
  await page.mouse.move(clipBox.x + clipBox.width * 0.1, y)
  await page.mouse.down()
  await page.mouse.move(clipBox.x + clipBox.width * 0.3, y, { steps: 12 })
  await page.mouse.up()
}

async function main(): Promise<void> {
  const dir = outDir()
  await mkdir(dir, { recursive: true })
  const report: Report = {
    status: 'PASS',
    editorUrl: editorUrl(),
    fixture,
    steps: [],
    issues: [],
    download: null,
    pageErrors: [],
  }

  const browser = await launch()
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })
  const page = await context.newPage()
  page.on('pageerror', (error) => report.pageErrors.push(error.message))

  let index = 0
  const step = async (name: string, run: () => Promise<string>): Promise<void> => {
    index += 1
    const file = path.join(dir, `${String(index).padStart(2, '0')}-${name}.png`)
    try {
      const observed = await run()
      await page.screenshot({ path: file })
      report.steps.push({ step: name, screenshot: file, observed })
      console.log(`ok   ${name}: ${observed}`)
    } catch (error) {
      await page.screenshot({ path: file }).catch(() => {})
      const message = error instanceof Error ? error.message : String(error)
      report.steps.push({ step: name, screenshot: file, observed: `FAILED: ${message}` })
      console.log(`fail ${name}: ${message}`)
      throw error
    }
  }

  try {
    await step('open-editor', async () => {
      await page.goto(report.editorUrl, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'Go to start' }).waitFor({ state: 'visible', timeout: 30_000 })
      await page
        .getByRole('button', { name: 'Discard' })
        .click({ timeout: 1_500 })
        .catch(() => {})
      const name = await page.getByLabel('Project name').inputValue()
      return check(name === 'Untitled', `project name input reads "${name}"`)
    })

    await step('name-project', async () => {
      const input = page.getByLabel('Project name')
      await input.fill(projectName)
      const name = await input.inputValue()
      return check(name === projectName, `project name input reads "${name}"`)
    })

    await step('import-clip', async () => {
      await page.locator('input[type="file"]').setInputFiles(fixture)
      const card = page.getByTitle(fixtureName).first()
      await card.waitFor({ state: 'visible', timeout: 15_000 })
      const title = await card.getAttribute('title')
      check(title?.startsWith(fixtureName) === true, `media card title is "${title}"`)
      const badge = card.getByText('0:02', { exact: true })
      await badge.waitFor({ state: 'visible', timeout: 15_000 })
      return `media card titled "${fixtureName}" shows duration badge "${await badge.innerText()}"`
    })

    await step('add-clip-to-timeline', async () => {
      await dragCardToLane(page)
      const clips = await page.locator('[data-mcut-clip]').count()
      check(clips === 1, `timeline shows ${clips} clip(s)`)
      const lit = await poll(() => filmstripPixels(page), (value) => value > 100, 15_000)
      return check(lit > 100, `1 clip on the timeline, filmstrip canvas has ${lit} lit samples`)
    })

    await step('scrub-playhead', async () => {
      await page.getByRole('button', { name: 'Go to start' }).click()
      const start = await timecode(page)
      check(start === '0:00.0', `timecode after Go to start reads "${start}"`)
      await scrubInsideClip(page)
      const scrubbed = await timecode(page)
      check(scrubbed !== '0:00.0', `timecode after scrub reads "${scrubbed}"`)
      const scrubFrame = await poll(() => previewFrame(page), (frame) => frame.lit > 100, 15_000)
      check(scrubFrame.lit > 100, `preview canvas has ${scrubFrame.lit} lit samples after scrub`)
      await page.keyboard.press('Shift+ArrowRight')
      const nudged = await poll(() => timecode(page), (value) => value !== scrubbed, 3_000)
      const delta = parseTimecode(nudged) - parseTimecode(scrubbed)
      check(delta === 1_000, `timecode moved from "${scrubbed}" to "${nudged}" after Shift+ArrowRight`)
      const nudgeFrame = await poll(
        () => previewFrame(page),
        (frame) => frame.lit > 100 && frame.hash !== scrubFrame.hash,
        15_000,
      )
      return check(
        nudgeFrame.lit > 100 && nudgeFrame.hash !== scrubFrame.hash,
        `timecode "${start}" then "${scrubbed}" after scrub then "${nudged}" after Shift+ArrowRight, preview repainted with ${nudgeFrame.lit} lit samples`,
      )
    })

    await step('open-export-dialog', async () => {
      await page.locator('[data-mcut-export-trigger]').click()
      const title = page.getByRole('dialog').getByText('Export video', { exact: true })
      await title.waitFor({ state: 'visible', timeout: 10_000 })
      await page.getByRole('button', { name: 'WebM', exact: true }).click()
      const exportButton = page.getByRole('button', { name: 'Export WebM' })
      await exportButton.waitFor({ state: 'visible', timeout: 10_000 })
      return check(await exportButton.isVisible(), 'dialog title "Export video" and button "Export WebM" are visible')
    })

    await step('export-webm', async () => {
      const unsupported = page.getByText("This browser can't encode")
      const blocked = await unsupported.isVisible({ timeout: 2_000 }).catch(() => false)
      if (blocked) {
        const text = await unsupported.innerText()
        report.issues.push(`export unsupported in this browser: ${text}`)
        return `dialog shows "${text}"`
      }
      const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
      await page.getByRole('button', { name: 'Export WebM' }).click()
      const download = await downloadPromise
      const target = path.join(dir, download.suggestedFilename())
      await download.saveAs(target)
      const bytes = (await stat(target)).size
      report.download = { path: target, bytes }
      const mode = await page.evaluate(() => (globalThis as { __mcutLastExportMode?: string }).__mcutLastExportMode)
      await page.getByRole('button', { name: 'Export WebM' }).waitFor({ state: 'visible', timeout: 10_000 })
      return check(bytes > 0, `downloaded ${download.suggestedFilename()} with ${bytes} bytes, export mode ${mode ?? 'unknown'}`)
    })

    await step('close-export-dialog', async () => {
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click()
      await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 10_000 })
      const clips = await page.locator('[data-mcut-clip]').count()
      return check(clips === 1, `export dialog closed, timeline still shows ${clips} clip(s)`)
    })
  } catch {
    report.status = 'FAIL'
  } finally {
    await browser.close()
  }

  if (report.status !== 'FAIL' && (report.issues.length > 0 || report.pageErrors.length > 0)) report.status = 'ISSUES'
  for (const message of report.pageErrors) report.issues.push(`page error: ${message}`)
  await writeFile(path.join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`\nscreenshots: ${report.steps.length}`)
  for (const issue of report.issues) console.log(`issue: ${issue}`)
  console.log(`report: ${path.join(dir, 'report.json')}`)
  console.log(`RESULT ${report.status}`)
  process.exit(report.status === 'FAIL' ? 1 : 0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
