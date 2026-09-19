import { MkvOutputFormat, Mp4OutputFormat, WebMOutputFormat, type OutputFormat } from 'mediabunny'

export interface ContainerFormat {
  label: string
  extension: string
  mimeType: string
  createOutputFormat: () => OutputFormat
}

export const containerFormats = {
  mp4: {
    label: 'MP4',
    extension: 'mp4',
    mimeType: 'video/mp4',
    createOutputFormat: () => new Mp4OutputFormat(),
  },
  webm: {
    label: 'WebM',
    extension: 'webm',
    mimeType: 'video/webm',
    createOutputFormat: () => new WebMOutputFormat(),
  },
  mkv: {
    label: 'MKV',
    extension: 'mkv',
    mimeType: 'video/x-matroska',
    createOutputFormat: () => new MkvOutputFormat(),
  },
} satisfies Record<string, ContainerFormat>

export type ContainerFormatId = keyof typeof containerFormats

export interface ContainerFormatEntry extends ContainerFormat {
  id: ContainerFormatId
}

function isContainerFormatId(value: string): value is ContainerFormatId {
  return Object.hasOwn(containerFormats, value)
}

export function listContainerFormats(): ContainerFormatEntry[] {
  return Object.keys(containerFormats)
    .filter(isContainerFormatId)
    .map((id) => ({ id, ...containerFormats[id] }))
}
