import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ZodError } from 'zod'
import { parseLaunchOptions, resolveToken } from './bridge-config'

describe('parseLaunchOptions', () => {
  test('--port 0 selects an ephemeral bridge port', () => {
    const options = parseLaunchOptions({ argv: ['electron', '.', '--port', '0'], env: {} })
    expect(options.bridgePort).toBe('ephemeral')
    expect(options.tokenSource).toBe('persisted')
  })

  test('a token that is not 32 hex bytes fails to parse', () => {
    expect(() => parseLaunchOptions({ argv: ['electron', '.', '--token', 'mcut-local-dev'], env: {} })).toThrow(ZodError)
  })
})

describe('resolveToken', () => {
  test('a persisted token is created once and read back on the next launch', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mcut-desktop-token-'))
    const file = path.join(directory, 'user-data', 'bridge-token')
    expect(existsSync(file)).toBe(false)

    const first = resolveToken('persisted', file)
    const second = resolveToken('persisted', file)

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(second).toBe(first)
    expect(readFileSync(file, 'utf8').trim()).toBe(first)
    expect(readdirSync(path.dirname(file))).toEqual(['bridge-token'])
  })
})
