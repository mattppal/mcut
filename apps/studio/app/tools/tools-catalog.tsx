'use client'

import { use } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { z } from 'zod'
import { MCP_TOOL_PROFILES, parseMcpToolProfile, type McpToolProfile } from '@mcut/mcp-server/contract'
import { BrandMark } from '@/components/brand-mark'

const jsonSchemaSchema = z.record(z.string(), z.unknown())
const manifestSchema = z.object({
  profile: z.string(),
  tools: z.array(z.object({ name: z.string(), description: z.string(), inputSchema: jsonSchemaSchema })),
})
type Manifest = z.infer<typeof manifestSchema>
type ManifestResult = { ok: true; manifest: Manifest } | { ok: false; error: string }

const manifests = new Map<McpToolProfile, Promise<ManifestResult>>()

async function fetchManifest(profile: McpToolProfile): Promise<ManifestResult> {
  const path = `/tools.${profile}.json`
  try {
    const response = await fetch(path)
    if (!response.ok) return { ok: false, error: `Failed to load ${path} (${response.status})` }
    const parsed = manifestSchema.safeParse(await response.json())
    return parsed.success ? { ok: true, manifest: parsed.data } : { ok: false, error: `${path} is malformed. ${z.prettifyError(parsed.error)}` }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : `Failed to load ${path}` }
  }
}

function loadManifest(profile: McpToolProfile): Promise<ManifestResult> {
  const cached = manifests.get(profile)
  if (cached) return cached
  const pending = fetchManifest(profile)
  manifests.set(profile, pending)
  return pending
}

function typeOf(schema: unknown): string {
  const parsed = jsonSchemaSchema.safeParse(schema)
  if (!parsed.success) return 'any'
  const s = parsed.data
  if (typeof s.type === 'string') {
    if (s.type === 'array') return `${typeOf(s.items)}[]`
    return s.type
  }
  if (s.enum) return 'enum'
  if (s.anyOf || s.oneOf || s.allOf) return 'union'
  return 'any'
}

function paramSummary(inputSchema: z.infer<typeof jsonSchemaSchema>): string {
  const properties = jsonSchemaSchema.safeParse(inputSchema.properties)
  const required = new Set(z.array(z.string()).catch([]).parse(inputSchema.required))
  return Object.entries(properties.success ? properties.data : {})
    .map(([key, p]) => `${key}${required.has(key) ? '' : '?'}: ${typeOf(p)}`)
    .join('   ')
}

function profileLabel(profile: McpToolProfile): string {
  if (profile === 'agent') return 'Agent'
  if (profile === 'full') return 'Full'
  return 'Commands'
}

export function ToolsCatalog({ counts }: { counts: Record<McpToolProfile, number> }) {
  const profile = parseMcpToolProfile(useSearchParams().get('profile'))
  const result = use(loadManifest(profile))
  const tools = result.ok ? result.manifest.tools : []
  const manifestHref = `/tools.${profile}.json`
  return (
    <div className="flex flex-1 flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between px-6 py-6">
        <Link href="/" aria-label="mcut Studio">
          <BrandMark wordmark />
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          <a className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground" href="/.well-known/agent-skills/index.json">
            agent skills
          </a>
          <a className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground" href={manifestHref}>
            tools.json
          </a>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6">
        <section className="flex flex-col gap-4 pt-16 pb-10">
          <h1 className="text-3xl tracking-tight">
            MCP tools <span className="text-muted-foreground">({tools.length})</span>
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            The default agent profile is curated for normal editing sessions. Full exposes every operator and raw command for debugging, docs, and tooling. The
            machine-readable manifest is at{' '}
            <a className="underline underline-offset-2 hover:text-foreground" href={manifestHref}>
              {manifestHref}
            </a>
            .
          </p>
          <div className="flex flex-wrap gap-2">
            {MCP_TOOL_PROFILES.map((candidate) => {
              const active = candidate === profile
              return (
                <a
                  key={candidate}
                  href={candidate === 'agent' ? '/tools' : `/tools?profile=${candidate}`}
                  className={
                    active
                      ? 'rounded border bg-muted px-2 py-1 text-xs'
                      : 'rounded border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground'
                  }
                >
                  {profileLabel(candidate)} ({counts[candidate]})
                </a>
              )
            })}
          </div>
        </section>

        {!result.ok && <p className="pb-24 text-sm text-destructive">{result.error}</p>}

        <dl className="pb-24">
          {tools.map((tool) => {
            const params = paramSummary(tool.inputSchema)
            return (
              <div key={tool.name} className="grid gap-1 border-b py-4 last:border-b-0">
                <dt className="font-mono text-sm font-medium">{tool.name}</dt>
                <dd className="text-sm leading-relaxed text-muted-foreground">{tool.description}</dd>
                {params && <dd className="overflow-x-auto font-mono text-2xs whitespace-pre text-muted-foreground/70">{params}</dd>}
              </div>
            )
          })}
        </dl>
      </main>
    </div>
  )
}
