import type { Frame, Page } from '@playwright/test'
import type { FeatureId, Surface } from './features.ts'

export type View = Page | Frame

export const pageOf = (view: View): Page => ('mouse' in view ? view : view.page())
export const mouseOf = (view: View) => pageOf(view).mouse
export const keyboardOf = (view: View) => pageOf(view).keyboard

export type WhisperNetwork = { mode: 'real' } | { mode: 'mirror'; url: string } | { mode: 'offline'; reason: string }

export interface Download {
  path: string
  bytes: number
}

export interface Fixtures {
  clip: string
  speech: string
  image: string
}

export interface SurfaceContext {
  surface: Surface
  page: Page
  view: View
  fixtures: Fixtures
  outDir: string
  whisper: WhisperNetwork
  assemblyAiKey: string | null
  importFile(file: string): Promise<void>
  nextDownload(timeoutMs: number): Promise<Download>
  stubOpenDialog(file: string): Promise<void>
  stubSaveDialog(file: string): Promise<void>
  upstreamRequests(): Promise<string[]>
  log(line: string): void
}

export type DriverResult = { kind: 'pass'; observed: string } | { kind: 'blocked'; reason: string }

export type Driver = (ctx: SurfaceContext) => Promise<DriverResult>

export const pass = (observed: string): DriverResult => ({ kind: 'pass', observed })
export const blocked = (reason: string): DriverResult => ({ kind: 'blocked', reason })

export function check(condition: boolean, observed: string): string {
  if (!condition) throw new Error(`assertion failed: ${observed}`)
  return observed
}

export async function poll<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last = await read()
  while (!accept(last) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    last = await read()
  }
  return last
}

export type Outcome =
  | { status: 'pass'; observed: string; screenshot: string | null; ms: number }
  | { status: 'fail'; error: string; screenshot: string | null; ms: number }
  | { status: 'blocked'; reason: string; screenshot: string | null; ms: number }
  | { status: 'unsupported'; reason: string }
  | { status: 'missing-driver' }

export interface Row {
  feature: FeatureId
  surface: Surface
  outcome: Outcome
}

export interface Report {
  surface: Surface
  tier: string
  target: string
  startedAt: string
  whisper: WhisperNetwork
  rows: Row[]
  pageErrors: string[]
}

export function statusOf(outcome: Outcome): Outcome['status'] {
  return outcome.status
}

export function summarize(rows: readonly Row[]): Record<Outcome['status'], number> {
  const counts: Record<Outcome['status'], number> = { pass: 0, fail: 0, blocked: 0, unsupported: 0, 'missing-driver': 0 }
  for (const row of rows) counts[row.outcome.status] += 1
  return counts
}

export function describe(outcome: Outcome): string {
  switch (outcome.status) {
    case 'pass':
      return outcome.observed
    case 'fail':
      return outcome.error
    case 'blocked':
      return outcome.reason
    case 'unsupported':
      return outcome.reason
    case 'missing-driver':
      return 'no driver'
    default: {
      const exhaustive: never = outcome
      return exhaustive
    }
  }
}
