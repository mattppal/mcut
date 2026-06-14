import { readFile, writeFile } from 'node:fs/promises'
import { parseProject, type Project } from '@mcut/timeline'
import type { TranscriptResult } from '@mcut/transcription'
import { z } from 'zod'

export async function readProjectFile(path: string): Promise<Project> {
  return parseProject(JSON.parse(await readFile(path, 'utf8')))
}

export async function writeProjectFile(path: string, project: Project): Promise<void> {
  await writeFile(path, `${JSON.stringify(project, null, 2)}\n`, 'utf8')
}

/**
 * Lenient validation for transcript JSON (providers normalize to
 * TranscriptResult, but hand-made files often carry only `words`).
 */
export const transcriptSchema = z.object({
  text: z.string().default(''),
  language: z.string().optional(),
  durationMs: z.number().optional(),
  words: z
    .array(
      z.object({
        text: z.string(),
        startMs: z.number(),
        endMs: z.number(),
        confidence: z.number().optional(),
        speaker: z.string().optional(),
      }),
    )
    .default([]),
  segments: z
    .array(
      z.object({
        text: z.string(),
        startMs: z.number(),
        endMs: z.number(),
        speaker: z.string().optional(),
      }),
    )
    .default([]),
})

export async function readTranscriptFile(path: string): Promise<TranscriptResult> {
  return transcriptSchema.parse(JSON.parse(await readFile(path, 'utf8')))
}
