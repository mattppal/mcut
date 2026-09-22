import type { Fixtures, SurfaceContext, WhisperNetwork } from '../context.ts'

export interface OpenOptions {
  fixtures: Fixtures
  outDir: string
  whisper: WhisperNetwork
  assemblyAiKey: string | null
  electronPath: string | null
  log(line: string): void
}

export interface SurfaceHandle {
  ctx: SurfaceContext
  target: string
  pageErrors: string[]
  close(): Promise<void>
}

export type OpenSurface = (options: OpenOptions) => Promise<SurfaceHandle>
