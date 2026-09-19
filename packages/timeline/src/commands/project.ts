import { z } from 'zod'
import { CommandError } from '../errors'
import { assetIdSchema, assetRefSchema } from '../model'
import { compactTimelineIfMagnetic } from '../placement'
import { propertyPresetSchema } from '../presets'
import { defineCommand } from './shared'

export const updateProject = defineCommand({
  type: 'updateProject',
  description: 'Update project settings (name, dimensions, fps).',
  payloadSchema: z.object({
    name: z.string().min(1).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fps: z.number().positive().optional(),
  }),
  reduce: (project, payload) => ({ ...project, ...payload }),
})

export const addAsset = defineCommand({
  type: 'addAsset',
  description: 'Register a media asset (video, audio, or image) for use by elements.',
  payloadSchema: z.object({ asset: assetRefSchema }),
  reduce: (project, payload) => {
    if (project.assets[payload.asset.id]) {
      throw new CommandError('duplicate-asset', `asset "${payload.asset.id}" already exists`)
    }
    return { ...project, assets: { ...project.assets, [payload.asset.id]: payload.asset } }
  },
})

export const updateAsset = defineCommand({
  type: 'updateAsset',
  description: 'Patch asset metadata (e.g. probed duration or dimensions).',
  payloadSchema: z.object({
    assetId: assetIdSchema,
    patch: assetRefSchema.partial().omit({ id: true }),
  }),
  reduce: (project, payload) => {
    const asset = project.assets[payload.assetId]
    if (!asset) throw new CommandError('unknown-asset', `no asset "${payload.assetId}"`)
    return {
      ...project,
      assets: { ...project.assets, [payload.assetId]: { ...asset, ...payload.patch } },
    }
  },
})

export const removeAsset = defineCommand({
  type: 'removeAsset',
  description: 'Remove an asset and every element that references it.',
  payloadSchema: z.object({ assetId: assetIdSchema }),
  reduce: (project, payload) => {
    if (!project.assets[payload.assetId]) {
      throw new CommandError('unknown-asset', `no asset "${payload.assetId}"`)
    }
    const assets = { ...project.assets }
    delete assets[payload.assetId]
    const tracks = project.tracks.map((track) => ({
      ...track,
      elements: track.elements.filter((e) => !('assetId' in e) || e.assetId !== payload.assetId),
    }))
    return compactTimelineIfMagnetic({ ...project, assets, tracks })
  },
})

export const savePreset = defineCommand({
  type: 'savePreset',
  description:
    'Add or replace a property preset: a named bundle of inspector values ' +
    '(an effects stack, a text style, a layout-slot style, …). The preset ' +
    'kind names the surface that captures and applies it.',
  payloadSchema: z.object({ preset: propertyPresetSchema }),
  reduce: (project, payload) => {
    const exists = project.presets.some((p) => p.id === payload.preset.id)
    return {
      ...project,
      presets: exists ? project.presets.map((p) => (p.id === payload.preset.id ? payload.preset : p)) : [...project.presets, payload.preset],
    }
  },
})

export const removePreset = defineCommand({
  type: 'removePreset',
  description: 'Remove a property preset from the project.',
  payloadSchema: z.object({ presetId: z.string().min(1) }),
  reduce: (project, payload) => {
    if (!project.presets.some((p) => p.id === payload.presetId)) {
      throw new CommandError('unknown-preset', `no preset "${payload.presetId}"`)
    }
    return { ...project, presets: project.presets.filter((p) => p.id !== payload.presetId) }
  },
})
