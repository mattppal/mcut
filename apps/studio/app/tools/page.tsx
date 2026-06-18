import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { listMcpToolDefinitions } from "@/registry/mcut/mcp-tools";
import {
  MCP_TOOL_PROFILES,
  parseMcpToolProfile,
  type McpToolProfile,
} from "@/registry/mcut/mcp-tool-contract";

export const metadata: Metadata = {
  title: "mcut — MCP tools",
  description:
    "The full mcut MCP tool surface: project context, undo/redo, editor operators, and raw timeline commands.",
};

type JsonSchema = Record<string, unknown>;
type SearchParams = Record<string, string | string[] | undefined>;

function typeOf(schema: unknown): string {
  if (!schema || typeof schema !== "object") return "any";
  const s = schema as JsonSchema;
  if (typeof s.type === "string") {
    if (s.type === "array") return `${typeOf(s.items)}[]`;
    return s.type;
  }
  if (s.enum) return "enum";
  if (s.anyOf || s.oneOf || s.allOf) return "union";
  return "any";
}

function paramSummary(inputSchema: JsonSchema): string {
  const properties = (inputSchema.properties ?? {}) as Record<string, unknown>;
  const required = new Set((inputSchema.required as string[]) ?? []);
  return Object.entries(properties)
    .map(([key, p]) => `${key}${required.has(key) ? "" : "?"}: ${typeOf(p)}`)
    .join("   ");
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function profileLabel(profile: McpToolProfile): string {
  if (profile === "agent") return "Agent";
  if (profile === "full") return "Full";
  return "Commands";
}

export default async function ToolsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams> | SearchParams;
}) {
  const params = searchParams ? await searchParams : {};
  const profile = parseMcpToolProfile(first(params.profile));
  const tools = listMcpToolDefinitions(profile);
  return (
    <div className="flex flex-1 flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between px-6 py-6">
        <Link href="/" aria-label="mcut Studio">
          <BrandMark wordmark />
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          <a
            className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            href="/.well-known/agent-skills/index.json"
          >
            agent skills
          </a>
          <a
            className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            href={`/tools.json?profile=${profile}`}
          >
            tools.json
          </a>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6">
        <section className="flex flex-col gap-4 pt-16 pb-10">
          <h1 className="text-3xl tracking-tight">
            MCP tools{" "}
            <span className="text-muted-foreground">({tools.length})</span>
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            The default agent profile is curated for normal editing sessions. Full
            exposes every operator and raw command for debugging, docs, and tooling.
            The machine-readable manifest is at{" "}
            <a
              className="underline underline-offset-2 hover:text-foreground"
              href={`/tools.json?profile=${profile}`}
            >
              /tools.json
            </a>
            .
          </p>
          <div className="flex flex-wrap gap-2">
            {MCP_TOOL_PROFILES.map((candidate) => {
              const active = candidate === profile;
              return (
                <a
                  key={candidate}
                  href={candidate === "agent" ? "/tools" : `/tools?profile=${candidate}`}
                  className={
                    active
                      ? "rounded border bg-muted px-2 py-1 text-xs"
                      : "rounded border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  }
                >
                  {profileLabel(candidate)} ({listMcpToolDefinitions(candidate).length})
                </a>
              );
            })}
          </div>
        </section>

        <dl className="pb-24">
          {tools.map((tool) => {
            const params = paramSummary(tool.inputSchema);
            return (
              <div key={tool.name} className="grid gap-1 border-b py-4 last:border-b-0">
                <dt className="font-mono text-sm font-medium">{tool.name}</dt>
                <dd className="text-sm leading-relaxed text-muted-foreground">
                  {tool.description}
                </dd>
                {params && (
                  <dd className="overflow-x-auto font-mono text-2xs whitespace-pre text-muted-foreground/70">
                    {params}
                  </dd>
                )}
              </div>
            );
          })}
        </dl>
      </main>
    </div>
  );
}
