import { expect, test, type Page } from "@playwright/test";
import { clip, openEditor, openLeftTab } from "./helpers";

async function addTitleAtPlayhead(page: Page) {
  // getByTitle: the rail tab — role-name lookup collides with the
  // inspector's "Text" section header when a text clip is selected.
  await openLeftTab(page, "text");
  await page.getByTitle(/Title — drag/).click();
}

test("⇧⌫ ripple delete closes the gap", async ({ page }) => {
  await openEditor(page);
  await addTitleAtPlayhead(page); // clip A: 0–3s
  // Move the playhead past clip A and add another on the same track.
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight"); // 4s
  await page.getByTitle(/Subtitle — drag/).click(); // clip B: 4–7s, same track
  await expect(page.locator("[data-mcut-lane]")).toHaveCount(1);
  await expect(clip(page)).toHaveCount(2);

  const before = (await clip(page).nth(1).boundingBox())!;
  await clip(page).first().click(); // select clip A
  await page.keyboard.press("Shift+Backspace");
  await expect(clip(page)).toHaveCount(1);
  const after = (await clip(page).first().boundingBox())!;
  // Clip B shifted left by A's 3s (gap [3,4) preserved → lands at 1s).
  expect(before.x - after.x).toBeGreaterThan(80);
});

test("Q and W trim the selected clip to the playhead", async ({ page }) => {
  await openEditor(page);
  await addTitleAtPlayhead(page); // 0–3s, selected
  const before = (await clip(page).first().boundingBox())!;
  await page.keyboard.press("Shift+ArrowRight"); // 1s
  await page.keyboard.press("w"); // end → 1s
  const afterW = (await clip(page).first().boundingBox())!;
  expect(afterW.width).toBeLessThan(before.width * 0.5);

  // New clip for Q
  await page.keyboard.press("End");
  await addTitleAtPlayhead(page); // starts at 1s (playhead at end of first)
  const second = clip(page).nth(1);
  const beforeQ = (await second.boundingBox())!;
  await page.keyboard.press("Shift+ArrowRight"); // playhead +1s into the clip
  await page.keyboard.press("q");
  const afterQ = (await second.boundingBox())!;
  expect(afterQ.x).toBeGreaterThan(beforeQ.x + 20);
  expect(afterQ.width).toBeLessThan(beforeQ.width - 20);
});

test("⇧S splits every track under the playhead", async ({ page }) => {
  await openEditor(page);
  await addTitleAtPlayhead(page); // track 1: 0–3s
  await page.getByTitle(/Subtitle — drag/).click(); // overlaps → track 2: 0–3s
  await expect(page.locator("[data-mcut-lane]")).toHaveCount(2);
  await page.keyboard.press("Escape");
  for (let i = 0; i < 45; i++) await page.keyboard.press("ArrowRight"); // 1.5s @30fps
  await page.keyboard.press("Shift+s");
  await expect(clip(page)).toHaveCount(4);
});

test("⌘= zooms in and ⇧Z fits", async ({ page }) => {
  await openEditor(page);
  await addTitleAtPlayhead(page);
  const before = (await clip(page).first().boundingBox())!;
  await page.keyboard.press("ControlOrMeta+=");
  await page.keyboard.press("ControlOrMeta+=");
  const zoomed = (await clip(page).first().boundingBox())!;
  expect(zoomed.width).toBeGreaterThan(before.width * 1.4);
  await page.keyboard.press("Shift+z");
  const fitted = (await clip(page).first().boundingBox())!;
  // Fit makes the 3s clip span most of the viewport.
  expect(fitted.width).toBeGreaterThan(800);
});

test("⌘S is intercepted with an autosave toast", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText(/Autosaved — projects persist/)).toBeVisible();
});
