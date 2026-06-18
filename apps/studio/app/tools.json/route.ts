import { listMcpToolDefinitions } from "@/registry/mcut/mcp-tools";
import { parseMcpToolProfile } from "@/registry/mcut/mcp-tool-contract";

/**
 * MCP-shaped tool manifest (the `tools/list` result): static context tools,
 * editor operator tools, and every raw timeline command. Human-readable
 * version at /tools.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const profile = parseMcpToolProfile(new URL(request.url).searchParams.get("profile"));
  return Response.json({ profile, tools: listMcpToolDefinitions(profile) });
}
