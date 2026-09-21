export interface AgentStep {
  id: string
  tool: string
  digest: string
  holdMs: number
  request: { id: string; type: string; payload?: unknown }
}

const step = (id: string, tool: string, digest: string, holdMs: number, request: Omit<AgentStep['request'], 'id'>): AgentStep => ({
  id,
  tool,
  digest,
  holdMs,
  request: { id, ...request },
})

export const ASPECT_STEP = step('r4', 'run_action view.aspect-9-16', 'canvas 1080 x 1920', 3000, {
  type: 'run_action',
  payload: { actionId: 'view.aspect-9-16', input: {} },
})

export const AGENT_SCRIPT: readonly AgentStep[] = [
  step('r1', 'get_summary', '1 track, 1 clip, 20.0 s', 2500, { type: 'get_summary' }),
  step('r2', 'run_operator edit.addTextAtPlayhead', 'title at the playhead', 2500, {
    type: 'run_operator',
    payload: { operatorId: 'edit.addTextAtPlayhead', input: { text: 'Big Buck Bunny' } },
  }),
  step('r3', 'run_action effects.fade-open-close', 'fade in and out on the title', 2500, {
    type: 'run_action',
    payload: { actionId: 'effects.fade-open-close', input: {} },
  }),
  ASPECT_STEP,
  step('r5', 'undo', 'canvas back to 1280 x 720', 1000, { type: 'undo' }),
  step('r6', 'undo', 'fade removed', 1000, { type: 'undo' }),
  step('r7', 'redo', 'fade restored', 1000, { type: 'redo' }),
  step('r8', 'redo', 'vertical again', 1500, { type: 'redo' }),
]

export const ASPECT_COMMAND = { type: 'updateProject', width: 1080, height: 1920 }

export const LEAD_IN_MS = 2500
