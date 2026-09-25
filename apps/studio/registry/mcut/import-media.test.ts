import { describe, expect, test } from 'bun:test'
import { EditorEngine, createProject } from '@mcut/timeline'
import { z } from 'zod'
import './editor-default-actions'
import type { EditorUIValue } from './editor-ui'
import { handleLiveMcpRequest } from './live-mcp-bridge'

function bridgeUi(): EditorUIValue {
  const ui: EditorUIValue = Object.create(null)
  return ui
}

const FILE_SRC = 'file:///home/user/Downloads/sample-video/clip.mp4'
const FILE_MESSAGE = `addAsset cannot load ${FILE_SRC}. Studio cannot read file URLs. Import local files with import_media { paths }.`

const listedActionSchema = z.array(z.looseObject({ id: z.string(), humanOnly: z.string().optional() }))

async function listedHumanOnly(engine: EditorEngine): Promise<Map<string, string | undefined>> {
  const actions = listedActionSchema.parse(
    await handleLiveMcpRequest(engine, bridgeUi(), {
      id: 'list',
      type: 'list_actions',
    }),
  )
  return new Map(actions.map((action) => [action.id, action.humanOnly]))
}

describe('import media bridge guards', () => {
  test('run_action rejects human-only dialogs and list_actions shows the reason', async () => {
    const engine = new EditorEngine({ project: createProject() })
    const humanOnly = await listedHumanOnly(engine)
    expect(humanOnly.get('file.import')).toBe(
      'file.import opens a file dialog for a person and imports nothing over MCP. Import files with import_media { paths }.',
    )
    expect(humanOnly.get('file.open')).toBe('file.open opens a project file dialog for a person and loads nothing over MCP.')
    expect(humanOnly.get('file.save-as')).toBe('file.save-as opens a save dialog for a person and writes nothing over MCP.')
    expect(humanOnly.get('file.export-otio')).toBe('file.export-otio starts a file download for a person and writes nothing over MCP.')
    expect(humanOnly.get('file.new')).toBe('file.new asks a person to confirm replacing the open project and changes nothing over MCP.')
    expect(humanOnly.get('view.export')).toBe('view.export opens an export dialog for a person and exports nothing over MCP. Export a file with export_video.')
    expect(humanOnly.get('help.shortcuts')).toBe('help.shortcuts opens the keyboard shortcuts dialog for a person.')
    expect(humanOnly.get('playback.toggle')).toBeUndefined()

    await expect(
      handleLiveMcpRequest(engine, bridgeUi(), {
        id: 'import',
        type: 'run_action',
        payload: { actionId: 'file.import', input: { paths: ['/tmp/clip.mp4'] } },
      }),
    ).rejects.toThrow('file.import opens a file dialog for a person and imports nothing over MCP. Import files with import_media { paths }.')

    await expect(
      handleLiveMcpRequest(engine, bridgeUi(), {
        id: 'theme',
        type: 'run_action',
        payload: { actionId: 'view.toggle-theme', input: { theme: 'dark' } },
      }),
    ).rejects.toThrow('Editor action "view.toggle-theme" does not accept input.')
  })

  test('addAsset with a file URL is rejected before the project changes', async () => {
    const engine = new EditorEngine({ project: createProject() })
    const asset = { id: 'a-screen', kind: 'video', src: FILE_SRC, name: 'clip.mp4' }

    await expect(
      handleLiveMcpRequest(engine, bridgeUi(), {
        id: 'dispatch',
        type: 'dispatch_command',
        payload: { commandName: 'addAsset', input: { asset } },
      }),
    ).rejects.toThrow(FILE_MESSAGE)

    await expect(
      handleLiveMcpRequest(engine, bridgeUi(), {
        id: 'batch',
        type: 'apply_commands',
        payload: { commands: [{ type: 'addAsset', asset }] },
      }),
    ).rejects.toThrow(FILE_MESSAGE)

    expect(engine.project.assets).toEqual({})
  })
})
