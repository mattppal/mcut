import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { parseProject, type BuiltinCommand, type Project } from '@mcut/timeline'
import { z } from 'zod'
import { repoRoot } from './fixtures'
import { jsonObjectSchema, type JsonObject } from './json'

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: JsonObject
}

export interface ToolResult {
  text: string
  isError: boolean
}

export type McpTarget = { kind: 'stdio'; projectPath: string } | { kind: 'bridge'; url: string }

const toolListSchema = z.object({
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string().default(''),
      inputSchema: jsonObjectSchema,
    }),
  ),
})

const toolResultSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).default([]),
  isError: z.boolean().default(false),
})

export interface McpSession {
  listTools(): Promise<ToolDefinition[]>
  callTool(name: string, args: JsonObject): Promise<ToolResult>
  dispatch(command: BuiltinCommand): Promise<ToolResult>
  getProject(): Promise<Project>
  close(): Promise<void>
}

export function describeTarget(target: McpTarget): string {
  if (target.kind === 'bridge') return `live bridge ${new URL(target.url).origin}`
  return `headless stdio (${target.projectPath})`
}

export function createTransport(target: McpTarget): Transport {
  if (target.kind === 'bridge') return new StreamableHTTPClientTransport(new URL(target.url))
  return new StdioClientTransport({
    command: process.execPath,
    args: [join(repoRoot, 'packages/mcp-server/src/cli.ts'), target.projectPath],
    cwd: repoRoot,
    stderr: 'ignore',
  })
}

export async function connectMcp(transport: Transport): Promise<McpSession> {
  const client = new Client({ name: 'mcut-agent-e2e', version: '0.1.0' }, { capabilities: {} })
  await client.connect(transport)

  const callTool = async (name: string, args: JsonObject): Promise<ToolResult> => {
    const raw = await client.callTool({ name, arguments: args })
    const result = toolResultSchema.parse(raw)
    const text = result.content
      .map((part) => part.text)
      .filter((part): part is string => typeof part === 'string')
      .join('\n')
    return { text, isError: result.isError }
  }

  const dispatch = async (command: BuiltinCommand): Promise<ToolResult> => {
    const { type, ...args } = command
    const result = await callTool(type, args)
    if (result.isError) throw new Error(`setup command ${type} failed. ${result.text}`)
    return result
  }

  return {
    listTools: async () => toolListSchema.parse(await client.listTools()).tools,
    callTool,
    dispatch,
    getProject: async () => {
      const result = await callTool('get_project', {})
      if (result.isError) throw new Error(`get_project failed. ${result.text}`)
      return parseProject(JSON.parse(result.text))
    },
    close: () => client.close(),
  }
}

export async function resetProject(session: McpSession): Promise<void> {
  const project = await session.getProject()
  for (const track of project.tracks) {
    await session.dispatch({ type: 'removeTrack', trackId: track.id })
  }
  for (const asset of Object.values(project.assets)) {
    await session.dispatch({ type: 'removeAsset', assetId: asset.id })
  }
  await session.dispatch({ type: 'updateProject', name: 'agent-e2e', width: 1920, height: 1080, fps: 30 })
}
