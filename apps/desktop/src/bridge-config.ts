import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_BRIDGE_PORT } from '@mcut/mcp-server'
import { z } from 'zod'

export const bridgeTokenSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'A bridge token is 32 random bytes written as 64 lowercase hex characters.')
  .brand<'BridgeToken'>()

export type BridgeToken = z.infer<typeof bridgeTokenSchema>

export interface BridgeConfig {
  port: number
  token: BridgeToken
}

export type TokenSource = 'persisted' | 'random' | { fixed: BridgeToken }

export interface LaunchOptions {
  devUrl?: URL
  updateFeedUrl?: URL
  bridgePort: number | 'ephemeral'
  tokenSource: TokenSource
}

export interface LaunchSource {
  argv: readonly string[]
  env: NodeJS.ProcessEnv
}

const portSchema = z
  .string()
  .regex(/^\d{1,5}$/, 'A port is an integer between 0 and 65535.')
  .transform(Number)
  .pipe(z.number().int().max(65535))

const launchSchema = z
  .object({
    port: portSchema.default(DEFAULT_BRIDGE_PORT),
    token: z.union([z.literal('random'), bridgeTokenSchema]).optional(),
    devUrl: z.url().optional(),
    updateFeedUrl: z.url().optional(),
  })
  .transform((input): LaunchOptions => ({
    bridgePort: input.port === 0 ? 'ephemeral' : input.port,
    tokenSource: input.token === undefined ? 'persisted' : input.token === 'random' ? 'random' : { fixed: input.token },
    ...(input.devUrl === undefined ? {} : { devUrl: new URL(input.devUrl) }),
    ...(input.updateFeedUrl === undefined ? {} : { updateFeedUrl: new URL(input.updateFeedUrl) }),
  }))

function present(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value
}

function flag(argv: readonly string[], name: string): string | undefined {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`))
  if (inline !== undefined) return inline.slice(name.length + 1)
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}

export function parseLaunchOptions(source: LaunchSource): LaunchOptions {
  return launchSchema.parse({
    port: present(flag(source.argv, '--port')) ?? present(source.env.MCUT_BRIDGE_PORT),
    token: present(flag(source.argv, '--token')) ?? present(source.env.MCUT_BRIDGE_TOKEN),
    devUrl: present(source.env.MCUT_DEV_URL),
    updateFeedUrl: present(source.env.MCUT_UPDATE_FEED_URL),
  })
}

function freshToken(): BridgeToken {
  return bridgeTokenSchema.parse(randomBytes(32).toString('hex'))
}

function persistedToken(file: string): BridgeToken {
  if (existsSync(file)) {
    const stored = bridgeTokenSchema.safeParse(readFileSync(file, 'utf8').trim())
    if (stored.success) return stored.data
  }
  const token = freshToken()
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${token}\n`, { mode: 0o600 })
  return token
}

export function resolveToken(source: TokenSource, tokenFile: string): BridgeToken {
  if (typeof source === 'object') return source.fixed
  if (source === 'random') return freshToken()
  return persistedToken(tokenFile)
}
