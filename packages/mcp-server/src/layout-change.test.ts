import { expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { applyCommand, createProject, EditorEngine, type Project } from '@mcut/timeline'
import { createMcutMcpServer } from './server'

function pipProject(camera: { x: number; y: number; w: number; h: number }): Project {
  return applyCommand(createProject({ width: 1920, height: 1080 }), {
    type: 'saveLayout',
    layout: {
      id: 'l-pip',
      name: 'PiP',
      slots: [
        { source: 'screen', rect: { x: 0, y: 0, w: 1, h: 1 } },
        { source: 'camera', rect: camera },
      ],
    },
  })
}

async function callTool(project: Project, call: Parameters<Client['callTool']>[0]): Promise<string[]> {
  const server = createMcutMcpServer({ engine: new EditorEngine({ project }) })
  const client = new Client({ name: 'test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  const result = await client.callTool(call)
  const [first] = 'content' in result && Array.isArray(result.content) ? result.content : []
  return (first?.type === 'text' ? first.text : '').split('\n')
}

test('resizeLayoutSlot reports each slot before and after, like saveLayout', async () => {
  const lines = await callTool(pipProject({ x: 0.863, y: 0.45, w: 0.112, h: 0.5 }), {
    name: 'resizeLayoutSlot',
    arguments: { layoutId: 'l-pip', source: 'camera', aspect: 9 / 16 },
  })

  expect(lines.slice(0, 4)).toEqual([
    'OK: resizeLayoutSlot applied.',
    'Layout "PiP" (picture-in-picture), before → after:',
    '  screen full-frame 1920×1080 px, aspect 1.78 (16:9) (unchanged)',
    '  camera overlay bottom-right 215×540 px, aspect 0.40 → camera overlay bottom-right 256×454 px, aspect 0.56 (9:16) (width +19%, height -16%)',
  ])
})

test('saveLayout with a null shadow keeps the rest of the slot and warns how to restore the shadow', async () => {
  const lines = await callTool(pipProject({ x: 0.7, y: 0.69, w: 0.275, h: 0.275 }), {
    name: 'saveLayout',
    arguments: { layout: { id: 'l-pip', name: 'PiP', slots: [{ source: 'screen' }, { source: 'camera', shadow: null }] } },
  })

  expect(lines.slice(0, 5)).toEqual([
    'OK: saveLayout applied.',
    'Layout "PiP" (picture-in-picture), before → after:',
    '  screen full-frame 1920×1080 px, aspect 1.78 (16:9) (unchanged)',
    '  camera overlay bottom-right 528×297 px, aspect 1.78 (16:9) (shadow removed)',
    'Warning: the camera overlay lost its shadow. To restore it, save this layout with ' +
      '{"source":"camera","shadow":{"color":"rgba(0, 0, 0, 0.45)","blur":36,"offsetX":0,"offsetY":12}} as the camera slot.',
  ])
})
