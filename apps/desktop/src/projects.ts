import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DesktopError, type InvokeHandlers } from '@mcut/desktop-ipc'
import { ProjectFormatError, parseProject, type Project } from '@mcut/timeline'
import { BrowserWindow, app, dialog, type FileFilter, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { z } from 'zod'

const PROJECT_EXTENSION = '.mcut.json'

const PROJECT_FILTERS: FileFilter[] = [{ name: 'mcut project', extensions: ['mcut.json', 'json'] }]

export type ProjectHandlers = Pick<InvokeHandlers, 'project.open' | 'project.save'>

function projectFileName(project: Project): string {
  const slug = (project.name || 'untitled').trim().replace(/[\\/:*?"<>|]+/g, '-')
  return `${slug}${PROJECT_EXTENSION}`
}

function withProjectExtension(file: string): string {
  return file.endsWith('.json') ? file : `${file}${PROJECT_EXTENSION}`
}

function ownerWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function chooseSavePath(project: Project): Promise<string> {
  const options: SaveDialogOptions = { defaultPath: path.join(app.getPath('documents'), projectFileName(project)), filters: PROJECT_FILTERS }
  const window = ownerWindow()
  const result = window === undefined ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(window, options)
  if (result.canceled || result.filePath.length === 0) throw new DesktopError('cancelled', 'Save cancelled.')
  return withProjectExtension(result.filePath)
}

async function chooseOpenPath(): Promise<string> {
  const options: OpenDialogOptions = { properties: ['openFile'], filters: PROJECT_FILTERS }
  const window = ownerWindow()
  const result = window === undefined ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options)
  const [file] = result.filePaths
  if (result.canceled || file === undefined) throw new DesktopError('cancelled', 'Open cancelled.')
  return file
}

function writeProjectFile(file: string, project: Project): void {
  const part = `${file}.part`
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(part, `${JSON.stringify(project, null, 2)}\n`)
    renameSync(part, file)
  } catch (error) {
    throw new DesktopError('io', `Could not write ${file}. ${failureMessage(error)}`)
  }
}

function readProjectFile(file: string): Project {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) throw new DesktopError('not-found', `${file} does not exist.`)
    throw new DesktopError('io', `Could not read ${file}. ${failureMessage(error)}`)
  }
  try {
    return parseProject(JSON.parse(text))
  } catch (error) {
    if (error instanceof z.ZodError) throw new DesktopError('io', `${path.basename(file)} is not a valid mcut project. ${z.prettifyError(error)}`)
    if (error instanceof ProjectFormatError || error instanceof SyntaxError) {
      throw new DesktopError('io', `${path.basename(file)} is not a valid mcut project. ${error.message}`)
    }
    throw error
  }
}

export const projectHandlers: ProjectHandlers = {
  'project.open': async () => {
    const file = await chooseOpenPath()
    return { project: readProjectFile(file), path: file }
  },
  'project.save': async ({ project, path: requested }) => {
    const file = requested ?? (await chooseSavePath(project))
    writeProjectFile(file, project)
    return { path: file }
  },
}
