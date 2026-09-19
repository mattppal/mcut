import { parseMcpToolProfile } from "@mcut/mcp-server/contract";
import { listMcpToolDefinitions } from "@/registry/mcut/mcp-tools";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const profile = parseMcpToolProfile(new URL(request.url).searchParams.get("profile"));
  return Response.json({ profile, tools: listMcpToolDefinitions(profile) });
}
