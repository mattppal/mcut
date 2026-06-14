#!/usr/bin/env node
/**
 * Stdio entry point:
 *
 *   bunx @mcut/mcp-server [path/to/project.json]
 *
 * The project file (default `project.mcut.json`, or $MCUT_PROJECT) is created
 * when missing and rewritten after every successful edit.
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { EditorEngine, parseProject } from '@mcut/timeline'
import { createMcutMcpServer } from './server'

const projectPath = process.argv[2] ?? process.env.MCUT_PROJECT ?? 'project.mcut.json'

async function loadEngine(): Promise<EditorEngine> {
  if (!existsSync(projectPath)) return new EditorEngine()
  const raw = JSON.parse(await readFile(projectPath, 'utf8'))
  return new EditorEngine({ project: parseProject(raw) })
}

const engine = await loadEngine()

const server = createMcutMcpServer({
  engine,
  onChange: async () => {
    await writeFile(projectPath, `${JSON.stringify(engine.toJSON(), null, 2)}\n`, 'utf8')
  },
})

await server.connect(new StdioServerTransport())
console.error(`mcut MCP server ready — project: ${projectPath}`)
