/**
 * mcut as an MCP server — the standard setup ships as a package:
 *
 *   bunx @mcut/mcp-server path/to/project.json
 *
 * This example shows the composable API instead: bring your own engine,
 * persistence, and transport (here: stdio, like the packaged bin).
 *
 *   bun run index.ts [path/to/project.json]
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcutMcpServer } from '@mcut/mcp-server'
import { EditorEngine, parseProject } from '@mcut/timeline'

const projectPath = process.argv[2] ?? process.env.MCUT_PROJECT ?? 'project.mcut.json'

const engine = existsSync(projectPath)
  ? new EditorEngine({ project: parseProject(JSON.parse(await readFile(projectPath, 'utf8'))) })
  : new EditorEngine()

const server = createMcutMcpServer({
  engine,
  // The project file is rewritten after every successful edit.
  onChange: async () => {
    await writeFile(projectPath, `${JSON.stringify(engine.toJSON(), null, 2)}\n`, 'utf8')
  },
})

await server.connect(new StdioServerTransport())
console.error(`mcut MCP server ready — project: ${projectPath}`)
