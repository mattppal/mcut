import { expect, test } from "@playwright/test";
import { stat } from "node:fs/promises";
import path from "node:path";
import { clip, collectErrors, dragAssetToLane, openEditor, openLeftTab } from "./helpers";

// Playwright's Chromium lacks the licensed codecs Chrome bundles, so the export under test is WebM rather than H.264. https://playwright.dev/docs/browsers#media-codecs
test("export renders a webm in the worker and downloads it", async ({ page }) => {
  test.slow();
  const errors = collectErrors(page);
  await openEditor(page);

  await page.setInputFiles(
    'input[type="file"]',
    path.join(__dirname, "fixtures", "fixture-vp9.mkv"),
  );
  await expect(page.getByTitle(/fixture-vp9\.mkv/)).toBeVisible({ timeout: 10_000 });
  await dragAssetToLane(page, /fixture-vp9\.mkv/, { offsetX: 120 });
  await expect(clip(page)).toHaveCount(1);

  await openLeftTab(page, "text");
  await page.getByTitle(/Title — drag/).click();
  await expect(clip(page)).toHaveCount(2);

  await page.locator("[data-mcut-export-trigger]").click();
  await page.getByRole("button", { name: "WebM", exact: true }).click();

  const downloadPromise = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "Export WebM" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.webm$/);
  const file = await download.path();
  expect((await stat(file)).size).toBeGreaterThan(10_000);

  expect(
    await page.evaluate(() => (globalThis as { __mcutLastExportMode?: string }).__mcutLastExportMode),
  ).toBe("worker");

  expect(errors).toEqual([]);
});
