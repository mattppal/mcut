import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { dragAssetToLane, openEditor, previewPixels } from "./helpers";

/**
 * Reversed playback health: a reversed clip must show real frames at rest
 * (including local t=0, which maps to the END of the source — the EOF seek
 * is the classic black-frame trap) and keep showing frames while playing.
 */

const FIXTURE_DIR = join(tmpdir(), "mcut-e2e-fixtures");
const SMOOTH_FIXTURE = join(FIXTURE_DIR, "smooth-8s.webm");

function ffmpeg(args: string[]): boolean {
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { timeout: 120_000 });
    return true;
  } catch {
    return false;
  }
}

let haveFixtures = false;
test.beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  haveFixtures =
    existsSync(SMOOTH_FIXTURE) ||
    ffmpeg([
      "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30:duration=8",
      "-c:v", "libvpx", "-b:v", "2M", "-auto-alt-ref", "0",
      SMOOTH_FIXTURE,
    ]);
});

async function importFile(page: Page, path: string, title: RegExp): Promise<void> {
  await page.setInputFiles('input[type="file"]', path);
  await expect(page.getByTitle(title)).toBeVisible({ timeout: 30_000 });
}

async function dragClipToStart(page: Page): Promise<void> {
  const clipBox = (await page.locator("[data-mcut-clip]").first().boundingBox())!;
  const laneBox = (await page.locator("[data-mcut-lane]").first().boundingBox())!;
  await page.mouse.move(clipBox.x + 30, clipBox.y + clipBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(laneBox.x - 40, clipBox.y + clipBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test.beforeEach(() => {
  test.skip(!haveFixtures, "ffmpeg unavailable — cannot synthesize video fixtures");
});

test("reversed clip shows frames at rest and during playback", async ({ page }) => {
  await openEditor(page);
  await importFile(page, SMOOTH_FIXTURE, /smooth-8s\.webm/);
  await dragAssetToLane(page, /smooth-8s\.webm/, { offsetX: 120 });
  await dragClipToStart(page);
  await page.locator("[data-mcut-clip]").first().click();

  // Reverse via the inspector: Speed is a signed percentage (-100 = play
  // the source backward at normal speed).
  const speed = page.getByLabel("Speed");
  await speed.fill("-100");
  await speed.press("Enter");
  await page.waitForTimeout(300);

  // Local t=0 → END of source: the EOF-adjacent frame must still render.
  await page.getByRole("button", { name: "Go to start" }).click();
  await page.waitForTimeout(1500);
  expect(await previewPixels(page), "frame at clip start (source end)").toBeGreaterThan(100);

  // Mid-clip while paused.
  await page.keyboard.press("Shift+ArrowRight"); // +1s
  await page.waitForTimeout(1200);
  expect(await previewPixels(page), "frame 1s in").toBeGreaterThan(100);

  // Playing: reversed clips seek-chase; frames must keep coming.
  await page.keyboard.press("Space");
  await page.waitForTimeout(2000);
  const playing = await previewPixels(page);
  await page.keyboard.press("Space");
  expect(playing, "frame during reversed playback").toBeGreaterThan(100);
});
