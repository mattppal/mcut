import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

const AGENT_TOOL_NAMES = [
  "get_summary",
  "get_project",
  "get_media_context",
  "get_audio_activity",
  "get_transcript",
  "search_transcript",
  "ensure_transcript",
  "list_commands",
  "apply_commands",
  "apply_captions",
  "apply_silence_cuts",
  "lint_project",
  "list_presets",
  "list_operators",
  "run_operator",
  "list_actions",
  "run_action",
  "undo",
  "redo",
];

const FULL_TOOL_COUNT = 120;

type Tool = { name: string; description: string; inputSchema: { type: string; properties: object } };

test("serves the curated agent profile at /tools.json and every command under ?profile=full", async ({
  request,
}) => {
  const res = await request.get("/tools.json");
  expect(res.ok()).toBe(true);
  const agent: { profile: string; tools: Tool[] } = await res.json();
  expect(agent.profile).toBe("agent");
  expect(
    agent.tools.map((tool) => tool.name),
    "MCP_AGENT_TOOL_NAMES in @mcut/mcp-server/contract",
  ).toEqual(AGENT_TOOL_NAMES);

  const fullRes = await request.get("/tools.json?profile=full");
  expect(fullRes.ok()).toBe(true);
  const full: { profile: string; tools: Tool[] } = await fullRes.json();
  expect(full.profile).toBe("full");
  expect(
    full.tools.length,
    "19 agent tools (16 server static + 3 bridge only) + 42 editor operators + 59 timeline commands",
  ).toBe(FULL_TOOL_COUNT);
  const split = full.tools.find((tool) => tool.name === "splitElement");
  expect(split?.description).toContain("Split");
  expect(split?.inputSchema.type).toBe("object");
  expect(Object.keys(split?.inputSchema.properties ?? {})).toContain("elementId");
});

test("renders the human-readable tool catalog at /tools", async ({ page }) => {
  await page.goto("/tools");
  await expect(page.getByRole("heading", { name: /MCP tools/ })).toHaveText(
    new RegExp(`\\(${AGENT_TOOL_NAMES.length}\\)`),
  );
  await expect(page.getByText("apply_commands", { exact: true })).toBeVisible();

  await page.goto("/tools?profile=full");
  await expect(page.getByRole("heading", { name: /MCP tools/ })).toHaveText(
    new RegExp(`\\(${FULL_TOOL_COUNT}\\)`),
  );
  await expect(page.getByText("splitElement", { exact: true })).toBeVisible();
});

test("hosts the mcut agent skill under /.well-known/agent-skills", async ({ request }) => {
  const indexRes = await request.get("/.well-known/agent-skills/index.json");
  expect(indexRes.ok()).toBe(true);
  const index = await indexRes.json();
  const skill = index.skills.find((s: { name: string }) => s.name === "mcut");
  expect(skill).toBeDefined();
  expect(skill.type).toBe("skill-md");

  const skillRes = await request.get(skill.url);
  expect(skillRes.ok()).toBe(true);
  const body = await skillRes.body();
  expect(body.toString("utf8")).toContain("name: mcut");

  const digest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  expect(
    digest,
    "index.json digest is stale; regenerate with: shasum -a 256 public/.well-known/agent-skills/mcut/SKILL.md",
  ).toBe(skill.digest);
});
