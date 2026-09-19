import type { AnyCommand, Project } from '@mcut/timeline'
import type { JsonObject } from './json'
import type { ScriptedCall, TokenUsage } from './model'

export interface ToolCall {
  name: string
  args: JsonObject
  result: string
  isError: boolean
  durationMs: number
}

export interface Verdict {
  pass: boolean
  reasons: string[]
}

export interface E2ETask {
  id: string
  title: string
  prompt: string
  fixtures: string[]
  setup: AnyCommand[]
  scripted: ScriptedCall[]
  score: (project: Project, transcript: ToolCall[]) => Verdict
}

export type StopReason = 'model' | 'step-cap' | 'wall-clock' | 'error'

export interface TaskRun {
  task: Pick<E2ETask, 'id' | 'title' | 'fixtures'>
  model: string
  toolCalls: ToolCall[]
  steps: number
  durationMs: number
  tokens: TokenUsage
  verdict: Verdict
  stoppedBy: StopReason
  finalMessage: string
}
