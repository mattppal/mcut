import { expect, test } from "@playwright/test";
import { openEditor, openLeftTab } from "./helpers";

/**
 * Inline canvas text editing: double-click a text element on the preview to
 * type in place (the panel has no textarea anymore), and style a selected
 * range from the floating toolbar (rich-text runs).
 */

test("double-click edits text in place; selection toolbar bolds a range", async ({ page }) => {
  await openEditor(page);
  await openLeftTab(page, "text");
  await page.getByTitle(/Title — drag/).click(); // adds + selects a title at center

  // Double-click the element on the preview (titles insert centered).
  const player = page.locator("[data-mcut-player]");
  const box = (await player.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);

  const editor = page.locator("[data-mcut-text-editor]");
  await expect(editor).toBeVisible();

  // Mount selects everything: typing replaces the whole text.
  await page.keyboard.type("Hello world");
  await expect(editor).toHaveText("Hello world");

  // Select a word → the floating toolbar appears → bold it.
  await editor.dblclick(); // double-click inside selects a word
  const toolbar = page.locator("[data-mcut-text-toolbar]");
  await expect(toolbar).toBeVisible();
  await toolbar.getByTitle("Bold (⌘B)").click();
  await expect(editor.locator("span[style*='font-weight']")).toHaveCount(1);

  // Escape commits: the editor closes and the timeline clip carries the text.
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect(page.locator("[data-mcut-clip]").getByText("Hello world")).toBeVisible();

  // One undo entry for the whole session: a single ⌘Z restores "Title".
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("[data-mcut-clip]").getByText("Hello world")).toBeHidden();
});
