import { MkvOutputFormat, Mp4OutputFormat, WebMOutputFormat, type OutputFormat } from 'mediabunny'

/**
 * The container-format registry — export's counterpart to the timeline's
 * element-type registry. A container format is an output vocabulary entry:
 * its id (also the default file extension), a UI label, and a factory for
 * the Mediabunny {@link OutputFormat} that muxes it.
 *
 * The built-in formats (mp4, webm, mkv) register through this exact API, so
 * community formats are first-class: they show up in `listContainerFormats`
 * (which the export dialog renders), pass WebCodecs support probing via
 * `getExportSupport`, and export via `exportProject({ format: id })`.
 *
 * Register custom formats at module load, before the export UI mounts.
 */

export interface ContainerFormatEntry {
  /** Registry key, accepted as `ExportProjectOptions.format`. */
  id: string
  /** UI label (e.g. `'MP4'`). */
  label: string
  /** Suggested file extension, without the dot. */
  extension: string
  /** Output MIME type (e.g. `'video/mp4'`). */
  mimeType: string
  /** Build a fresh Mediabunny output format for one export. */
  createOutputFormat: () => OutputFormat
}

const registry = new Map<string, ContainerFormatEntry>()

export function registerContainerFormat(entry: ContainerFormatEntry): void {
  if (registry.has(entry.id)) {
    throw new Error(`container format "${entry.id}" is already registered`)
  }
  registry.set(entry.id, entry)
}

export function getContainerFormat(id: string): ContainerFormatEntry | undefined {
  return registry.get(id)
}

/** Every registered container format, in registration order (built-ins first). */
export function listContainerFormats(): ContainerFormatEntry[] {
  return [...registry.values()]
}

registerContainerFormat({
  id: 'mp4',
  label: 'MP4',
  extension: 'mp4',
  mimeType: 'video/mp4',
  createOutputFormat: () => new Mp4OutputFormat(),
})

registerContainerFormat({
  id: 'webm',
  label: 'WebM',
  extension: 'webm',
  mimeType: 'video/webm',
  createOutputFormat: () => new WebMOutputFormat(),
})

registerContainerFormat({
  id: 'mkv',
  label: 'MKV',
  extension: 'mkv',
  mimeType: 'video/x-matroska',
  createOutputFormat: () => new MkvOutputFormat(),
})
