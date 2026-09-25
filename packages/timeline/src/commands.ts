import { z } from 'zod'
import { CommandError } from './errors'
import type { Project } from './model'
import { applyCaptions, applyThumbnail, createMulticam, detachAudio } from './commands/derived-elements'
import { addElement, moveElement, removeElement, rippleDelete, splitElement, trimElement, updateElement } from './commands/elements'
import { applyAnimationPreset, applyZoomPreset, clearKeyframes, moveKeyframe, removeKeyframe, setKeyframe, setKeyframeEasing } from './commands/keyframes'
import { removeLayout, saveLayout } from './commands/layouts'
import { addMarker, removeMarker, updateMarker } from './commands/markers'
import {
  addAngleCut,
  flattenMulticam,
  moveAngleCut,
  removeAngleCut,
  setAngleLayout,
  setMulticamAngleTransition,
  setMulticamAudio,
  setMulticamSourceKey,
  setMulticamSourceOffset,
} from './commands/multicam'
import { addAsset, removeAsset, removePreset, savePreset, updateAsset, updateProject } from './commands/project'
import { rippleTrim, rollEdit, setElementSpeed, setTimeMap, slideElement, slipElement, trimEdge } from './commands/timing'
import { addTrack, compactTimelineGaps, compactTrackGaps, removeTrack, renameTrack, reorderTrack, setTrackFlags } from './commands/tracks'
import { addEffect, removeEffect, reorderEffect, setBlendMode, setMotionBlur, setTransition, updateEffect } from './commands/visual'

export { CommandError } from './errors'

function commandTable<T extends { [K in keyof T]: { type: K } }>(table: T): T {
  return table
}

const commandDefinitions = commandTable({
  addTrack,
  removeTrack,
  renameTrack,
  setTrackFlags,
  compactTrackGaps,
  compactTimelineGaps,
  reorderTrack,
  updateProject,
  addAsset,
  updateAsset,
  removeAsset,
  addElement,
  removeElement,
  moveElement,
  trimElement,
  splitElement,
  updateElement,
  applyCaptions,
  setKeyframe,
  removeKeyframe,
  moveKeyframe,
  setKeyframeEasing,
  clearKeyframes,
  applyAnimationPreset,
  addEffect,
  updateEffect,
  removeEffect,
  reorderEffect,
  setBlendMode,
  setMotionBlur,
  setTransition,
  setElementSpeed,
  setTimeMap,
  trimEdge,
  slipElement,
  rollEdit,
  slideElement,
  rippleTrim,
  saveLayout,
  removeLayout,
  savePreset,
  removePreset,
  createMulticam,
  addAngleCut,
  moveAngleCut,
  removeAngleCut,
  setAngleLayout,
  setMulticamAudio,
  setMulticamSourceOffset,
  setMulticamAngleTransition,
  setMulticamSourceKey,
  flattenMulticam,
  detachAudio,
  applyThumbnail,
  applyZoomPreset,
  addMarker,
  updateMarker,
  removeMarker,
  rippleDelete,
})

type CommandDefinitions = typeof commandDefinitions

export type CommandType = keyof CommandDefinitions

export type BuiltinCommand = {
  [K in CommandType]: { type: K } & z.input<CommandDefinitions[K]['payloadSchema']>
}[CommandType]

export type CommandOfType<K extends CommandType> = Extract<BuiltinCommand, { type: K }>

export interface CommandDefinition {
  type: CommandType
  description: string
  payloadSchema: z.ZodObject
}

export function listCommands(): CommandDefinition[] {
  return Object.values(commandDefinitions)
}

export interface ToolDefinition {
  name: CommandType
  description: string
  inputSchema: z.core.JSONSchema.BaseSchema
}

export function listToolDefinitions(): ToolDefinition[] {
  return listCommands().map(({ type, description, payloadSchema }) => ({
    name: type,
    description,
    inputSchema: z.toJSONSchema(payloadSchema, { unrepresentable: 'any', io: 'input' }),
  }))
}

function isCommandType(value: string): value is CommandType {
  return Object.hasOwn(commandDefinitions, value)
}

function splitCommand(value: unknown): { type: CommandType; payload: unknown } {
  if (typeof value !== 'object' || value === null || !('type' in value) || typeof value.type !== 'string') {
    throw new CommandError('invalid-payload', 'a command is an object with a string "type"')
  }
  const { type, ...payload } = value
  if (!isCommandType(type)) {
    throw new CommandError('unknown-command', `unknown command "${type}"`)
  }
  return { type, payload }
}

export function parseCommand(value: unknown): BuiltinCommand {
  const { type, payload } = splitCommand(value)
  return commandDefinitions[type].parse(payload)
}

export function applyCommand(project: Project, command: unknown): Project {
  const { type, payload } = splitCommand(command)
  return commandDefinitions[type].apply(project, payload)
}
