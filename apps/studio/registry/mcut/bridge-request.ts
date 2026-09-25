import { MCP_TOOL_INPUTS, cancelExportRequestSchema, startExportRequestSchema } from '@mcut/mcp-server/contract'
import { z } from 'zod'

const request = <Type extends string, Payload extends z.ZodType>(type: Type, payload: Payload) => z.object({ id: z.string(), type: z.literal(type), payload })

export const bridgeRequestSchema = z.discriminatedUnion('type', [
  request('get_summary', MCP_TOOL_INPUTS.get_summary.optional()),
  request('get_project', MCP_TOOL_INPUTS.get_project.optional()),
  request('get_media_context', MCP_TOOL_INPUTS.get_media_context.optional()),
  request('get_audio_activity', MCP_TOOL_INPUTS.get_audio_activity.default({})),
  request('get_transcript', MCP_TOOL_INPUTS.get_transcript.default({})),
  request('search_transcript', MCP_TOOL_INPUTS.search_transcript),
  request('ensure_transcript', MCP_TOOL_INPUTS.ensure_transcript.default({})),
  request('list_commands', MCP_TOOL_INPUTS.list_commands.optional()),
  request('apply_commands', MCP_TOOL_INPUTS.apply_commands),
  request('list_operators', MCP_TOOL_INPUTS.list_operators.optional()),
  request('run_operator', MCP_TOOL_INPUTS.run_operator),
  request('list_actions', MCP_TOOL_INPUTS.list_actions.optional()),
  request('run_action', MCP_TOOL_INPUTS.run_action),
  request('undo', MCP_TOOL_INPUTS.undo.optional()),
  request('redo', MCP_TOOL_INPUTS.redo.optional()),
  request(
    'dispatch_command',
    z.strictObject({
      commandName: z.string(),
      input: z.record(z.string(), z.unknown()).default({}),
    }),
  ),
])

export type BridgeRequest = z.infer<typeof bridgeRequestSchema>

const exportRequestSchema = z.discriminatedUnion('type', [
  request('start_export', startExportRequestSchema),
  request('cancel_export', cancelExportRequestSchema),
])

export type ExportRequest = z.infer<typeof exportRequestSchema>

const socketRequestSchema = z.discriminatedUnion('type', [...bridgeRequestSchema.options, ...exportRequestSchema.options])

type SocketRequest = BridgeRequest | ExportRequest

export const isExportRequest = (parsed: SocketRequest) => parsed.type === 'start_export' || parsed.type === 'cancel_export'

export interface BridgeRequestError {
  name: 'BridgeRequestError'
  code: 'invalid-request'
  message: string
}

export type BridgeFrame = { ok: true; request: SocketRequest } | { ok: false; id: string | undefined; error: BridgeRequestError }

const frameIdSchema = z.object({ id: z.string() })

function rejection(id: string | undefined, message: string): BridgeFrame {
  return { ok: false, id, error: { name: 'BridgeRequestError', code: 'invalid-request', message } }
}

export function parseBridgeFrame(raw: unknown): BridgeFrame {
  let value: unknown
  try {
    value = JSON.parse(String(raw))
  } catch {
    return rejection(undefined, 'Bridge frame is not valid JSON.')
  }
  const parsed = socketRequestSchema.safeParse(value)
  if (parsed.success) return { ok: true, request: parsed.data }
  const envelope = frameIdSchema.safeParse(value)
  return rejection(envelope.success ? envelope.data.id : undefined, z.prettifyError(parsed.error))
}
