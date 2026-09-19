import { expect, test } from "@playwright/test";
import { openEditor, openLeftTab } from "./helpers";

test("double-click edits text in place; selection toolbar bolds a range", async ({ page }) => {
  await openEditor(page);
  await openLeftTab(page, "text");
  await page.getByTitle(/Title — drag/).click();

  const player = page.locator("[data-mcut-player]");
  const box = (await player.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);

  const editor = page.locator("[data-mcut-text-editor]");
  await expect(editor).toBeVisible();

  await page.keyboard.type("Hello world");
  await expect(editor).toHaveText("Hello world");

  await editor.dblclick();
  const toolbar = page.locator("[data-mcut-text-toolbar]");
  await expect(toolbar).toBeVisible();
  await toolbar.getByTitle("Bold (⌘B)").click();
  await expect(editor.locator("span[style*='font-weight']")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect(page.locator("[data-mcut-clip]").getByText("Hello world")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("[data-mcut-clip]").getByText("Hello world")).toBeHidden();
});
