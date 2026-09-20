import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import { z } from 'zod'

const storedSettingsSchema = z.object({
  transcriptionKey: z.string().nullable().default(null),
})

type StoredSettings = z.infer<typeof storedSettingsSchema>

export interface DesktopSettings {
  transcriptionConfigured(): boolean
  transcriptionKey(): string | null
  setTranscriptionKey(key: string): boolean
}

const EMPTY_SETTINGS: StoredSettings = { transcriptionKey: null }

function readStoredSettings(file: string): StoredSettings {
  if (!existsSync(file)) return EMPTY_SETTINGS
  try {
    const parsed = storedSettingsSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
    if (parsed.success) return parsed.data
    process.stderr.write(`${file} does not match the settings schema, starting with empty settings.\n${z.prettifyError(parsed.error)}\n`)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    process.stderr.write(`${file} is not JSON, starting with empty settings.\n`)
  }
  return EMPTY_SETTINGS
}

function writeStoredSettings(file: string, settings: StoredSettings): void {
  const part = `${file}.part`
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(part, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
  renameSync(part, file)
}

export function reportSafeStorageBackend(): void {
  if (process.platform !== 'linux') return
  process.stdout.write(`SAFE_STORAGE_BACKEND ${safeStorage.getSelectedStorageBackend()}\n`)
}

export function openSettings(file: string): DesktopSettings {
  let stored = readStoredSettings(file)
  return {
    transcriptionConfigured: () => stored.transcriptionKey !== null,
    transcriptionKey: () => (stored.transcriptionKey === null ? null : safeStorage.decryptString(Buffer.from(stored.transcriptionKey, 'base64'))),
    setTranscriptionKey: (key) => {
      const trimmed = key.trim()
      stored = { transcriptionKey: trimmed.length === 0 ? null : safeStorage.encryptString(trimmed).toString('base64') }
      writeStoredSettings(file, stored)
      return stored.transcriptionKey !== null
    },
  }
}
