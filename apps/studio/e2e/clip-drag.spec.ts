import { expect, test, type Page } from "@playwright/test";
import { collectErrors, openEditor, openLeftTab } from "./helpers";

/**
 * Clip drag-to-reorder across tracks. The gesture is owned by a timeline-
 * level controller with window listeners, so it must survive the clip
 * remounting under another lane mid-drag (the old node-bound handlers died
 * after one row and stranded the undo transaction).
 */

/** Two 0–3s text clips: Title on the bottom lane, Subtitle on the top lane. */
async function addTwoTitles(page: Page) {
  await openLeftTab(page, "text");
  await page.getByTitle(/Title — drag/).click();
  await page.getByTitle(/Subtitle — drag/).click(); // overlaps → lands on a new track
  await expect(page.locator("[data-mcut-clip]")).toHaveCount(2);
  await expect(page.locator("[data-mcut-lane]")).toHaveCount(2);
}

const laneClips = (page: Page, lane: number) =>
  page.locator("[data-mcut-lane]").nth(lane).locator("[data-mcut-clip]");

test("dragging a clip up a lane moves it across tracks; one undo restores it", async ({ page }) => {
  const errors = collectErrors(page);
  await openEditor(page);
  await addTwoTitles(page);

  // Grab the bottom lane's clip and drag it one row up, far enough right
  // that it doesn't overlap the clip already there.
  const box = (await laneClips(page, 1).first().boundingBox())!;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 250, startY - 56, { steps: 12 });
  await page.mouse.up();

  await expect(laneClips(page, 0)).toHaveCount(2);
  await expect(laneClips(page, 1)).toHaveCount(0);

  // The whole gesture is one history entry.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(laneClips(page, 0)).toHaveCount(1);
  await expect(laneClips(page, 1)).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("escape cancels a drag in flight and restores the clip", async ({ page }) => {
  await openEditor(page);
  await addTwoTitles(page);

  const before = (await laneClips(page, 1).first().boundingBox())!;
  const startX = before.x + before.width / 2;
  const startY = before.y + before.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 200, startY - 56, { steps: 12 });
  await page.keyboard.press("Escape");
  await page.mouse.up();

  await expect(laneClips(page, 0)).toHaveCount(1);
  await expect(laneClips(page, 1)).toHaveCount(1);
  const after = (await laneClips(page, 1).first().boundingBox())!;
  expect(Math.abs(after.x - before.x)).toBeLessThan(2);
});

test("dragging above the top lane spawns a new track", async ({ page }) => {
  await openEditor(page);
  await addTwoTitles(page);

  const box = (await laneClips(page, 1).first().boundingBox())!;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 30, startY - 2 * 56, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator("[data-mcut-lane]")).toHaveCount(3);
  await expect(laneClips(page, 0)).toHaveCount(1); // new top track holds the clip

  // addTrack + move undo together as one gesture.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("[data-mcut-lane]")).toHaveCount(2);
  await expect(laneClips(page, 1)).toHaveCount(1);
});

test("a release lost outside the window ends the drag instead of stranding it", async ({ page }) => {
  await openEditor(page);
  await addTwoTitles(page);

  const box = (await laneClips(page, 1).first().boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const move = (mx: number, my: number, buttons: number) =>
    cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: mx, y: my, button: "none", buttons });

  await move(x, y, 0);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1,
  });
  await move(x + 100, y, 1);
  const during = (await laneClips(page, 1).first().boundingBox())!;
  expect(Math.abs(during.x - (box.x + 100))).toBeLessThan(2);

  // The button comes up outside the window — no pointerup is ever delivered —
  // then the pointer re-enters and wanders. The clip must not chase it.
  await move(x + 500, y - 112, 0);
  await move(x + 300, y - 56, 0);
  const after = (await laneClips(page, 1).first().boundingBox())!;
  expect(Math.abs(after.x - during.x)).toBeLessThan(2);
  expect(Math.abs(after.y - during.y)).toBeLessThan(2);

  // The transaction closed with the gesture: one undo restores the start.
  await page.keyboard.press("ControlOrMeta+z");
  const restored = (await laneClips(page, 1).first().boundingBox())!;
  expect(Math.abs(restored.x - box.x)).toBeLessThan(2);
});

test("plain click still selects without starting a drag transaction", async ({ page }) => {
  await openEditor(page);
  await addTwoTitles(page);

  const target = laneClips(page, 1).first();
  await target.click();
  await expect(target).toHaveClass(/ring-2/); // selected ring
  // No phantom history entry: a single undo removes the Subtitle insert.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("[data-mcut-clip]")).toHaveCount(1);
});
