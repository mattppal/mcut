import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createMcutMcpServer } from '@mcut/mcp-server'
import { EditorEngine } from '@mcut/timeline'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { DEFAULT_CAPS, runTask } from './loop'
import { connectMcp, type McpSession } from './mcp'
import { createScriptedModel, type ModelClient, type ModelTurn } from './model'
import { TASKS } from './tasks'
import type { E2ETask } from './types'

async function openSession(): Promise<McpSession> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await createMcutMcpServer({ engine: new EditorEngine() }).connect(serverTransport)
  return connectMcp(clientTransport)
}

const firstTask = (): E2ETask => {
  const task = TASKS[0]
  if (task === undefined) throw new Error('the task registry is empty')
  return task
}

const repeating = (turn: ModelTurn): ModelClient => ({
  model: 'repeating',
  start: async () => turn,
  continue: async () => turn,
})

describe('agent e2e task registry', () => {
  let session: McpSession

  beforeAll(async () => {
    session = await openSession()
  })

  afterAll(async () => {
    await session.close()
  })

  test('task ids are unique and every task ships a scripted solution', () => {
    const ids = new Set(TASKS.map((task) => task.id))
    expect(ids.size).toBe(TASKS.length)
    expect(TASKS.length).toBeGreaterThanOrEqual(6)
    for (const task of TASKS) expect(task.scripted.length).toBeGreaterThan(0)
  })

  test('scripted solutions only call tools the server advertises', async () => {
    const names = new Set((await session.listTools()).map((tool) => tool.name))
    for (const task of TASKS) {
      for (const call of task.scripted) expect(names.has(call.name)).toBe(true)
      for (const command of task.setup) expect(names.has(command.type)).toBe(true)
    }
  })

  test('each scripted solution passes its own scorer', async () => {
    for (const task of TASKS) {
      const run = await runTask(task, session, createScriptedModel(task.scripted), DEFAULT_CAPS)
      expect({ id: task.id, ...run.verdict }).toEqual({ id: task.id, pass: true, reasons: [] })
      expect(run.stoppedBy).toBe('model')
      expect(run.toolCalls.every((call) => !call.isError)).toBe(true)
      expect(run.steps).toBe(task.scripted.length)
    }
  })

  test('an agent that edits nothing fails every scorer', async () => {
    for (const task of TASKS) {
      const run = await runTask(task, session, createScriptedModel([]), DEFAULT_CAPS)
      expect(run.verdict.pass).toBe(false)
      expect(run.verdict.reasons.length).toBeGreaterThan(0)
      expect(run.toolCalls).toHaveLength(0)
    }
  })

  test('the step cap stops an agent that never finishes', async () => {
    const summary = { callId: 'c', name: 'get_summary', arguments: '{}' }
    const model = repeating({ calls: [summary], text: '', tokens: { input: 1, output: 1 } })
    const run = await runTask(firstTask(), session, model, { maxSteps: 3, wallClockMs: 60_000 })
    expect(run.stoppedBy).toBe('step-cap')
    expect(run.steps).toBe(3)
    expect(run.toolCalls).toHaveLength(3)
    expect(run.tokens).toEqual({ input: 4, output: 4 })
    expect(run.verdict.pass).toBe(false)
    expect(run.verdict.reasons[0]).toContain('step-cap')
  })

  test('bad tool calls are reported back instead of aborting the run', async () => {
    const calls = [
      { callId: 'a', name: 'no_such_tool', arguments: '{}' },
      { callId: 'b', name: 'splitElement', arguments: '{not json' },
    ]
    let served = false
    const model: ModelClient = {
      model: 'faulty',
      start: async () => ({ calls, text: '', tokens: { input: 0, output: 0 } }),
      continue: async (outputs) => {
        served = outputs.every((output) => output.output.startsWith('ERROR: '))
        return { calls: [], text: 'gave up', tokens: { input: 0, output: 0 } }
      },
    }
    const run = await runTask(firstTask(), session, model, DEFAULT_CAPS)
    expect(served).toBe(true)
    expect(run.stoppedBy).toBe('model')
    expect(run.finalMessage).toBe('gave up')
    expect(run.toolCalls.map((call) => call.isError)).toEqual([true, true])
  })

  test('a model failure ends the run as an error with the transcript kept', async () => {
    const model: ModelClient = {
      model: 'flaky',
      start: async () => ({
        calls: [{ callId: 'a', name: 'get_summary', arguments: '{}' }],
        text: '',
        tokens: { input: 0, output: 0 },
      }),
      continue: async () => {
        throw new Error('xAI responded 503')
      },
    }
    const run = await runTask(firstTask(), session, model, DEFAULT_CAPS)
    expect(run.stoppedBy).toBe('error')
    expect(run.toolCalls).toHaveLength(1)
    expect(run.verdict.pass).toBe(false)
    expect(run.verdict.reasons[0]).toContain('xAI responded 503')
  })
})
