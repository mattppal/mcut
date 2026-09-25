import { findSceneChanges, renderContactSheet, renderProjectStill } from '@mcut/media'
import type { MCP_TOOL_INPUTS } from '@mcut/mcp-server/contract'
import type { EditorEngine } from '@mcut/timeline'
import type { z } from 'zod'
import { ensureProjectFontsLoaded } from './font-library'

type GetFrameInput = z.infer<typeof MCP_TOOL_INPUTS.get_frame>
type FindSceneChangesInput = z.infer<typeof MCP_TOOL_INPUTS.find_scene_changes>
type GetContactSheetInput = z.infer<typeof MCP_TOOL_INPUTS.get_contact_sheet>

const BASE64_GROUP_BYTES = 3
const BASE64_CHUNK_GROUPS = 10_922

function bytesToBase64(bytes: Uint8Array): string {
  const chunkBytes = BASE64_GROUP_BYTES * BASE64_CHUNK_GROUPS
  const parts: string[] = []
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    const slice = bytes.subarray(offset, offset + chunkBytes)
    let binary = ''
    for (const byte of slice) binary += String.fromCharCode(byte)
    parts.push(btoa(binary))
  }
  return parts.join('')
}

export async function handleGetFrame(engine: EditorEngine, input: GetFrameInput) {
  await ensureProjectFontsLoaded(engine.project)
  const still = await renderProjectStill(engine.project, input.timeMs, {
    ...(input.elementId !== undefined ? { soloElementId: input.elementId } : {}),
    width: input.maxWidth,
  })
  const data = bytesToBase64(new Uint8Array(await still.blob.arrayBuffer()))
  return {
    mimeType: 'image/png' as const,
    data,
    width: still.width,
    height: still.height,
    timeMs: input.timeMs,
    ...(input.elementId !== undefined ? { elementId: input.elementId } : {}),
    visibleElementIds: still.visibleElementIds,
  }
}

export function handleFindSceneChanges(engine: EditorEngine, input: FindSceneChangesInput) {
  return findSceneChanges(engine.project, input)
}

export async function handleGetContactSheet(engine: EditorEngine, input: GetContactSheetInput) {
  const { blob, ...sheet } = await renderContactSheet(engine.project, input)
  return { mimeType: 'image/png' as const, data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())), ...sheet }
}
