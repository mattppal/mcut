import { expect, test } from "@playwright/test";
import { clip, openEditor, openLeftTab } from "./helpers";

const selectedClips = (page: import("@playwright/test").Page) =>
  page.locator('[data-mcut-clip][class*="ring-2"]');

async function addTwoTitles(page: import("@playwright/test").Page) {
  await openLeftTab(page, "text");
  await page.getByTitle(/Title — drag/).click();
  await page.getByTitle(/Subtitle — drag/).click();
  await expect(clip(page)).toHaveCount(2);
}

test("⌘A selects every clip; ⇧⌘A deselects", async ({ page }) => {
  await openEditor(page);
  await addTwoTitles(page);
  await page.keyboard.press("ControlOrMeta+a");
  await expect(selectedClips(page)).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+Shift+a");
  await expect(selectedClips(page)).toHaveCount(0);
});

test("copy/paste at playhead round-trips a clip", async ({ page }) => {
  await openEditor(page);
  await openLeftTab(page, "text");
  await page.getByTitle(/Title — drag/).click();
  await expect(clip(page)).toHaveCount(1);
  const original = (await clip(page).first().boundingBox())!;

  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("Shift+ArrowRight"); // +1s
  await page.keyboard.press("Shift+ArrowRight"); // +2s
  await page.keyboard.press("Shift+ArrowRight"); // +3s (past the 3s clip)
  await page.keyboard.press("Shift+ArrowRight"); // +4s
  await page.keyboard.press("ControlOrMeta+v");

  await expect(clip(page)).toHaveCount(2);
  const pasted = (await clip(page).nth(1).boundingBox())!;
  expect(pasted.x).toBeGreaterThan(original.x + 50); // landed at the playhead
  // Pasted clip becomes the selection
  await expect(selectedClips(page)).toHaveCount(1);
});

test("cut removes, paste restores; ⌘D duplicates", async ({ page }) => {
  await openEditor(page);
  await openLeftTab(page, "text");
  await page.getByTitle(/Title — drag/).click();
  await page.keyboard.press("ControlOrMeta+x");
  await expect(clip(page)).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+v");
  await expect(clip(page)).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+d");
  await expect(clip(page)).toHaveCount(2);
});

test("track header click selects that track's clips", async ({ page }) => {
  await openEditor(page);
  await addTwoTitles(page);
  await page.keyboard.press("ControlOrMeta+Shift+a"); // ensure clean slate
  // Click the first (topmost) track header's name area
  await page.locator("[data-mcut-timeline] span.truncate").first().click();
  await expect(selectedClips(page)).toHaveCount(1);
});

test("⌘K palette runs registry actions with shortcuts shown", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByPlaceholder("Type a command…")).toBeVisible();
  await page.getByPlaceholder("Type a command…").fill("add text");
  await page.getByText("Add text at playhead").click();
  await expect(clip(page)).toHaveCount(1);
});
