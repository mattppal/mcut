import { listMcpToolDefinitions } from '@/registry/mcut/mcp-tools'

export const dynamic = 'force-static'

export function GET() {
  return Response.json({ profile: 'commands', tools: listMcpToolDefinitions('commands') })
}
