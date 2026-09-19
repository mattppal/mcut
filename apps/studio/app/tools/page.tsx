import type { Metadata } from 'next'
import { Suspense } from 'react'
import type { McpToolProfile } from '@mcut/mcp-server/contract'
import { listMcpToolDefinitions } from '@/registry/mcut/mcp-tools'
import { ToolsCatalog } from './tools-catalog'

export const metadata: Metadata = {
  title: 'mcut — MCP tools',
  description: 'The full mcut MCP tool surface: project context, undo/redo, editor operators, and raw timeline commands.',
}

export default function ToolsPage() {
  const counts: Record<McpToolProfile, number> = {
    agent: listMcpToolDefinitions('agent').length,
    full: listMcpToolDefinitions('full').length,
    commands: listMcpToolDefinitions('commands').length,
  }
  return (
    <Suspense fallback={<div className="flex flex-1 flex-col bg-background text-foreground" />}>
      <ToolsCatalog counts={counts} />
    </Suspense>
  )
}
