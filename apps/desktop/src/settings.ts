import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { safeStorage } from 'electron'
import { z } from 'zod'

const TRANSCRIPTION_KEY = 'assemblyai.apiKey'

const legacySettingsSchema = z.object({
  transcriptionKey: z.string().nullable().default(null),
})

const secretRowSchema = z.object({ value: z.instanceof(Uint8Array) })

export interface DesktopSettings {
  transcriptionConfigured(): boolean
  transcriptionKey(): string | null
  setTranscriptionKey(key: string): boolean
}

function readLegacyKey(file: string): Buffer | null {
  let json: unknown
  try {
    json = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    process.stderr.write(`${file} is not JSON, nothing to migrate.\n`)
    return null
  }
  const parsed = legacySettingsSchema.safeParse(json)
  if (!parsed.success) {
    process.stderr.write(`${file} does not match the settings schema, nothing to migrate.\n${z.prettifyError(parsed.error)}\n`)
    return null
  }
  return parsed.data.transcriptionKey === null ? null : Buffer.from(parsed.data.transcriptionKey, 'base64')
}

export function reportSafeStorageBackend(): void {
  if (process.platform !== 'linux') return
  process.stdout.write(`SAFE_STORAGE_BACKEND ${safeStorage.getSelectedStorageBackend()}\n`)
}

export function openSettings(directory: string): DesktopSettings {
  mkdirSync(directory, { recursive: true })
  const db = new DatabaseSync(path.join(directory, 'settings.db'))
  db.exec('CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, value BLOB NOT NULL) STRICT')
  const select = db.prepare('SELECT value FROM secrets WHERE name = ?')
  const upsert = db.prepare('INSERT INTO secrets (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value')
  const remove = db.prepare('DELETE FROM secrets WHERE name = ?')

  const readSecret = (name: string): Buffer | null => {
    const row = select.get(name)
    return row === undefined ? null : Buffer.from(secretRowSchema.parse(row).value)
  }

  const legacyFile = path.join(directory, 'settings.json')
  if (existsSync(legacyFile)) {
    const legacy = readLegacyKey(legacyFile)
    if (legacy !== null && readSecret(TRANSCRIPTION_KEY) === null) upsert.run(TRANSCRIPTION_KEY, legacy)
    rmSync(legacyFile)
  }

  return {
    transcriptionConfigured: () => readSecret(TRANSCRIPTION_KEY) !== null,
    transcriptionKey: () => {
      const encrypted = readSecret(TRANSCRIPTION_KEY)
      return encrypted === null ? null : safeStorage.decryptString(encrypted)
    },
    setTranscriptionKey: (key) => {
      const trimmed = key.trim()
      if (trimmed.length === 0) {
        remove.run(TRANSCRIPTION_KEY)
        return false
      }
      upsert.run(TRANSCRIPTION_KEY, safeStorage.encryptString(trimmed))
      return true
    },
  }
}
