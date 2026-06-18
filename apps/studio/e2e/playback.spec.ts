import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { dragAssetToLane, openEditor, previewPixels } from "./helpers";

/**
 * Preview playback health. These guard the preview pool's seek discipline:
 * issuing a new seek while one is in flight aborts its decode, and on
 * long-GOP sources (seek latency > drift tolerance) that used to loop
 * forever — playback degraded to ~11fps scrub-cache frames and a paused
 * preview could stay black until reload.
 *
 * Fixtures are synthesized with ffmpeg; the suite is skipped without it.
 */

const FIXTURE_DIR = join(tmpdir(), "mcut-e2e-fixtures");
const SMOOTH_FIXTURE = join(FIXTURE_DIR, "smooth-8s.webm");
// One keyframe for the whole file: every mid-file seek decodes from t=0.
const LONG_GOP_FIXTURE = join(FIXTURE_DIR, "long-gop-20s.webm");

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
    (existsSync(SMOOTH_FIXTURE) ||
      ffmpeg([
        "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30:duration=8",
        "-c:v", "libvpx", "-b:v", "2M", "-auto-alt-ref", "0",
        SMOOTH_FIXTURE,
      ])) &&
    (existsSync(LONG_GOP_FIXTURE) ||
      ffmpeg([
        "-f", "lavfi", "-i", "testsrc2=size=2560x1440:rate=30:duration=20",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=20",
        "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1",
        "-b:v", "6M", "-g", "600", "-c:a", "libopus",
        LONG_GOP_FIXTURE,
      ]));
});

declare global {
  interface Window {
    __mediaStats: {
      elements: Array<{
        tag: string;
        el: HTMLMediaElement;
        seeks: number;
        events: Array<[string, number]>;
      }>;
    };
  }
}

/** Count seeks/events on the pool's detached media elements (created pre-app). */
async function instrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const stats = (window.__mediaStats = { elements: [] as Window["__mediaStats"]["elements"] });
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime")!;
    const origCreate = Document.prototype.createElement;
    Document.prototype.createElement = function (
      this: Document,
      tag: string,
      ...rest: unknown[]
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const el = (origCreate as any).call(this, tag, ...rest) as HTMLElement;
      if (tag === "video" || tag === "audio") {
        const media = el as HTMLMediaElement;
        const rec = { tag, el: media, seeks: 0, events: [] as Array<[string, number]> };
        stats.elements.push(rec);
        for (const name of ["seeking", "seeked", "waiting", "stalled", "playing", "error"]) {
          media.addEventListener(name, () => rec.events.push([name, Math.round(performance.now())]));
        }
        Object.defineProperty(media, "currentTime", {
          get: () => desc.get!.call(media),
          set(value: number) {
            rec.seeks++;
            desc.set!.call(media, value);
          },
        });
      }
      return el;
    } as typeof Document.prototype.createElement;
  });
}

async function importFile(page: Page, path: string, title: RegExp): Promise<void> {
  await page.setInputFiles('input[type="file"]', path);
  await expect(page.getByTitle(title)).toBeVisible({ timeout: 30_000 });
}

/** Drag the (only) timeline clip flush to t=0 so the playhead intersects it. */
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

test("paused preview displays the frame under the playhead", async ({ page }) => {
  await instrument(page);
  await openEditor(page);
  await importFile(page, SMOOTH_FIXTURE, /smooth-8s\.webm/);
  await dragAssetToLane(page, /smooth-8s\.webm/, { offsetX: 120 });
  await dragClipToStart(page);

  await page.getByRole("button", { name: "Go to start" }).click();
  await page.keyboard.press("Shift+ArrowRight"); // 1s into the clip
  await page.waitForTimeout(1200);
  expect(await previewPixels(page)).toBeGreaterThan(100);

  await page.getByRole("button", { name: "Go to start" }).click();
  await page.waitForTimeout(1200);
  expect(await previewPixels(page)).toBeGreaterThan(100);
});

test("playback advances content at near-source fps without seek churn", async ({ page }) => {
  test.setTimeout(120_000);
  await instrument(page);
  await openEditor(page);
  await importFile(page, SMOOTH_FIXTURE, /smooth-8s\.webm/);
  await dragAssetToLane(page, /smooth-8s\.webm/, { offsetX: 120 });
  await dragClipToStart(page);
  await page.getByRole("button", { name: "Go to start" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Play", exact: true }).click();

  const measured = await page.evaluate(async () => {
    // Skip detached capability probes (canPlayType): the pool's element has a src.
    const findPoolVideo = () =>
      window.__mediaStats.elements.find((rec) => rec.tag === "video" && rec.el.src);
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("video never started")), 10_000);
      const check = () => {
        const rec = findPoolVideo();
        if (rec && !rec.el.paused && rec.el.readyState >= 2) {
          clearTimeout(deadline);
          resolve();
        } else requestAnimationFrame(check);
      };
      check();
    });
    const video = findPoolVideo()!;

    const canvas = document.querySelector<HTMLCanvasElement>("[data-mcut-player] canvas")!;
    const ctx = canvas.getContext("2d")!;
    let distinct = 0;
    let lastHash = "";
    const seeksBefore = video.seeks;
    const done = performance.now() + 5000;
    await new Promise<void>((resolve) => {
      const tick = () => {
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 0;
        for (let i = 0; i < data.length; i += 4096) hash = (hash * 31 + data[i]!) | 0;
        const key = String(hash);
        if (key !== lastHash) distinct++;
        lastHash = key;
        if (performance.now() < done) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    return { contentFps: distinct / 5, seeksDuringPlayback: video.seeks - seeksBefore };
  });

  // 30fps source: smooth playback shows ≥ 24 distinct frames/s, no re-seeks.
  expect(measured.contentFps).toBeGreaterThan(24);
  expect(measured.seeksDuringPlayback).toBeLessThan(3);
});

test("skip-ahead on a long-GOP file recovers without a seek spiral", async ({ page }) => {
  test.setTimeout(180_000);
  await instrument(page);
  await openEditor(page);
  await importFile(page, LONG_GOP_FIXTURE, /long-gop-20s\.webm/);
  await dragAssetToLane(page, /long-gop-20s\.webm/, { offsetX: 120 });
  await dragClipToStart(page);
  await page.getByRole("button", { name: "Go to start" }).click();
  await page.waitForTimeout(500);

  // Approximate a loaded laptop: every mid-file seek now outlasts the
  // pool's drift tolerance, which is what used to trigger the spiral.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(2500);
  await page.keyboard.press("Shift+ArrowRight"); // skip ahead mid-playback
  await page.waitForTimeout(6000);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  const report = await page.evaluate(() => {
    const video = window.__mediaStats.elements.find(
      (rec) => rec.tag === "video" && rec.el.src,
    )!;
    return { seeks: video.seeks, currentTime: video.el.currentTime };
  });

  // The broken pool issued 35+ seeks here (one every drift-tolerance tick,
  // each aborting the last); a healthy one converges in a couple.
  expect(report.seeks).toBeLessThan(5);
  // And playback actually progressed past the skip target afterwards.
  expect(report.currentTime).toBeGreaterThan(4);
});
