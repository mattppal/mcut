import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { EditorEngine, applyCommand, createProject, getActiveLayout, listZoomRegions, type MulticamElement, type Project } from '@mcut/timeline'
import { z } from 'zod'
import { createMcutMcpServer } from './server'

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = 'content' in result && Array.isArray(result.content) ? result.content : []
  const first = content[0]
  return first?.type === 'text' ? first.text : ''
}

function multicamCutIntoPieces(): Project {
  let project = createProject({ fps: 30 })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'blob:s', durationMs: 60_000 } })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-cam', kind: 'video', src: 'blob:c', durationMs: 60_000 } })
  const full = { x: 0, y: 0, w: 1, h: 1 }
  project = applyCommand(project, { type: 'saveLayout', layout: { id: 'l-screen', name: 'Screen', slots: [{ source: 'screen', rect: full }] } })
  project = applyCommand(project, { type: 'saveLayout', layout: { id: 'l-cam', name: 'Camera', slots: [{ source: 'camera', rect: full }] } })
  project = applyCommand(project, {
    type: 'addElement',
    trackId: 't-default',
    element: {
      id: 'e-mc',
      type: 'multicam',
      startMs: 0,
      durationMs: 30_000,
      trimStartMs: 0,
      sources: [
        { key: 'screen', assetId: 'a-screen', offsetMs: 0 },
        { key: 'camera', assetId: 'a-cam', offsetMs: 0 },
      ],
      angles: [{ atMs: 0, layoutId: 'l-screen' }],
      audioSource: 'camera',
    },
  })
  return applyCommand(project, { type: 'removeRanges', ranges: [{ startMs: 5000, endMs: 12_000 }] })
}

async function connect(engine: EditorEngine) {
  const server = createMcutMcpServer({ engine })
  const client = new Client({ name: 'test', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

function secondPiece(engine: EditorEngine): MulticamElement {
  const piece = engine.project.tracks[0]?.elements.filter((e): e is MulticamElement => e.type === 'multicam')[1]
  if (!piece) throw new Error('expected a second multicam piece')
  return piece
}

describe('agent tools take timeline time on a multicam cut into pieces', () => {
  test('an angle cut called without time lands at the timeline time, directly and inside transact', async () => {
    const engine = new EditorEngine({ project: multicamCutIntoPieces() })
    const client = await connect(engine)
    const id = secondPiece(engine).id

    const direct = await client.callTool({ name: 'addAngleCut', arguments: { elementId: id, atMs: 8000, layoutId: 'l-cam' } })
    expect(direct.isError).toBeFalsy()
    const batched = await client.callTool({
      name: 'transact',
      arguments: { calls: [{ name: 'addAngleCut', arguments: { elementId: id, atMs: 20_000, layoutId: 'l-screen' } }] },
    })
    expect(batched.isError).toBeFalsy()

    const piece = secondPiece(engine)
    expect(getActiveLayout(engine.project, piece, 7999)?.id).toBe('l-screen')
    expect(getActiveLayout(engine.project, piece, 8000)?.id).toBe('l-cam')
    expect(getActiveLayout(engine.project, piece, 20_000)?.id).toBe('l-screen')
    expect(piece.angles.map((a) => a.atMs)).toEqual([0, 15_000, 27_000])
  })

  test('an angle cut outside the piece is an error the agent sees', async () => {
    const engine = new EditorEngine({ project: multicamCutIntoPieces() })
    const client = await connect(engine)
    const result = await client.callTool({ name: 'addAngleCut', arguments: { elementId: secondPiece(engine).id, atMs: 25_000, layoutId: 'l-cam' } })
    expect(result.isError).toBe(true)
  })

  test('edit_zooms without time places one zoom by timeline range across the cut', async () => {
    const engine = new EditorEngine({ project: multicamCutIntoPieces() })
    const client = await connect(engine)
    const result = await client.callTool({
      name: 'edit_zooms',
      arguments: {
        edits: [{ type: 'addZoomRegion', elementId: 'e-mc', zoom: { id: 'z-open', source: 'screen', atMs: 4000, inMs: 700, holdMs: 1600, outMs: 700 } }],
      },
    })
    expect(result.isError).toBeFalsy()
    expect(listZoomRegions(engine.project).map(({ id, startMs, endMs }) => ({ id, startMs, endMs }))).toEqual([
      { id: 'z-open', startMs: 4000, endMs: 5000 },
      { id: 'z-open-r', startMs: 5000, endMs: 7000 },
    ])
  })

  test('list_zooms reports atMs on the clock edit_zooms takes, so writing it back keeps the zoom in place', async () => {
    const engine = new EditorEngine({ project: multicamCutIntoPieces() })
    const client = await connect(engine)
    const id = secondPiece(engine).id
    await client.callTool({
      name: 'edit_zooms',
      arguments: { edits: [{ type: 'addZoomRegion', elementId: id, zoom: { id: 'z-detail', source: 'screen', atMs: 15_000, inMs: 500, holdMs: 2000, outMs: 500 } }] },
    })
    const listed = z.array(z.object({ id: z.string(), atMs: z.number() })).parse(JSON.parse(textOf(await client.callTool({ name: 'list_zooms', arguments: {} }))))
    expect(listed).toEqual([{ id: 'z-detail', atMs: 15_000 }])

    const before = listZoomRegions(engine.project)
    const rewritten = await client.callTool({
      name: 'edit_zooms',
      arguments: { edits: listed.map((zoom) => ({ type: 'updateZoomRegion', elementId: id, zoomId: zoom.id, patch: { atMs: zoom.atMs } })) },
    })
    expect(rewritten.isError).toBeFalsy()
    expect(listZoomRegions(engine.project)).toEqual(before)
  })
})
