import { expect, test } from "@playwright/test";
import {
  clip,
  collectErrors,
  dragAssetToLane,
  importPng,
  importWebm,
  openEditor,
  openLeftTab,
  previewPixels,
} from "./helpers";

/**
 * Baseline spec: freezes the editor's core behavior so refactors (action
 * registry, parity batches) can't silently regress it.
 */

test("loads without console errors", async ({ page }) => {
  const errors = collectErrors(page);
  await openEditor(page);
  await expect(page.getByRole("button", { name: "Go to start" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("text preset inserts a selected clip; undo removes it", async ({ page }) => {
  await openEditor(page);
  await openLeftTab(page, "text");
  await page.getByTitle(/Title — drag/).click();
  await expect(clip(page)).toHaveCount(1);
  // Inspector shows the selected text element
  await openLeftTab(page, "animate"); // any tab; inspector is right panel
  await expect(page.locator("aside, [data-editor]").getByText("MOTION").first()).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(clip(page)).toHaveCount(0);
});

test("imported image drags onto a lane with a ghost preview", async ({ page }) => {
  await openEditor(page);
  await importPng(page, "blue.png");
  await dragAssetToLane(page, /blue.png/, { offsetX: 300 });
  await expect(clip(page)).toHaveCount(1);
  // Dropped on the existing track — no extra track created.
  await expect(page.locator("[data-mcut-lane]")).toHaveCount(1);
});

test("drop ghost stays visible over a timeline that already has clips", async ({ page }) => {
  await openEditor(page);
  await openLeftTab(page, "text");
  await page.getByTitle(/Title — drag/).click();
  await page.getByTitle(/Subtitle — drag/).click();
  await expect(clip(page)).toHaveCount(2);

  await openLeftTab(page, "media");
  await importPng(page, "ghost.png");
  const card = page.getByTitle(/ghost\.png/).first();
  const cardBox = (await card.boundingBox())!;
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cardBox.x + 70, cardBox.y + 90, { steps: 5 });

  const laneBox = (await page.locator("[data-mcut-lane]").first().boundingBox())!;
  await page.mouse.move(laneBox.x + 80, laneBox.y + laneBox.height / 2, { steps: 10 });
  await expect(page.locator("[data-mcut-drop-ghost]")).toBeVisible();

  await page.mouse.move(laneBox.x + 360, laneBox.y + laneBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(clip(page)).toHaveCount(3);
});

test("clip trims from the right edge", async ({ page }) => {
  await openEditor(page);
  await importPng(page, "trim.png");
  await dragAssetToLane(page, /trim.png/, { offsetX: 150 });
  const target = clip(page).first();
  const before = (await target.boundingBox())!;
  await page.mouse.move(before.x + before.width - 3, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width - 80, before.y + before.height / 2, { steps: 6 });
  await page.mouse.up();
  const after = (await target.boundingBox())!;
  expect(after.width).toBeLessThan(before.width - 50);
});

test("fade-in preset animates opacity on the canvas", async ({ page }) => {
  await openEditor(page);
  await openLeftTab(page, "text");
  await page.getByTitle(/Title — drag/).click();
  await openLeftTab(page, "animate");
  await page.locator('[data-preset="fade-in"]').click();
  await expect(page.getByText(/fade in applied/)).toBeVisible();
  // Keyframe diamonds on the selected clip
  expect(await page.locator("[data-mcut-clip] button[title*='Keyframe']").count()).toBeGreaterThan(0);
  // Invisible at t=0, visible mid-fade-in
  await page.getByRole("button", { name: "Go to start" }).click();
  await page.waitForTimeout(300);
  const atStart = await previewPixels(page);
  await page.keyboard.press("Shift+ArrowRight");
  await page.waitForTimeout(300);
  const atOneSecond = await previewPixels(page);
  expect(atStart).toBe(0);
  expect(atOneSecond).toBeGreaterThan(100);
});

test("real video imports, drags, and shows a filmstrip", async ({ page }) => {
  test.slow();
  await openEditor(page);
  await importWebm(page, "demo.webm");
  const card = page.getByTitle(/demo\.webm/).first();
  await expect(card.locator("img")).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(
      () =>
        card.locator("img").evaluate((img) => {
          const image = img as HTMLImageElement;
          return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
        }),
      { timeout: 10_000 },
    )
    .toBe(true);
  await dragAssetToLane(page, /demo.webm/, { offsetX: 120 });
  await expect(clip(page)).toHaveCount(1);
  // Filmstrip canvas inside the clip eventually paints real pixels.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const canvas = document.querySelector<HTMLCanvasElement>(
            "[data-mcut-clip=video] canvas",
          );
          if (!canvas) return -1;
          const ctx = canvas.getContext("2d")!;
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let lit = 0;
          for (let i = 0; i < data.length; i += 16) {
            if (data[i]! > 30 || data[i + 1]! > 30 || data[i + 2]! > 30) lit++;
          }
          return lit;
        }),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(100);
});
