import { readFile, writeFile } from 'node:fs/promises'
import { parseProject, type Project } from '@mcut/timeline'
import { transcriptResultSchema, type TranscriptResult } from '@mcut/transcription'

export async function readProjectFile(path: string): Promise<Project> {
  return parseProject(JSON.parse(await readFile(path, 'utf8')))
}

export async function writeProjectFile(path: string, project: Project): Promise<void> {
  await writeFile(path, `${JSON.stringify(project, null, 2)}\n`, 'utf8')
}

export async function readTranscriptFile(path: string): Promise<TranscriptResult> {
  return transcriptResultSchema.parse(JSON.parse(await readFile(path, 'utf8')))
}
