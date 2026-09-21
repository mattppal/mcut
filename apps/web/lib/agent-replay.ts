import { AGENT_SCRIPT } from './agent-script'

export type ReplayPhase =
  | { kind: 'waiting' }
  | { kind: 'running'; step: number }
  | { kind: 'holding'; step: number }
  | { kind: 'done' }
  | { kind: 'handed-off'; completed: number }
  | { kind: 'failed'; step: number; message: string }

export type TraceMode = 'live' | 'recorded'

export type RowStatus = { kind: 'queued' } | { kind: 'running' } | { kind: 'ok' } | { kind: 'failed'; message: string }

const OK: RowStatus = { kind: 'ok' }
const QUEUED: RowStatus = { kind: 'queued' }

const ranked = (index: number, step: number, current: RowStatus): RowStatus => (index < step ? OK : index === step ? current : QUEUED)

export function rowStatus(phase: ReplayPhase, index: number): RowStatus {
  switch (phase.kind) {
    case 'waiting':
      return QUEUED
    case 'running':
      return ranked(index, phase.step, { kind: 'running' })
    case 'holding':
      return ranked(index, phase.step, OK)
    case 'done':
      return OK
    case 'handed-off':
      return ranked(index, phase.completed, QUEUED)
    case 'failed':
      return ranked(index, phase.step, { kind: 'failed', message: phase.message })
    default: {
      const unhandled: never = phase
      throw new Error(`Unhandled replay phase ${JSON.stringify(unhandled)}`)
    }
  }
}

export function handOff(phase: ReplayPhase): ReplayPhase {
  switch (phase.kind) {
    case 'waiting':
      return { kind: 'handed-off', completed: 0 }
    case 'running':
      return { kind: 'handed-off', completed: phase.step }
    case 'holding':
      return { kind: 'handed-off', completed: phase.step + 1 }
    case 'done':
      return { kind: 'handed-off', completed: AGENT_SCRIPT.length }
    case 'handed-off':
    case 'failed':
      return phase
    default: {
      const unhandled: never = phase
      throw new Error(`Unhandled replay phase ${JSON.stringify(unhandled)}`)
    }
  }
}
