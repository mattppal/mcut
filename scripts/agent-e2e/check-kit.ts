import type { MulticamElement, Project, TimelineElement } from '@mcut/timeline'
import type { ToolCall } from './types'

export interface CheckInput {
  before: Project
  after: Project
  calls: ToolCall[]
}

export interface CheckResult {
  check: string
  pass: boolean
  detail: string
}

export interface Outcome {
  pass: boolean
  detail: string
}

export type Test = (input: CheckInput, match: RegExpExecArray) => Outcome

export type CheckRule = [RegExp, Test]

export const elements = (project: Project): TimelineElement[] => project.tracks.flatMap((track) => track.elements)

export const ofType = <T extends TimelineElement['type']>(project: Project, type: T): Extract<TimelineElement, { type: T }>[] =>
  elements(project).filter((element): element is Extract<TimelineElement, { type: T }> => element.type === type)

export const seconds = (ms: number): string => `${(ms / 1000).toFixed(2)}s`

export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

export const outcome = (pass: boolean, yes: string, no: string): Outcome => ({ pass, detail: pass ? yes : no })

export function multicamOf(project: Project): MulticamElement | undefined {
  return ofType(project, 'multicam')[0]
}

export function sourceAssetName(project: Project, multicam: MulticamElement, key: string | undefined): string {
  const source = multicam.sources.find((entry) => entry.key === key)
  return source === undefined ? `no source "${key}"` : (project.assets[source.assetId]?.name ?? source.assetId)
}
