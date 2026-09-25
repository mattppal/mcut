import { EditorEngine, createProject, type BuiltinCommand, type CommandOfType, type Project } from '@mcut/timeline'

export interface TemplateDefinition {
  id: string
  name: string
  description: string
  build: () => Project
}

function dispatchAll(project: Project, commands: BuiltinCommand[]): Project {
  const engine = new EditorEngine({ project })
  for (const command of commands) engine.dispatch(command)
  return engine.project
}

const FIXED_ID_LAYOUTS: CommandOfType<'saveLayout'>['layout'][] = [
  {
    id: 'lay-screen-cam',
    name: 'Screen + Cam',
    slots: [
      { source: 'screen', rect: { x: 0, y: 0, w: 1, h: 1 }, fit: 'cover' },
      {
        source: 'camera',
        rect: { x: 0.7, y: 0.69, w: 0.275, h: 0.275 },
        fit: 'cover',
        cornerRadius: 0.12,
        shadow: { color: 'rgba(0, 0, 0, 0.45)', blur: 36, offsetX: 0, offsetY: 12 },
      },
    ],
  },
  {
    id: 'lay-camera',
    name: 'Camera',
    slots: [{ source: 'camera', rect: { x: 0, y: 0, w: 1, h: 1 }, fit: 'cover' }],
  },
  {
    id: 'lay-screen',
    name: 'Screen',
    slots: [{ source: 'screen', rect: { x: 0, y: 0, w: 1, h: 1 }, fit: 'cover' }],
  },
  {
    id: 'lay-side-by-side',
    name: 'Side by side',
    slots: [
      { source: 'screen', rect: { x: 0.015, y: 0.235, w: 0.475, h: 0.53 }, fit: 'cover', cornerRadius: 0.06 },
      { source: 'camera', rect: { x: 0.51, y: 0.235, w: 0.475, h: 0.53 }, fit: 'cover', cornerRadius: 0.06 },
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
      dispatchAll(createProject({ id: 'p-talking-head', name: 'Talking head', width: 1920, height: 1080, fps: 30 }), [
        {
          type: 'addAsset',
          asset: {
            id: 'a-camera',
            kind: 'video',
            src: 'media/camera.mp4',
            name: 'camera.mp4',
            mimeType: 'video/mp4',
            durationMs: 90000,
            width: 1920,
            height: 1080,
          },
        },
        {
          type: 'addAsset',
          asset: {
            id: 'a-music',
            kind: 'audio',
            src: 'media/music.mp3',
            name: 'music.mp3',
            mimeType: 'audio/mpeg',
            durationMs: 120000,
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
      ]),
  },
  {
    id: 'multicam-podcast',
    name: 'Multicam podcast',
    description:
      'A screen recording and a camera combined into one multicam element with the four ' +
      'stock layouts saved. Add angle cuts to switch compositions; audio follows the camera.',
    build: () =>
      dispatchAll(createProject({ id: 'p-multicam-podcast', name: 'Multicam podcast', width: 1920, height: 1080, fps: 30 }), [
        {
          type: 'addAsset',
          asset: {
            id: 'a-screen',
            kind: 'video',
            src: 'media/screen.mp4',
            name: 'screen.mp4',
            mimeType: 'video/mp4',
            durationMs: 90000,
            width: 1920,
            height: 1080,
          },
        },
        {
          type: 'addAsset',
          asset: {
            id: 'a-camera',
            kind: 'video',
            src: 'media/camera.mp4',
            name: 'camera.mp4',
            mimeType: 'video/mp4',
            durationMs: 90000,
            width: 1920,
            height: 1080,
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
        ...FIXED_ID_LAYOUTS.map((layout) => ({ type: 'saveLayout', layout }) satisfies BuiltinCommand),
        { type: 'createMulticam', elementIds: ['e-screen', 'e-camera'], multicamId: 'e-multicam' },
        { type: 'removeTrack', trackId: 't-camera' },
      ]),
  },
  {
    id: 'slideshow',
    name: 'Slideshow',
    description: 'Three photos butt-cut on one track in a vertical (9:16) frame. Add ken-burns ' + 'emphasis and dissolves to make it move.',
    build: () =>
      dispatchAll(createProject({ id: 'p-slideshow', name: 'Slideshow', width: 1080, height: 1920, fps: 30 }), [
        ...[1, 2, 3].map(
          (n) =>
            ({
              type: 'addAsset',
              asset: {
                id: `a-photo-${n}`,
                kind: 'image',
                src: `media/photo-${n}.jpg`,
                name: `photo-${n}.jpg`,
                mimeType: 'image/jpeg',
                width: 2000,
                height: 1333,
              },
            }) satisfies BuiltinCommand,
        ),
        { type: 'renameTrack', trackId: 't-default', name: 'Photos' },
        ...[1, 2, 3].map(
          (n) =>
            ({
              type: 'addElement',
              trackId: 't-default',
              element: {
                id: `e-photo-${n}`,
                type: 'image',
                startMs: (n - 1) * 4000,
                durationMs: 4000,
                assetId: `a-photo-${n}`,
              },
            }) satisfies BuiltinCommand,
        ),
      ]),
  },
]

export function buildTemplate(id: string): Project {
  const template = TEMPLATES.find((t) => t.id === id)
  if (!template) throw new Error(`unknown template "${id}"`)
  return template.build()
}
