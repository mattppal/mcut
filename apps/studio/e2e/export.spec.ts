import { expect, test } from "@playwright/test";
import { stat } from "node:fs/promises";
import path from "node:path";
import { clip, collectErrors, dragAssetToLane, openEditor, openLeftTab } from "./helpers";

/**
 * End-to-end export through the worker pipeline: the dialog mixes audio on
 * the main thread, spawns the export worker (decode→composite→encode→mux),
 * and downloads the produced file. WebM keeps the assertion valid in the
 * codec-stripped Playwright Chromium build (no H.264 encoder there).
 */
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

  // A title exercises worker-side text rendering + the font transfer path.
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

  // The pipeline must have run in the dedicated worker, not the fallback.
  expect(
    await page.evaluate(() => (globalThis as { __mcutLastExportMode?: string }).__mcutLastExportMode),
  ).toBe("worker");

  expect(errors).toEqual([]);
});
