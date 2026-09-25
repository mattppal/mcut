import { existsSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, extname, isAbsolute, join, parse } from 'node:path'
import { LiveBridgeError } from './bridge-error'
import { exportFormatSchema, type ExportFormat } from './export-protocol'

const UNSAFE_FILENAME_CHARACTERS = /[<>:"/\\|?*]/g

function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false
}

export function defaultExportDir(): string {
  const downloads = join(homedir(), 'Downloads')
  return isDirectory(downloads) ? downloads : tmpdir()
}

export function checkOutputPath(path: string, format: ExportFormat | undefined): { path: string; format: ExportFormat | undefined } {
  if (!isAbsolute(path)) throw new LiveBridgeError('invalid-output-path', `outputPath must be absolute, got ${path}.`)
  if (!isDirectory(dirname(path))) throw new LiveBridgeError('invalid-output-path', `The folder ${dirname(path)} does not exist.`)
  if (isDirectory(path)) throw new LiveBridgeError('invalid-output-path', `${path} is a folder. Pass a file path inside it.`)
  const implied = exportFormatSchema.safeParse(extname(path).slice(1).toLowerCase())
  if (!implied.success) return { path, format }
  if (format !== undefined && format !== implied.data) {
    throw new LiveBridgeError('invalid-output-path', `outputPath ends in .${implied.data} but format is ${format}.`)
  }
  return { path, format: implied.data }
}

function safeFilename(filename: string, format: ExportFormat): string {
  const cleaned = filename.replace(UNSAFE_FILENAME_CHARACTERS, '_').trim()
  return cleaned === '' || cleaned.startsWith('.') ? `export.${format}` : cleaned
}

export async function freeExportPath(directory: string, filename: string, format: ExportFormat): Promise<string> {
  await mkdir(directory, { recursive: true })
  const { name, ext } = parse(safeFilename(filename, format))
  for (let copy = 1; ; copy += 1) {
    const path = join(directory, copy === 1 ? `${name}${ext}` : `${name} (${copy})${ext}`)
    if (!existsSync(path) && !existsSync(`${path}.part`)) return path
  }
}
