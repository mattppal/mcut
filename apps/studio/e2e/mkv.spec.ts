import { expect, test } from "@playwright/test";
import path from "node:path";
import {
  clip,
  collectErrors,
  dragAssetToLane,
  openEditor,
  previewPixels,
} from "./helpers";

/**
 * MKV has no native <video> support in Chromium, so the editor must fall
 * back to Mediabunny-decoded frames for the bin thumbnail, the clip
 * filmstrip, and the preview canvas. VP9 keeps the committed fixture
 * decodable in the codec-stripped Playwright Chromium build. To cover the
 * codecs real MKVs ship with, generate a fixture and point MCUT_CHROME_PATH
 * at an installed Chrome:
 *
 *   ffmpeg -f lavfi -i testsrc2=duration=2:size=640x360:rate=30 \
 *     -f lavfi -i sine=frequency=220:duration=2 \
 *     -c:v libx264 -pix_fmt yuv420p -c:a aac e2e/fixtures/fixture-h264.mkv
 *   MKV_FIXTURE=fixture-h264 MCUT_CHROME_PATH=... bunx playwright test e2e/mkv.spec.ts
 */
const fixture = process.env.MKV_FIXTURE ?? "fixture-vp9";

test("mkv imports, shows a filmstrip, and renders preview frames", async ({ page }) => {
  test.slow();
  const errors = collectErrors(page);
  await openEditor(page);

  await page.setInputFiles(
    'input[type="file"]',
    path.join(__dirname, "fixtures", `${fixture}.mkv`),
  );
  await expect(page.getByTitle(new RegExp(`${fixture}\\.mkv`))).toBeVisible({ timeout: 10_000 });

  await dragAssetToLane(page, new RegExp(`${fixture}\\.mkv`), { offsetX: 120 });
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
      { timeout: 15_000 },
    )
    .toBeGreaterThan(100);

  // Park the playhead inside the clip (ruler shares the clip's x space);
  // decoded frames land asynchronously.
  const clipBox = (await clip(page).first().boundingBox())!;
  const ruler = page.locator("div.cursor-col-resize.bg-card").first();
  const rulerBox = (await ruler.boundingBox())!;
  // ~15% in: leaves most of the 2s clip ahead of the playback check below.
  await ruler.click({
    position: { x: clipBox.x + clipBox.width * 0.15 - rulerBox.x, y: rulerBox.height / 2 },
  });
  await expect
    .poll(() => previewPixels(page), { timeout: 15_000 })
    .toBeGreaterThan(100);

  // Playback keeps rendering decoded frames (no native <video> behind this).
  await page.keyboard.press("Space");
  await page.waitForTimeout(1000);
  expect(await previewPixels(page)).toBeGreaterThan(100);
  await page.keyboard.press("Space");

  expect(errors).toEqual([]);
});
