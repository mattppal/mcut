import { expect, test } from "@playwright/test";
import { clip, openEditor, openLeftTab } from "./helpers";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("⌥K master keyframe toggles diamonds across visual properties", async ({ page }) => {
  await openEditor(page);
  await openLeftTab(page, "text");
  await page.getByTitle(/Title — drag/).click();
  await page.keyboard.press("Alt+k");
  await expect(page.locator("[data-mcut-clip] button[title*='Keyframe']")).toHaveCount(1);
  for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Alt+k");
  await expect(page.locator("[data-mcut-clip] button[title*='Keyframe']")).toHaveCount(2);
  await page.keyboard.press("Alt+k");
  await expect(page.locator("[data-mcut-clip] button[title*='Keyframe']")).toHaveCount(1);
});

test("copy survives a reload via the OS clipboard envelope", async ({ page }) => {
  await openEditor(page);
  await openLeftTab(page, "text");
  await page.getByTitle(/Title — drag/).click();
  await page.keyboard.press("ControlOrMeta+c");
  await page.waitForTimeout(400);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.getByText("Discard").click({ timeout: 2000 }).catch(() => {});
  await expect(clip(page)).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+v");
  await expect(clip(page)).toHaveCount(1);
});
