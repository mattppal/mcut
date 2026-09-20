export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface SurfaceCapture {
  root: Record<string, string>
  tree: string[]
  regions: Record<string, Rect | null>
  styles: Record<string, string>
}

export interface PixelDiff {
  mismatch: number
  diffPng: string
}

const TREE_ATTRIBUTES = ['data-slot', 'role', 'aria-label', 'aria-pressed', 'data-rail-tab', 'data-state', 'type', 'title', 'placeholder']

const REGION_SELECTORS: Record<string, string> = {
  toolbar: '[data-slot="editor-toolbar"]',
  'toolbar.main-menu': '[aria-label="Main menu"]',
  'toolbar.undo': '[aria-label="Undo"]',
  'toolbar.project-name': '[aria-label="Project name"]',
  'toolbar.theme': '[aria-label="Toggle theme"]',
  rail: '[data-rail-tab="media"]',
  'panel.left': '[data-slot="resizable-panel"]:nth-of-type(1)',
  player: '[data-mcut-player]',
  timeline: '[data-mcut-timeline]',
  lane: '[data-mcut-lane]',
  clip: '[data-mcut-clip]',
}

const STYLE_PROBES: Array<[string, string, string[]]> = [
  ['root', '[data-editor]', ['font-family', 'font-size', 'background-color', 'color']],
  ['toolbar', '[data-slot="editor-toolbar"]', ['padding-left', 'padding-right', 'height', 'background-color']],
  ['player', '[data-mcut-player]', ['background-color']],
]

export interface CaptureConfig {
  attributes: string[]
  regions: Record<string, string>
  probes: Array<[string, string, string[]]>
  omissions: Array<{ id: string; selector: string }>
}

export function captureSurface(config: CaptureConfig): SurfaceCapture {
  const editor = document.querySelector('[data-editor]')
  if (!(editor instanceof HTMLElement)) throw new Error('no [data-editor] root in the document')
  const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'NOSCRIPT', 'NEXT-ROUTE-ANNOUNCER', 'CANVAS', 'VIDEO'])
  const tree: string[] = []
  const walk = (node: Element, depth: number) => {
    if (skip.has(node.tagName)) return
    const omission = config.omissions.find((candidate) => node.matches(candidate.selector))
    if (omission) {
      tree.push(`${'  '.repeat(depth)}<omitted ${omission.id}>`)
      return
    }
    const attrs = config.attributes
      .filter((name) => node.hasAttribute(name))
      .map((name) => `${name}=${JSON.stringify(node.getAttribute(name))}`)
      .join(' ')
    tree.push(`${'  '.repeat(depth)}${node.tagName.toLowerCase()}${attrs ? ` ${attrs}` : ''}`)
    if (node.tagName === 'svg') return
    for (const child of node.children) walk(child, depth + 1)
  }
  for (const child of document.body.children) walk(child, 0)

  const html = document.documentElement
  const root: Record<string, string> = {}
  for (const name of ['data-window-chrome', 'data-editor', 'class']) root[name] = html.getAttribute(name) ?? ''

  const origin = editor.getBoundingClientRect()
  const regions: Record<string, Rect | null> = {}
  for (const [name, selector] of Object.entries(config.regions)) {
    const element = document.querySelector(selector)
    if (element === null) {
      regions[name] = null
      continue
    }
    const box = element.getBoundingClientRect()
    regions[name] = { x: Math.round(box.left - origin.left), y: Math.round(box.top - origin.top), w: Math.round(box.width), h: Math.round(box.height) }
  }
  const rail = document.querySelector('[data-rail-tab="media"]')?.parentElement
  if (rail) {
    const box = rail.getBoundingClientRect()
    regions.rail = { x: Math.round(box.left - origin.left), y: Math.round(box.top - origin.top), w: Math.round(box.width), h: Math.round(box.height) }
  }
  const panels = document.querySelectorAll('[data-slot="resizable-panel"]')
  panels.forEach((panel, index) => {
    const box = panel.getBoundingClientRect()
    regions[`panel.${index}`] = {
      x: Math.round(box.left - origin.left),
      y: Math.round(box.top - origin.top),
      w: Math.round(box.width),
      h: Math.round(box.height),
    }
  })

  const styles: Record<string, string> = {}
  for (const [name, selector, props] of config.probes) {
    const element = document.querySelector(selector)
    if (element === null) continue
    const computed = getComputedStyle(element)
    for (const prop of props) styles[`${name}.${prop}`] = computed.getPropertyValue(prop)
  }
  return { root, tree, regions, styles }
}

export function captureConfig(omissions: ReadonlyArray<{ id: string; selector?: string }>): CaptureConfig {
  const withSelector: Array<{ id: string; selector: string }> = []
  for (const omission of omissions) {
    if (omission.selector !== undefined) withSelector.push({ id: omission.id, selector: omission.selector })
  }
  return { attributes: TREE_ATTRIBUTES, regions: REGION_SELECTORS, probes: STYLE_PROBES, omissions: withSelector }
}

export async function comparePixels(images: { a: string; b: string; threshold: number }): Promise<PixelDiff> {
  const load = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('could not decode a screenshot'))
      image.src = src
    })
  const [a, b] = await Promise.all([load(images.a), load(images.b)])
  const width = Math.min(a.width, b.width)
  const height = Math.min(a.height, b.height)
  const read = (image: HTMLImageElement) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('no 2d context')
    context.drawImage(image, 0, 0)
    return context.getImageData(0, 0, width, height)
  }
  const pixelsA = read(a)
  const pixelsB = read(b)
  const diff = document.createElement('canvas')
  diff.width = width
  diff.height = height
  const context = diff.getContext('2d')
  if (context === null) throw new Error('no 2d context')
  const out = context.createImageData(width, height)
  let mismatched = 0
  for (let index = 0; index < out.data.length; index += 4) {
    const delta = Math.max(
      Math.abs((pixelsA.data[index] ?? 0) - (pixelsB.data[index] ?? 0)),
      Math.abs((pixelsA.data[index + 1] ?? 0) - (pixelsB.data[index + 1] ?? 0)),
      Math.abs((pixelsA.data[index + 2] ?? 0) - (pixelsB.data[index + 2] ?? 0)),
    )
    const same = delta <= images.threshold
    if (!same) mismatched += 1
    const grey = Math.round((pixelsA.data[index] ?? 0) * 0.3 + (pixelsA.data[index + 1] ?? 0) * 0.59 + (pixelsA.data[index + 2] ?? 0) * 0.11)
    out.data[index] = same ? grey : 255
    out.data[index + 1] = same ? grey : 0
    out.data[index + 2] = same ? grey : 64
    out.data[index + 3] = same ? 96 : 255
  }
  context.putImageData(out, 0, 0)
  return { mismatch: mismatched / (width * height), diffPng: diff.toDataURL('image/png') }
}
