import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { isRecord } from '../../../timeline/src/fuzz/json-schema-gen'
import type { FuzzTool } from '../../../timeline/src/fuzz/plan'
import { parseProject, type Project } from '../../../timeline/src/model'

export interface ToolReply {
  isError: boolean
  text: string
}

export type ProjectSnapshot =
  | { kind: 'parsed'; document: unknown; project: Project }
  | { kind: 'unparseable'; document: unknown; message: string }

const CLI_PATH = fileURLToPath(new URL('../cli.ts', import.meta.url))
const CALL_TIMEOUT_MS = 15_000
const STDERR_TAIL_CHARS = 2_000

export class McpFuzzServer {
  private constructor(
    private readonly client: Client,
    private readonly stderrChunks: string[],
  ) {}

  static async spawn(projectPath: string): Promise<McpFuzzServer> {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI_PATH, projectPath],
      stderr: 'pipe',
    })
    const stderrChunks: string[] = []
    transport.stderr?.on('data', (chunk) => {
      stderrChunks.push(String(chunk))
      if (stderrChunks.length > 50) stderrChunks.splice(0, stderrChunks.length, stderrChunks.join('').slice(-STDERR_TAIL_CHARS))
    })
    return McpFuzzServer.connect(transport, stderrChunks)
  }

  static async connect(transport: Transport, stderrChunks: string[] = []): Promise<McpFuzzServer> {
    const client = new Client({ name: 'mcut-fuzz', version: '0.0.0' })
    await client.connect(transport)
    return new McpFuzzServer(client, stderrChunks)
  }

  async listTools(): Promise<FuzzTool[]> {
    const { tools } = await this.client.listTools()
    return tools.map((tool) => ({ name: tool.name, inputSchema: tool.inputSchema }))
  }

  async call(name: string, args: unknown): Promise<ToolReply> {
    const result = await this.client.callTool(
      { name, arguments: isRecord(args) ? args : {} },
      undefined,
      { timeout: CALL_TIMEOUT_MS },
    )
    return { isError: isRecord(result) && result.isError === true, text: textOf(result) }
  }

  async project(): Promise<ProjectSnapshot> {
    const reply = await this.call('get_project', {})
    if (reply.isError) throw new Error(`get_project replied with an error (${reply.text.slice(0, 300)})`)
    const document: unknown = JSON.parse(reply.text)
    try {
      return { kind: 'parsed', document, project: parseProject(document) }
    } catch (error) {
      return { kind: 'unparseable', document, message: error instanceof Error ? error.message : String(error) }
    }
  }

  stderrTail(): string {
    return this.stderrChunks.join('').slice(-STDERR_TAIL_CHARS)
  }

  async close(): Promise<void> {
    await this.client.close()
  }
}

function textOf(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.content)) return ''
  return result.content.map((item) => (isRecord(item) && typeof item.text === 'string' ? item.text : '')).join('')
}
