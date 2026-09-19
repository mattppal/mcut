import { expect, test, type Page } from "@playwright/test";
import {
  clip,
  collectErrors,
  dragAssetToLane,
  importWebm,
  openEditor,
  previewPixels,
} from "./helpers";

test("multicam: create from selection, style a slot shadow without crashing", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openEditor(page);
  await importWebm(page, "screen.webm");
  await importWebm(page, "cam.webm");
  await dragAssetToLane(page, /screen.webm/, { offsetX: 120 });
  await dragAssetToLane(page, /cam.webm/, { offsetX: 420 });
  await expect(clip(page)).toHaveCount(2);

  await clip(page).nth(0).click();
  await clip(page).nth(1).click({ modifiers: ["Shift"] });
  await clip(page).nth(0).click({ button: "right" });
  await page.getByText("Create multicam from selection").click();
  await expect(clip(page)).toHaveCount(1);

  await page.getByRole("button", { name: "Go to start" }).click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+ArrowRight");
  await page.waitForTimeout(1000);
  expect(await previewPixels(page), "baseline preview").toBeGreaterThan(0);

  await page.getByRole("button", { name: "Multicam" }).click();
  const tiles = page.getByTitle(/cuts while playing/);
  await expect(tiles, "one tile per layout from createDefaultLayouts").toHaveCount(5);
  const tile = tiles.first();
  await tile.hover();
  await page.getByTitle("Edit slots on the canvas").first().click();

  await page
    .locator("[data-mcut-slot-editor] > div")
    .filter({ hasText: "camera" })
    .first()
    .click();
  await page.getByRole("switch", { name: "Shadow" }).click();
  await page.waitForTimeout(800);

  expect(errors).toEqual([]);
  expect(await previewPixels(page), "preview after shadow").toBeGreaterThan(0);

  await page
    .locator("[data-mcut-slot-editor] > div")
    .filter({ hasText: "screen" })
    .first()
    .click();
  await page.getByRole("switch", { name: "Shadow" }).click();
  const before = await timecodeMs(page);
  await page.keyboard.press("l");
  const fps = await mainThreadFps(page);
  await page.waitForTimeout(400);
  await page.keyboard.press("k");
  const advanced = (await timecodeMs(page)) - before;
  console.log(`playing with shadows: ${fps} rAF/s, clock advanced ${advanced}ms`);
  expect(errors).toEqual([]);
  expect(advanced, "playback advance during ~2s with shadows on").toBeGreaterThan(1000);
  expect(fps, "main-thread frames per second with shadows on").toBeGreaterThan(10);

  const cameraSlot = page
    .locator("[data-mcut-slot-editor] > div")
    .filter({ hasText: "camera" })
    .first();
  await cameraSlot.click();
  await page.getByRole("button", { name: "1:1" }).click();
  await cameraSlot.dblclick();
  const slotBox = (await cameraSlot.boundingBox())!;
  await page.mouse.move(slotBox.x + slotBox.width / 2, slotBox.y + slotBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(slotBox.x + slotBox.width / 2 - 40, slotBox.y + slotBox.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  page.once("dialog", (dialog) => void dialog.accept("Square cam"));
  await page.getByRole("button", { name: "Save as preset" }).click();
  await expect(tiles, "saveLayout appends the preset to the five defaults").toHaveCount(6);
  await page.waitForTimeout(400);
  expect(errors).toEqual([]);
  expect(await previewPixels(page), "preview after crop edits").toBeGreaterThan(0);
});

function mainThreadFps(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames++;
          if (performance.now() - start >= 1000) resolve(frames);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

test("multicam from the media bin: pick roles, swap, create", async ({ page }) => {
  const errors = collectErrors(page);
  await openEditor(page);
  await importWebm(page, "screen.webm");
  await importWebm(page, "cam.webm");

  await page.getByTitle(/screen.webm/).click();
  await page.getByTitle(/cam.webm/).click();
  const setup = page.locator("[data-mcut-multicam-setup]");
  await expect(setup.getByText("New multicam")).toBeVisible();
  await expect(setup.locator("span.truncate").first()).toHaveText("screen.webm");

  await setup.getByRole("button", { name: "Swap roles" }).click();
  await expect(setup.locator("span.truncate").first()).toHaveText("cam.webm");
  await setup.getByRole("button", { name: "Swap roles" }).click();

  await setup.getByRole("button", { name: "Create multicam" }).click();
  await expect(clip(page)).toHaveCount(1);
  await expect(page.getByText(/Layouts · 1–/)).toBeVisible();
  expect(errors).toEqual([]);

  await page.keyboard.press("l");
  await page.waitForTimeout(600);
  await page.keyboard.press("2");
  await page.keyboard.press("k");
  await clip(page).first().click();
  await page.getByRole("combobox").filter({ hasText: "Jump cut" }).click();
  await page.getByRole("option", { name: /fade black/i }).click();
  await expect(page.getByText("Blend")).toBeVisible();

  await page.getByRole("button", { name: "Go to start" }).click();
  await page.keyboard.press("l");
  await page.waitForTimeout(1200);
  await page.keyboard.press("k");
  expect(errors).toEqual([]);
  expect(await previewPixels(page), "preview after blended cut").toBeGreaterThan(0);
});

test("multicam inspector settings are scoped to multicam mode", async ({ page }) => {
  await openEditor(page);
  await importWebm(page, "screen.webm");
  await importWebm(page, "cam.webm");

  await page.getByTitle(/screen.webm/).click();
  await page.getByTitle(/cam.webm/).click();
  await page
    .locator("[data-mcut-multicam-setup]")
    .getByRole("button", { name: "Create multicam" })
    .click();
  await expect(clip(page)).toHaveCount(1);
  await clip(page).first().click();

  await expect(page.getByText(/Roles decide which layout slot/)).toBeVisible();

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByText(/Roles decide which layout slot/)).toBeHidden();
  await expect(page.getByRole("button", { name: "Motion", exact: true })).toBeVisible();
  await expect(page.locator("[title^='Arm keyframes']")).not.toHaveCount(0);
});

async function timecodeMs(page: Page): Promise<number> {
  const text = await page.locator("[data-mcut-timeline] .text-primary").first().textContent();
  const match = /(\d+):(\d+)\.(\d)/.exec(text ?? "");
  if (!match) return 0;
  return Number(match[1]) * 60_000 + Number(match[2]) * 1000 + Number(match[3]) * 100;
}
