import {
  CAPTION_STYLE_PRESETS,
  getElementLocation,
  type AnyCommand,
  type ElementId,
  type Project,
} from '@mcut/timeline'
import { buildApplyCaptionsCommand, type TranscriptResult } from '@mcut/transcription'

export interface CaptionsCommandOptions {
  elementId?: string
  styleId?: string
  maxChars?: number
  maxGapMs?: number
  replace?: boolean
}

function sourceWindowForClip(element: {
  startMs: number
  trimStartMs: number
  durationMs: number
}): { timeOffsetMs: number; sourceStartMs: number; sourceEndMs: number } {
  return {
    timeOffsetMs: element.startMs,
    sourceStartMs: element.trimStartMs,
    sourceEndMs: element.trimStartMs + element.durationMs,
  }
}

export function buildCaptionsCommand(
  project: Project,
  transcript: TranscriptResult,
  options: CaptionsCommandOptions = {},
): AnyCommand {
  let style
  if (options.styleId) {
    const preset = CAPTION_STYLE_PRESETS.find((p) => p.id === options.styleId)
    if (!preset) {
      const known = CAPTION_STYLE_PRESETS.map((p) => p.id).join(', ')
      throw new Error(`unknown caption style "${options.styleId}" (known: ${known})`)
    }
    style = preset.style
  }

  let scope = {}
  if (options.elementId) {
    const location = getElementLocation(project, options.elementId as ElementId)
    if (!location) throw new Error(`no element "${options.elementId}" in project`)
    const element = location.element
    if (element.type !== 'video' && element.type !== 'audio') {
      throw new Error(`captions scope to video/audio elements, not "${element.type}"`)
    }
    if (element.timeMap) {
      throw new Error(
        `element "${options.elementId}" has a time remap; transcript times will not line up`,
      )
    }
    scope = sourceWindowForClip(element)
  }

  return buildApplyCaptionsCommand(transcript, {
    ...scope,
    ...(style ? { style } : {}),
    ...(options.maxChars !== undefined ? { maxChars: options.maxChars } : {}),
    ...(options.maxGapMs !== undefined ? { maxGapMs: options.maxGapMs } : {}),
    ...(options.replace !== undefined ? { replace: options.replace } : {}),
  })
}
