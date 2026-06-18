/**
 * Starter projects, built through the engine so they can never drift from the
 * schema. Every id is fixed: templates must be byte-stable across generate
 * runs (CI diffs them) and recipes reference these ids literally.
 */
import { EditorEngine, createProject, type AnyCommand, type Project } from '@mcut/timeline'

export interface TemplateDefinition {
  id: string
  name: string
  description: string
  build: () => Project
}

function dispatchAll(project: Project, commands: AnyCommand[]): Project {
  const engine = new EditorEngine({ project })
  for (const command of commands) engine.dispatch(command)
  return engine.project
}

/** The default layouts, with fixed ids (createDefaultLayouts() randomizes them). */
const LAYOUTS = [
  {
    id: 'lay-screen-cam',
    name: 'Screen + Cam',
    slots: [
      { source: 'screen', rect: { x: 0, y: 0, w: 1, h: 1 }, fit: 'cover', focus: { x: 0.5, y: 0.5 }, cornerRadius: 0, shadow: false },
      { source: 'camera', rect: { x: 0.7, y: 0.69, w: 0.275, h: 0.275 }, fit: 'cover', focus: { x: 0.5, y: 0.5 }, cornerRadius: 0.12, shadow: true },
    ],
  },
  {
    id: 'lay-camera',
    name: 'Camera',
    slots: [
      { source: 'camera', rect: { x: 0, y: 0, w: 1, h: 1 }, fit: 'cover', focus: { x: 0.5, y: 0.5 }, cornerRadius: 0, shadow: false },
    ],
  },
  {
    id: 'lay-screen',
    name: 'Screen',
    slots: [
      { source: 'screen', rect: { x: 0, y: 0, w: 1, h: 1 }, fit: 'cover', focus: { x: 0.5, y: 0.5 }, cornerRadius: 0, shadow: false },
    ],
  },
  {
    id: 'lay-side-by-side',
    name: 'Side by side',
    slots: [
      { source: 'screen', rect: { x: 0.015, y: 0.235, w: 0.475, h: 0.53 }, fit: 'cover', focus: { x: 0.5, y: 0.5 }, cornerRadius: 0.06, shadow: false },
      { source: 'camera', rect: { x: 0.51, y: 0.235, w: 0.475, h: 0.53 }, fit: 'cover', focus: { x: 0.5, y: 0.5 }, cornerRadius: 0.06, shadow: false },
    ],
  },
]

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: 'talking-head',
    name: 'Talking head',
    description:
      'One 90s camera clip on an A-roll track plus a quiet music bed. The starting point ' +
      'for tutorials, demos, and social clips. Replace the asset srcs with your media.',
    build: () =>
      dispatchAll(
        createProject({ id: 'p-talking-head', name: 'Talking head', width: 1920, height: 1080, fps: 30 }),
        [
          {
            type: 'addAsset',
            asset: {
              id: 'a-camera', kind: 'video', src: 'media/camera.mp4', name: 'camera.mp4',
              mimeType: 'video/mp4', durationMs: 90000, width: 1920, height: 1080,
            },
          },
          {
            type: 'addAsset',
            asset: {
              id: 'a-music', kind: 'audio', src: 'media/music.mp3', name: 'music.mp3',
              mimeType: 'audio/mpeg', durationMs: 120000,
            },
          },
          { type: 'renameTrack', trackId: 't-default', name: 'A-roll' },
          {
            type: 'addElement',
            trackId: 't-default',
            element: { id: 'e-camera', type: 'video', startMs: 0, durationMs: 90000, assetId: 'a-camera' },
          },
          { type: 'addTrack', id: 't-music', name: 'Music', index: 0 },
          {
            type: 'addElement',
            trackId: 't-music',
            element: { id: 'e-music', type: 'audio', startMs: 0, durationMs: 90000, assetId: 'a-music', volume: 0.2 },
          },
        ],
      ),
  },
  {
    id: 'multicam-podcast',
    name: 'Multicam podcast',
    description:
      'A screen recording and a camera combined into one multicam element with the four ' +
      'stock layouts saved. Add angle cuts to switch compositions; audio follows the camera.',
    build: () =>
      dispatchAll(
        createProject({ id: 'p-multicam-podcast', name: 'Multicam podcast', width: 1920, height: 1080, fps: 30 }),
        [
          {
            type: 'addAsset',
            asset: {
              id: 'a-screen', kind: 'video', src: 'media/screen.mp4', name: 'screen.mp4',
              mimeType: 'video/mp4', durationMs: 90000, width: 1920, height: 1080,
            },
          },
          {
            type: 'addAsset',
            asset: {
              id: 'a-camera', kind: 'video', src: 'media/camera.mp4', name: 'camera.mp4',
              mimeType: 'video/mp4', durationMs: 90000, width: 1920, height: 1080,
            },
          },
          { type: 'renameTrack', trackId: 't-default', name: 'Screen' },
          {
            type: 'addElement',
            trackId: 't-default',
            element: { id: 'e-screen', type: 'video', startMs: 0, durationMs: 90000, assetId: 'a-screen' },
          },
          { type: 'addTrack', id: 't-camera', name: 'Camera' },
          {
            type: 'addElement',
            trackId: 't-camera',
            element: { id: 'e-camera', type: 'video', startMs: 0, durationMs: 90000, assetId: 'a-camera' },
          },
          ...LAYOUTS.map((layout) => ({ type: 'saveLayout', layout }) as AnyCommand),
          // Bottom layer (t-default) becomes the "screen" role, top the "camera".
          { type: 'createMulticam', elementIds: ['e-screen', 'e-camera'], multicamId: 'e-multicam' },
          { type: 'removeTrack', trackId: 't-camera' },
        ],
      ),
  },
  {
    id: 'slideshow',
    name: 'Slideshow',
    description:
      'Three photos butt-cut on one track in a vertical (9:16) frame. Add ken-burns ' +
      'emphasis and dissolves to make it move.',
    build: () =>
      dispatchAll(
        createProject({ id: 'p-slideshow', name: 'Slideshow', width: 1080, height: 1920, fps: 30 }),
        [
          ...[1, 2, 3].map(
            (n) =>
              ({
                type: 'addAsset',
                asset: {
                  id: `a-photo-${n}`, kind: 'image', src: `media/photo-${n}.jpg`, name: `photo-${n}.jpg`,
                  mimeType: 'image/jpeg', width: 2000, height: 1333,
                },
              }) as AnyCommand,
          ),
          { type: 'renameTrack', trackId: 't-default', name: 'Photos' },
          ...[1, 2, 3].map(
            (n) =>
              ({
                type: 'addElement',
                trackId: 't-default',
                element: {
                  id: `e-photo-${n}`, type: 'image', startMs: (n - 1) * 4000, durationMs: 4000,
                  assetId: `a-photo-${n}`,
                },
              }) as AnyCommand,
          ),
        ],
      ),
  },
]

export function buildTemplate(id: string): Project {
  const template = TEMPLATES.find((t) => t.id === id)
  if (!template) throw new Error(`unknown template "${id}"`)
  return template.build()
}
