import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

/**
 * Machine-discovery surfaces: the MCP tool manifest and the agent skill
 * hosted under the RFC 8615 well-known prefix. The digest assertion keeps
 * index.json honest when SKILL.md is edited — regenerate it with
 * `shasum -a 256 public/.well-known/agent-skills/mcut/SKILL.md`.
 */

test("serves the MCP tool manifest at /tools.json", async ({ request }) => {
  const res = await request.get("/tools.json");
  expect(res.ok()).toBe(true);
  const { tools } = await res.json();
  expect(tools.length).toBeGreaterThan(40);
  const split = tools.find((t: { name: string }) => t.name === "splitElement");
  expect(split.description).toContain("Split");
  expect(split.inputSchema.type).toBe("object");
  expect(Object.keys(split.inputSchema.properties)).toContain("elementId");
});

test("renders the human-readable tool catalog at /tools", async ({ page }) => {
  await page.goto("/tools");
  await expect(page.getByRole("heading", { name: /MCP tools/ })).toBeVisible();
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
  expect(digest).toBe(skill.digest);
});
